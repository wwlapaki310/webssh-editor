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
     │  Bridge Binary  │  ← single Go/Rust binary
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

## Implementation Status

Three major implementation phases, in order of dependency:

### ① Editor UI  ⬅ current phase
The browser-side editing experience. Currently implemented as a UI prototype:

| Feature | Status | Note |
|---|---|---|
| Connect dialog (UI) | ✅ Done | SSH Key / Password / Agent modes |
| File tree + tabs | ✅ Done | Multi-file, close, switch |
| Always-editable editor | ✅ Done | `pre` + transparent `textarea` overlay |
| Syntax highlighting | 🟡 Prototype | Custom JS tokenizer — replace with Monaco |
| Terminal emulator (UI) | 🟡 Prototype | Simulated responses — replace with xterm.js |
| **Monaco Editor** | ⬜ Next | Drop-in replacement for the custom highlighter |
| File cache (IndexedDB) | ⬜ Next | Persist edits across sessions |

### ② Bridge Binary  ⬜ Not started
A small local binary (Go recommended) that the user runs once on their machine.  
It exposes a WebSocket server on `localhost` and proxies to SSH/SFTP on the remote.  
**The remote host needs nothing installed** — only a running `sshd`.

| Component | Plan |
|---|---|
| WebSocket server | `gorilla/websocket` |
| SSH/SFTP client | `golang.org/x/crypto/ssh` |
| Auth | password, SSH key, agent forwarding |
| Distribution | single static binary via GitHub Releases |

### ③ LSP in WASM  ⬜ Not started
Language servers running entirely in the browser — no remote process required.

| Language | Approach |
|---|---|
| TypeScript / JS | `tsserver` via Web Worker (native JS, easiest) |
| Python | `pylsp` via Pyodide |
| Rust | `rust-analyzer` WASM build (experimental) |

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

## Technology Stack

### Frontend (Browser)

| Component | Technology | Notes |
|---|---|---|
| Code editor | [Monaco Editor](https://github.com/microsoft/monaco-editor) | VSCode's editor core, runs in browser |
| Terminal | [xterm.js](https://xtermjs.org/) | Full terminal emulator |
| LSP (TypeScript) | `tsserver` via Web Worker | Native JS, works out of the box |
| LSP (Python) | `pylsp` via Pyodide or Worker | WASM build feasible |
| LSP (Rust) | `rust-analyzer` WASM build | Experimental but proven |
| File cache | IndexedDB | Enables offline edits, sync on reconnect |
| SSH client | WebSocket proxy to bridge | Browser cannot open raw TCP sockets |

### Local Bridge Binary

| Component | Technology | Notes |
|---|---|---|
| Language | Go | Single static binary, no dependencies |
| SSH/SFTP | `golang.org/x/crypto/ssh` | Handles auth (password, key, agent) |
| WebSocket server | `gorilla/websocket` | Bridges browser to SSH session |
| Distribution | GitHub Releases (`curl \| sh`) | One-liner install, nothing on remote |

### Remote Server

- **Required:** `sshd` running (standard on any Linux system)
- **Optional:** `inotifywait` for real-time file change detection (graceful degradation if absent)
- Nothing else. No install step. No persistent process.

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
