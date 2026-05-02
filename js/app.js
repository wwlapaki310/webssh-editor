// ============================================================
// Bridge / WebSocket
// ============================================================

const BRIDGE_WS = 'ws://localhost:8765/ws'

let ws        = null
let remoteCwd = ''
let connUser  = ''
let connHost  = ''
let connPort  = '22'

function sendBridge(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function handleBridgeMsg(ev) {
  let msg
  try { msg = JSON.parse(ev.data) } catch { return }
  switch (msg.type) {
    case 'connected':   onConnected(msg);                    break
    case 'ls_result':   onLsResult(msg);                     break
    case 'read_result': onReadResult(msg);                   break
    case 'write_ok':    onWriteOk(msg);                      break
    case 'term_output': if (term) term.write(msg.data);      break
    case 'error':       showConnError(msg.message);          break
    case 'disconnected': goDialog();                         break
  }
}

// ============================================================
// Connection storage (localStorage)
// ============================================================

const CONN_KEY = 'webssh-editor:connections'

const DEFAULT_CONNECTIONS = [
  { name: 'example-server', host: 'your-server.example.com', user: 'username', port: '22', auth: 'pw' },
]

function getConnections() {
  try {
    const stored = localStorage.getItem(CONN_KEY)
    return stored ? JSON.parse(stored) : DEFAULT_CONNECTIONS
  } catch { return DEFAULT_CONNECTIONS }
}

function setConnections(list) {
  localStorage.setItem(CONN_KEY, JSON.stringify(list))
}

function deriveConnName(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host
  return host.split('.')[0] || host
}

// ============================================================
// Saved connections UI
// ============================================================

let selectedConnIdx = 0
let isNewMode       = false

function renderSavedList(selectIdx = 0) {
  const list = getConnections()
  const el   = document.getElementById('saved-list')
  if (list.length === 0) {
    el.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--t2)">No saved connections</div>'
    return
  }
  el.innerHTML = list.map((c, i) => `
    <div class="saved-item${i === selectIdx && !isNewMode ? ' sel' : ''}" onclick="selectConn(${i})">
      <div class="saved-name">${escAttr(c.name)}</div>
      <div class="saved-host">${escAttr(c.host)}</div>
    </div>
  `).join('')
}

function selectConn(idx) {
  isNewMode = false
  selectedConnIdx = idx
  const list = getConnections()
  if (list[idx]) { fillForm(list[idx]); renderSavedList(idx) }
}

function fillForm(c) {
  document.getElementById('f-host').value = c.host || ''
  document.getElementById('f-user').value = c.user || ''
  document.getElementById('f-port').value = c.port || '22'
  setAuth(c.auth || 'pw')
}

function newConnection() {
  isNewMode = true
  renderSavedList(-1)
  document.getElementById('f-host').value = ''
  document.getElementById('f-user').value = ''
  document.getElementById('f-port').value = '22'
  document.getElementById('f-pw').value   = ''
  setAuth('pw')
  document.getElementById('f-host').focus()
}

function cancelNewConnection() {
  if (isNewMode) {
    isNewMode = false
    const list = getConnections()
    if (list.length > 0) selectConn(0)
    else renderSavedList()
  }
}

// ============================================================
// Editor state
// ============================================================

let currentFile     = null
let openTabs        = []
let showLn          = true
let fontSize        = 12.5
let savedFlashTimer = null

const FILES      = {}  // remote path → content (local buffer)
const savedFiles = {}  // remote path → last-saved content

// ============================================================
// Editor core
// ============================================================

function loadFileIntoEditor(path, content) {
  currentFile = path
  const ta = document.getElementById('editor-ta')
  ta.value = content
  const name = path.split('/').pop()
  refreshHighlight(name, content)
  refreshGutter(content)
  resizeTa()
  updateCursor()
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === path))
  document.querySelectorAll('.tree-node[data-file]').forEach(n => n.classList.toggle('active', n.dataset.file === path))
}

function refreshHighlight(name, content) {
  document.getElementById('hl-pre').innerHTML = highlight(name, content)
}

