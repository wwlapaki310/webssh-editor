# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

WebSSH Editor is a browser-based SSH file editor that provides a VSCode-like experience for remote machines **without installing anything on the remote host** — only standard `sshd` is required. This targets IoT/edge engineers managing resource-constrained devices (Raspberry Pi, embedded Linux, low-spec VMs) where VSCode Remote SSH (200MB–1GB+ RAM on remote) is impractical.

**Three-phase roadmap:**
- **Phase ①** (complete): Standalone browser UI prototype — editor, file tree, tabs, simulated terminal
- **Phase ②** (current): Go bridge binary running locally, proxying WebSocket ↔ SSH/SFTP
- **Phase ③** (planned): LSP servers running in browser via WASM/Web Workers (tsserver, pylsp via Pyodide, rust-analyzer)

## Running the Project

### Phase ② (bridge mode — real SSH)

Build and start the bridge, then open the served URL:

```
# Build (requires Go 1.21+)
cd bridge
go mod tidy
go build -o bridge .          # Linux/macOS
go build -o bridge.exe .      # Windows

# Run from repo root (serves static files + WebSocket)
./bridge/bridge               # Linux/macOS
.\bridge\bridge.exe           # Windows

# Then open:  http://localhost:8765
```

The bridge defaults to port `8765` and serves `..` (the repo root) as static files. Flags: `-port 8080 -dir /path/to/static`.

During development you can skip the build step with `go run .` inside `bridge/`.

### Frontend only (Phase ① demo, no SSH)

The frontend still loads standalone but will show an error on connect if the bridge is not running.

```
npx serve .
# or
python -m http.server 8080
```

## Architecture

### File Layout

```
index.html       — HTML structure (connect screen, IDE screen, settings modal)
style.css        — All styling; GitHub-dark theme via CSS variables (--bg0, --ac, --t0, …)
js/
  app.js         — All application logic (bridge WebSocket, file tree, editor, xterm.js)
  data.js        — Phase ① mock data (no longer loaded; kept for reference)
  highlight.js   — Regex-based Python syntax highlighter (temporary; Monaco replaces this)
bridge/
  main.go        — HTTP server (serves static files) + WebSocket upgrader + message routing
  session.go     — SSH client, SFTP client, PTY shell session per WebSocket connection
  go.mod         — Go module (gorilla/websocket, pkg/sftp, golang.org/x/crypto)
```

### Editor Overlay Pattern

The editor uses a **transparent textarea over a syntax-highlighted `<pre>`** overlay:
- `pre.hl-pre` renders colored HTML (from `highlight.js`)
- `textarea.editor-ta` sits on top with transparent text and a visible caret
- Both are absolutely positioned inside `.code-scroll`; scroll position must stay in sync
- `resizeTa()` keeps textarea height matched to the pre element

### Bridge WebSocket Protocol

All messages are JSON. The browser connects to `ws://localhost:8765/ws`.

| Direction | `type` | Key fields |
|---|---|---|
| browser → bridge | `connect` | `host`, `port`, `user`, `auth` (`pw`/`key`/`agent`), `password`, `key_pem` |
| bridge → browser | `connected` | `cwd` (remote home directory) |
| browser → bridge | `ls` | `path` |
| bridge → browser | `ls_result` | `path`, `entries: [{name, is_dir, size}]` |
| browser → bridge | `read` | `path` |
| bridge → browser | `read_result` | `path`, `content` |
| browser → bridge | `write` | `path`, `content` |
| bridge → browser | `write_ok` | `path` |
| browser → bridge | `term_input` | `data` (raw terminal bytes) |
| bridge → browser | `term_output` | `data` (raw terminal bytes) |
| browser → bridge | `resize` | `cols`, `rows` |
| bridge → browser | `error` | `message` |
| either | `disconnect` / `disconnected` | — |

### State in `app.js`

Global mutable state:
- `FILES` — map of remote path → content (in-memory buffer, mutated on every keystroke)
- `savedFiles` — map of remote path → last-saved content (used to detect unsaved changes)
- `openTabs` — array of remote paths currently open as tabs
- `currentFile` — active tab's remote path (full absolute path on remote)
- `ftreeCache` — map of remote dir path → `[]Entry` from `ls_result`
- `ftreeExpanded` — `Set` of directory paths currently expanded in the tree
- `showLn`, `fontSize` — editor settings

Persistent state:
- `localStorage` key `webssh-editor:connections` — array of saved SSH connection objects

### Connect → IDE Flow

`doConnect()` in `app.js`:
1. Opens `WebSocket` to `ws://localhost:8765/ws`
2. On `ws.onopen`: sends `{type:"connect", ...}` with credentials
3. On `connected` reply: transitions to IDE screen, runs `ls remoteCwd`, calls `initXterm()`
4. On `ls_result`: calls `renderFileTree()` which rebuilds the sidebar DOM
5. On file click: sends `read`, receives `read_result`, loads content into editor

### Terminal

xterm.js (`Terminal` + `FitAddon`) renders into `#xterm-container`. Raw bytes flow directly between the browser and the remote PTY — no line-buffering or command parsing. `ResizeObserver` on the container calls `fitAddon.fit()` and sends a `resize` message to bridge.

## Key Conventions

- **No framework** — vanilla JS + direct DOM manipulation; `onclick` handlers wired in HTML attributes
- **No comments** unless non-obvious; identifiers are expected to be self-documenting
- `escAttr()` / `esc()` in `highlight.js` must be used whenever writing user-controlled content into HTML to prevent XSS
- CSS variables defined in `:root` in `style.css` — use them for all new colors/spacing
- `highlight(filename, content)` in `highlight.js` is the dispatch entry point for syntax highlighting; add new language branches there
