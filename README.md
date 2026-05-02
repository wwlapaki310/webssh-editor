# WebSSH Editor

> Browser-based SSH editor with minimal server footprint.  
> VSCode-like experience — no server-side agent required.

## 🔗 Live Demo (Prototype UI)

**[https://wwlapaki310.github.io/webssh-editor](https://wwlapaki310.github.io/webssh-editor)**

> Current prototype is a UI mockup. Connection dialog and IDE layout are interactive,  
> but actual SSH/SFTP functionality requires the bridge binary (in development).

---

## Overview / 概要

VSCode Remote SSH is powerful, but it installs a heavyweight server process (`vscode-server`) on the remote machine, consuming hundreds of MB of RAM and spiking CPU continuously. This makes it impractical for resource-constrained environments such as Raspberry Pi fleets, embedded Linux boards, or low-spec VMs.

**WebSSH Editor** takes the opposite approach:

- All editor intelligence (Monaco, LSP) runs in the **browser**
- The remote side needs **only `sshd`** — nothing installed, nothing running
- File access is handled via **SFTP** (standard SSH subsystem)
- A small local bridge binary manages the WebSocket ↔ SSH translation

### Target Users

- IoT / Edge AI engineers managing fleets of Raspberry Pi, SPRESENSE, or similar devices
- Developers who want a lightweight remote editing experience from any browser
- Anyone frustrated by VSCode Remote SSH's resource consumption on low-spec servers

---

## Problem

```
[VSCode Remote SSH — Current]

Client App ──SSH──▶ vscode-server (always running)
                        ├── Language Server (rust-analyzer, pylsp, ...)
                        ├── Extension Host
                        └── File Watcher

RAM: hundreds of MB~   CPU: continuous spikes
```

For a Raspberry Pi 3B or a small cloud VM, this is often unusable.

---

## Proposed Architecture

```
[WebSSH Editor — Proposed]

Browser                         Remote Server
┌─────────────────────────┐     ┌─────────────┐
│  Monaco Editor           │     │             │
│  LSP (WASM / Worker)     │     │  sshd only  │
│  xterm.js (terminal)     │◀──▶│  (SFTP sub- │
│  File cache (IndexedDB)  │ WS  │   system)   │
└────────────┬────────────┘     └─────────────┘
             │ localhost
     ┌───────┴────────┐
     │  Bridge Binary  │  ← single Go binary
     │  (WS ↔ SSH)    │    no install on remote
     └────────────────┘

RAM on remote: ~5 MB (sshd only)   CPU: near zero
```

---

## Repository Structure

```
webssh-editor/
├── index.html          HTML structure only (screens, dialogs, IDE layout)
├── style.css           All styles (connect dialog, IDE, editor, terminal, modals)
├── .nojekyll           GitHub Pages: bypass Jekyll processing
└── js/
    ├── data.js         Sample file contents (replaces SFTP fetch in production)
    ├── highlight.js    Syntax highlighting (Python tokenizer; swap for Monaco later)
    └── app.js          All interaction logic:
                          - Editor core (textarea + hl-pre overlay, gutter, Ctrl+S)
                          - Tab management & file tree
                          - Connect dialog & auth modes
                          - Terminal emulator
                          - Settings modal (font size, line numbers)
```

---

## Development Roadmap

The project has three major phases. Each phase builds on the previous one and can be shipped independently.

```
Phase ①  Editor UI        ██████████░░  in progress
Phase ②  Bridge Binary    ░░░░░░░░░░░░  not started
Phase ③  LSP in WASM      ░░░░░░░░░░░░  not started
```

---

### ① Editor UI  ← current phase

Goal: a fully functional browser-side editor that works against static file data.  
No real SSH yet — the editing experience must feel complete before wiring up the backend.

**Done**
- Connect dialog UI (SSH Key / Password / Agent modes, saved connections)
- File tree with expand/collapse, multi-tab editing, tab close
- Always-editable editor — `pre` highlight layer + transparent `textarea` overlay
- Ctrl+S save, unsaved dot on tab, `Saved ✓` flash in statusbar
- Cursor position (Ln / Col) in statusbar
- Settings modal (font size, line numbers toggle)
- File split: `index.html` / `style.css` / `js/data.js` / `js/highlight.js` / `js/app.js`
- Hosted on GitHub Pages

**Next steps in this phase**
- [ ] Replace custom JS tokenizer (`js/highlight.js`) with **Monaco Editor** (CDN)  
  Monaco is VSCode's editor core — it runs entirely in the browser and brings real syntax highlighting, multi-cursor, find/replace, and the familiar keybindings
- [ ] Replace simulated terminal with **xterm.js** (still static/mock at this stage)
- [ ] Add **IndexedDB** file cache so edits survive page reload
- [ ] Connection settings persistence (`localStorage`)
- [ ] Polish: keyboard shortcuts cheatsheet, empty state, error states

**Why Monaco before the bridge?**  
The editor is the core user experience. Getting it right first means the bridge integration has a stable target to wire into, rather than refactoring the UI later.

---

### ② Bridge Binary

Goal: a single Go binary the user runs locally (`webssh-editor`) that makes the browser-side editor talk to a real remote machine over SSH/SFTP.

**The remote host needs nothing installed** — only a standard running `sshd`.

**How it works**
```
Browser (localhost:3000)
    │  WebSocket
    ▼
webssh-editor binary  (user's machine)
    │  SSH / SFTP
    ▼
Remote sshd           (Raspberry Pi, VPS, etc.)
```

**Plan**
- [ ] Go project scaffold (`cmd/webssh-editor/main.go`)
- [ ] WebSocket server on `localhost` — serves the static frontend and a `/ws` endpoint
- [ ] SSH session management via `golang.org/x/crypto/ssh`
- [ ] SFTP subsystem: read file, write file, list directory
- [ ] Auth: password, SSH key (PEM), SSH agent forwarding
- [ ] HTTPS/WSS on localhost (self-signed cert) to satisfy browser mixed-content rules
- [ ] GitHub Actions: cross-compile for Linux/macOS/Windows, publish as GitHub Release
- [ ] One-liner install: `curl -L .../install.sh | sh`

**Key constraint:** the binary must work with `ws://localhost` from a GitHub Pages HTTPS origin.  
Solution: the binary serves its own HTTPS on `localhost:3000` using a self-signed certificate, so the connection is WSS and browsers accept it.

---

### ③ LSP in WASM

Goal: language intelligence (autocomplete, go-to-definition, diagnostics) running entirely in the browser — zero server-side process.

This is independent of the bridge: LSP runs in a Web Worker in the browser, reading the in-memory file contents. No network call to the remote is needed for completion.

**Plan by language**

| Language | Approach | Notes |
|---|---|---|
| TypeScript / JS | `tsserver` via Web Worker | Native JS — no WASM needed, easiest to ship first |
| Python | `pylsp` via Pyodide | Pyodide runs CPython in WASM; `pylsp` can run inside it |
| Rust | `rust-analyzer` WASM build | Experimental but proven; large download (~30MB) |

**Integration with Monaco**  
Monaco has a first-class LSP adapter. Once a language server is running in a Worker, wiring it to Monaco is straightforward via `monaco-languageclient`.

**Rollout order:** TypeScript → Python → Rust  
The first two cover the majority of IoT/edge use cases. Rust support is a bonus for embedded development.

---

## Implementation Status (summary)

### ① Editor UI

| Feature | Status |
|---|---|
| Connect dialog (UI) | ✅ Done |
| File tree + tabs | ✅ Done |
| Always-editable editor | ✅ Done |
| Ctrl+S save + modified indicator | ✅ Done |
| Syntax highlighting | 🟡 Prototype (custom JS) |
| Terminal emulator | 🟡 Prototype (simulated) |
| Monaco Editor | ⬜ Next |
| xterm.js | ⬜ Next |
| IndexedDB cache | ⬜ Next |

### ② Bridge Binary

| Feature | Status |
|---|---|
| Go project + WebSocket server | ⬜ Not started |
| SSH/SFTP client | ⬜ Not started |
| Auth (password / key / agent) | ⬜ Not started |
| HTTPS on localhost | ⬜ Not started |
| GitHub Releases CI | ⬜ Not started |

### ③ LSP in WASM

| Feature | Status |
|---|---|
| tsserver via Web Worker | ⬜ Not started |
| pylsp via Pyodide | ⬜ Not started |
| rust-analyzer WASM | ⬜ Not started |

---

## Key Design Principles

| Principle | Detail |
|---|---|
| **Zero server install** | Remote needs only a running `sshd`. No agent, no daemon. |
| **Browser-first** | Monaco Editor runs entirely in the browser via standard JS. |
| **LSP local** | Language servers run as WASM modules or Web Workers — not on the remote. |
| **Sync on save** | Files are read/written via SFTP on demand. Local cache in IndexedDB for offline edits. |
| **Single binary bridge** | A small Go binary runs locally, proxying WebSocket to SSH/SFTP. Distributed as a single static binary. |

---

## Comparison

| | VSCode Remote SSH | WebSSH (Python) | **WebSSH Editor** |
|---|---|---|---|
| Interface | Desktop app | Browser terminal only | **Browser + GUI editor** |
| Remote RAM | 200MB–1GB+ | ~20MB | **~5MB (sshd only)** |
| Server install | vscode-server | webssh server | **Nothing** |
| LSP / completion | ✅ (server-side) | ❌ | **✅ (browser-side WASM)** |
| File tree UI | ✅ | ❌ | **✅** |
| Terminal | ✅ | ✅ | **✅** |
| Works on Raspberry Pi | △ (heavy) | ✅ | **✅** |

---

## Why "Editor" matters

There is already an OSS project called [`webssh`](https://github.com/huashengdun/webssh) (Python-based).  
It provides a browser terminal over SSH — useful, but purely a terminal.

**WebSSH Editor** adds the GUI editor layer: file tree, Monaco editing, LSP completion, multi-tab workflow. The word "Editor" in the name is the key differentiator.

---

## GitHub Pages Setup

To enable the live demo, go to **Settings → Pages** and set:
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)`

The `.nojekyll` file is already included so GitHub Pages serves `index.html` correctly.

---

## Contributing

This project is in early design/prototyping phase. Ideas, architecture feedback, and PRs are welcome.

- Open an [Issue](../../issues) for feature requests or design discussions

---

## License

MIT