function refreshGutter(content) {
  const el = document.getElementById('gutter-nums')
  if (!showLn) { el.textContent = ''; return }
  const n = content.split('\n').length
  el.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n')
}

function resizeTa() {
  const ta  = document.getElementById('editor-ta')
  const pre = document.getElementById('hl-pre')
  const cs  = document.getElementById('code-scroll')
  ta.style.height = Math.max(pre.scrollHeight, cs.clientHeight) + 'px'
}

function syncGutter() {
  const scrollTop = document.getElementById('code-scroll').scrollTop
  const gn = document.getElementById('gutter-nums')
  gn.style.paddingTop = Math.max(0, 14 - scrollTop) + 'px'
  gn.style.marginTop  = scrollTop > 14 ? -(scrollTop - 14) + 'px' : '0'
}

function onEditorInput() {
  const ta      = document.getElementById('editor-ta')
  const content = ta.value
  if (!currentFile) return
  FILES[currentFile] = content
  const name = currentFile.split('/').pop()
  refreshHighlight(name, content)
  refreshGutter(content)
  resizeTa()
  updateCursor()
  const modified = content !== savedFiles[currentFile]
  const tab = document.querySelector(`.tab[data-file="${CSS.escape(currentFile)}"]`)
  if (tab) tab.classList.toggle('modified', modified)
}

function updateCursor() {
  const ta     = document.getElementById('editor-ta')
  const before = ta.value.substring(0, ta.selectionStart)
  const lines  = before.split('\n')
  document.getElementById('sb-cur').textContent =
    `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`
}

function focusEditor() { document.getElementById('editor-ta').focus() }

function onEditorKeyDown(ev) {
  if (ev.key === 's' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault(); saveCurrentFile(); return
  }
  if (ev.key === 'Tab') {
    ev.preventDefault()
    const ta = ev.target, s = ta.selectionStart, e = ta.selectionEnd
    ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(e)
    ta.selectionStart = ta.selectionEnd = s + 4
    onEditorInput()
  }
}

function saveCurrentFile() {
  if (!currentFile || !ws || ws.readyState !== WebSocket.OPEN) return
  sendBridge({ type: 'write', path: currentFile, content: FILES[currentFile] || '' })
}

function onWriteOk(msg) {
  savedFiles[msg.path] = FILES[msg.path]
  const tab = document.querySelector(`.tab[data-file="${CSS.escape(msg.path)}"]`)
  if (tab) tab.classList.remove('modified')
  if (msg.path === currentFile) {
    const el = document.getElementById('sb-saved')
    el.classList.add('show')
    clearTimeout(savedFlashTimer)
    savedFlashTimer = setTimeout(() => el.classList.remove('show'), 1800)
  }
}

// ============================================================
// Connect dialog
// ============================================================

function setAuth(type) {
  ;['key', 'pw', 'agent'].forEach(t => {
    document.getElementById('opt-' + t).classList.toggle('on', t === type)
    document.getElementById('pane-' + t).classList.toggle('on', t === type)
  })
}

function togglePw() {
  const f = document.getElementById('f-pw')
  const b = document.querySelector('.pw-eye')
  f.type = f.type === 'password' ? 'text' : 'password'
  b.textContent = f.type === 'password' ? 'show' : 'hide'
}

function currentAuthType() {
  if (document.getElementById('opt-key').classList.contains('on'))   return 'key'
  if (document.getElementById('opt-agent').classList.contains('on')) return 'agent'
  return 'pw'
}

function showConnError(msg) {
  const el = document.getElementById('conn-error')
  el.textContent = msg
  el.style.display = 'block'
}

function clearConnError() {
  const el = document.getElementById('conn-error')
  el.style.display = 'none'
}

function loadKeyFile(ev) {
  const file = ev.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = e => { document.getElementById('key-ta').value = e.target.result }
  reader.readAsText(file)
  ev.target.value = ''
}

function doConnect() {
  const host = document.getElementById('f-host').value.trim()
  const user = document.getElementById('f-user').value.trim()
  const port = document.getElementById('f-port').value.trim() || '22'
  if (!host || !user) { document.getElementById('f-host').focus(); return }

  clearConnError()

  if (document.getElementById('chk-save').checked) {
    const auth  = currentAuthType()
    const name  = deriveConnName(host)
    const list  = getConnections()
    const idx   = list.findIndex(c => c.host === host && c.user === user && c.port === port)
    const entry = { name, host, user, port, auth }
    if (idx >= 0) list[idx] = entry; else list.push(entry)
    setConnections(list)
    selectedConnIdx = idx >= 0 ? idx : list.length - 1
    isNewMode = false
  }

  connUser = user
  connHost = host
  connPort = port

  const btn = document.getElementById('btn-connect')
  btn.disabled = true
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="8 6" style="animation:spin .8s linear infinite;transform-origin:6.5px 6.5px"/></svg> Connecting…'

  if (ws) { try { ws.close() } catch {} ws = null }

  ws = new WebSocket(BRIDGE_WS)

  ws.onopen = () => {
    const auth = currentAuthType()
    const msg  = { type: 'connect', host, port: parseInt(port, 10), user, auth }
    if (auth === 'pw')  msg.password = document.getElementById('f-pw').value
    if (auth === 'key') msg.key_pem  = document.getElementById('key-ta').value
    ws.send(JSON.stringify(msg))
  }

  ws.onmessage = handleBridgeMsg

  ws.onerror = () => {
    btn.disabled = false
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Connect'
    showConnError('Bridge is not running.\nStart it with:  cd bridge && go run .\nThen open http://localhost:8765')
  }

  ws.onclose = () => {
    if (document.getElementById('screen-ide').classList.contains('active')) {
      goDialog()
    }
  }
}

function goDialog() {
  if (ws) { try { ws.close() } catch {} ws = null }
  document.getElementById('screen-ide').classList.remove('active')
  document.getElementById('screen-connect').classList.add('active')
  renderSavedList(selectedConnIdx)
  clearConnError()
}

function onConnected(msg) {
  remoteCwd = msg.cwd || '/'

  const btn = document.getElementById('btn-connect')
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5l3 3 5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Connected!'

  setTimeout(() => {
    document.getElementById('screen-connect').classList.remove('active')
    document.getElementById('screen-ide').classList.add('active')
    document.getElementById('conn-label').textContent = `${connUser}@${connHost}:${connPort}`
    document.getElementById('term-host').textContent  = `${connUser}@${deriveConnName(connHost)}`

    btn.disabled = false
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Connect'

    // Reset editor
    Object.keys(FILES).forEach(k => delete FILES[k])
    Object.keys(savedFiles).forEach(k => delete savedFiles[k])
    openTabs    = []
    currentFile = null
    document.getElementById('tabs-bar').innerHTML      = ''
    document.getElementById('hl-pre').innerHTML        = ''
    document.getElementById('editor-ta').value         = ''
    document.getElementById('gutter-nums').textContent = ''

    // Load file tree
    ftreeCache    = {}
    ftreeExpanded = new Set([remoteCwd])
    sendBridge({ type: 'ls', path: remoteCwd })

    // Init terminal (must be after screen is visible for fitAddon to measure)
    initXterm()
  }, 300)
}

// ============================================================
// File tree
// ============================================================

let ftreeCache    = {}
let ftreeExpanded = new Set()

function fileIcon(name) {
  const ext = name.split('.').pop()
  const colors = { py:'#3572A5', go:'#00ADD8', js:'#f1e05a', ts:'#3178c6',
                   json:'#cbcb41', md:'#e3b341', sh:'#89e051', rs:'#dea584',
                   c:'#555555', cpp:'#f34b7d', rb:'#701516', yml:'#cb171e', yaml:'#cb171e' }
  const color = colors[ext] || '#8b949e'
  return `<span style="color:${color};font-size:12px">&#9649;</span>`
}

function onLsResult(msg) {
  ftreeCache[msg.path] = msg.entries || []
  renderFileTree()
}

function renderFileTree() {
  const sidebar = document.querySelector('.sidebar')
  const sec     = sidebar.querySelector('.sb-sec')
  // Remove all nodes after .sb-sec
  while (sec.nextSibling) sidebar.removeChild(sec.nextSibling)
  renderDirEntries(sidebar, remoteCwd, 0)
}

function renderDirEntries(container, dirPath, depth) {
  const entries = ftreeCache[dirPath]
  if (!entries) return

  const sorted = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    const fullPath = dirPath.replace(/\/$/, '') + '/' + entry.name
    const pl = 12 + depth * 16

    if (entry.is_dir) {
      const isOpen = ftreeExpanded.has(fullPath)
      const node   = document.createElement('div')
      node.className = 'tree-node'
      node.style.paddingLeft = pl + 'px'
      node.dataset.dir = fullPath
      node.innerHTML = `<span class="tree-arrow">${isOpen ? '&#9662;' : '&#9658;'}</span><span style="font-size:12px">&#128193;</span>&nbsp;${escAttr(entry.name)}`
      node.onclick = () => toggleTreeDir(node, fullPath, depth + 1)
      container.appendChild(node)

      const ch = document.createElement('div')
      ch.className = 'tree-ch' + (isOpen ? ' open' : '')
      ch.id = 'tch-' + fullPath.replace(/[^a-zA-Z0-9]/g, '_')
      container.appendChild(ch)

      if (isOpen && ftreeCache[fullPath]) {
        renderDirEntries(ch, fullPath, depth + 1)
      } else if (isOpen) {
        sendBridge({ type: 'ls', path: fullPath })
      }
    } else {
      const node = document.createElement('div')
      node.className = 'tree-node'
      if (currentFile === fullPath) node.classList.add('active')
      node.style.paddingLeft = (pl + 15) + 'px'
      node.dataset.file = fullPath
      node.innerHTML = `${fileIcon(entry.name)}&nbsp;${escAttr(entry.name)}`
      node.onclick = () => openFile(fullPath, node)
      container.appendChild(node)
    }
  }
}

function toggleTreeDir(el, path, depth) {
  const arrow  = el.querySelector('.tree-arrow')
  const isOpen = arrow.innerHTML.includes('9662')
  const chId   = 'tch-' + path.replace(/[^a-zA-Z0-9]/g, '_')
  const ch     = document.getElementById(chId)

  if (isOpen) {
    arrow.innerHTML = '&#9658;'
    ftreeExpanded.delete(path)
    if (ch) ch.classList.remove('open')
  } else {
    arrow.innerHTML = '&#9662;'
    ftreeExpanded.add(path)
    if (ch) {
      ch.classList.add('open')
      if (!ftreeCache[path]) {
        sendBridge({ type: 'ls', path })
      } else {
        ch.innerHTML = ''
        renderDirEntries(ch, path, depth)
      }
    }
  }
}

function openFile(path, el) {
  document.querySelectorAll('.tree-node[data-file]').forEach(n => n.classList.remove('active'))
  if (el) el.classList.add('active')

  if (!openTabs.includes(path)) {
    openTabs.push(path)
    const name = path.split('/').pop()
    const t    = document.createElement('div')
    t.className  = 'tab'
    t.dataset.file = path
    t.innerHTML  = `<span class="dot"></span><span class="tab-name">${escAttr(name)}</span><span class="x">&times;</span>`
    t.onclick    = () => switchTab(path)
    t.querySelector('.x').addEventListener('click', ev => closeTab(ev, path))
    document.getElementById('tabs-bar').appendChild(t)
  }
  switchTab(path)
}

function switchTab(path) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === path))
  document.querySelectorAll('.tree-node[data-file]').forEach(n => n.classList.toggle('active', n.dataset.file === path))
  currentFile = path

  if (FILES[path] !== undefined) {
    loadFileIntoEditor(path, FILES[path])
  } else {
    document.getElementById('editor-ta').value  = ''
    document.getElementById('hl-pre').innerHTML = '<span style="color:var(--t2);padding:14px 16px;display:block">Loading…</span>'
    document.getElementById('gutter-nums').textContent = ''
    sendBridge({ type: 'read', path })
  }
}

function closeTab(ev, path) {
  ev.stopPropagation()
  openTabs = openTabs.filter(t => t !== path)
  const t = document.querySelector(`.tab[data-file="${CSS.escape(path)}"]`)
  if (t) t.remove()
  if (currentFile === path) {
    if (openTabs.length > 0) switchTab(openTabs[openTabs.length - 1])
    else {
      currentFile = null
      document.getElementById('hl-pre').innerHTML        = ''
      document.getElementById('editor-ta').value         = ''
      document.getElementById('gutter-nums').textContent = ''
    }
  }
}

function onReadResult(msg) {
  FILES[msg.path]      = msg.content
  savedFiles[msg.path] = msg.content
  if (currentFile === msg.path) loadFileIntoEditor(msg.path, msg.content)
}

// ============================================================
// Settings
// ============================================================

function openSettings()  { document.getElementById('settings-modal').classList.add('open') }
function closeSettings() { document.getElementById('settings-modal').classList.remove('open') }
function closeSettingsOutside(ev) {
  if (ev.target === document.getElementById('settings-modal')) closeSettings()
}

function setFontSize(size) {
  fontSize = size
  document.querySelectorAll('.seg-b').forEach(b => b.classList.toggle('on', +b.dataset.size === size))
  const px = size + 'px'
  document.getElementById('hl-pre').style.fontSize      = px
  document.getElementById('editor-ta').style.fontSize   = px
  document.getElementById('gutter-nums').style.fontSize = (size - 0.5) + 'px'
  resizeTa()
}

function toggleLineNumbers(show) {
  showLn = show
  document.getElementById('gutter-nums').style.visibility = show ? 'visible' : 'hidden'
  if (currentFile && FILES[currentFile] !== undefined) refreshGutter(FILES[currentFile])
}

// ============================================================
// Terminal (xterm.js)
// ============================================================

let term     = null
let fitAddon = null

function initXterm() {
  if (term) { term.dispose(); term = null; fitAddon = null }

  term = new Terminal({
    theme: {
      background:          '#0d1117',
      foreground:          '#e6edf3',
      cursor:              '#1D9E75',
      cursorAccent:        '#0d1117',
      selectionBackground: 'rgba(56,139,253,0.25)',
      black:               '#0d1117',
      brightBlack:         '#3d444d',
      white:               '#e6edf3',
      brightWhite:         '#ffffff',
      green:               '#1D9E75',
      brightGreen:         '#9fe1cb',
      red:                 '#ff7b72',
      brightRed:           '#ffa198',
      yellow:              '#e3b341',
      brightYellow:        '#f2cc60',
      blue:                '#58a6ff',
      brightBlue:          '#79c0ff',
    },
    fontFamily:  "'JetBrains Mono', monospace",
    fontSize:    12,
    lineHeight:  1.4,
    cursorBlink: true,
    scrollback:  2000,
    convertEol:  false,
  })

  fitAddon = new FitAddon.FitAddon()
  term.loadAddon(fitAddon)

  const container = document.getElementById('xterm-container')
  container.innerHTML = ''
  term.open(container)

  // Defer fit so the container has layout dimensions
  requestAnimationFrame(() => {
    fitAddon.fit()
    sendBridge({ type: 'resize', cols: term.cols, rows: term.rows })
  })

  term.onData(data => sendBridge({ type: 'term_input', data }))

  term.onResize(({ cols, rows }) => sendBridge({ type: 'resize', cols, rows }))

  new ResizeObserver(() => {
    if (fitAddon) {
      fitAddon.fit()
    }
  }).observe(container)
}

// ============================================================
// Utilities
// ============================================================

function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============================================================
// Init
// ============================================================

const initList = getConnections()
renderSavedList(0)
if (initList.length > 0) fillForm(initList[0])
