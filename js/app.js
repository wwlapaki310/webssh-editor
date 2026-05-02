// ============================================================
// Connection storage (localStorage)
// ============================================================

const CONN_KEY = 'webssh-editor:connections';

const DEFAULT_CONNECTIONS = [
  { name: 'example-server', host: 'your-server.example.com', user: 'username', port: '22', auth: 'pw' },
];

function getConnections() {
  try {
    const stored = localStorage.getItem(CONN_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_CONNECTIONS;
  } catch {
    return DEFAULT_CONNECTIONS;
  }
}

function setConnections(list) {
  localStorage.setItem(CONN_KEY, JSON.stringify(list));
}

/** Derive a short display name from a hostname or IP. */
function deriveConnName(host, user) {
  // IP address — keep as-is
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  // hostname — take first segment
  return host.split('.')[0] || host;
}

// ============================================================
// Saved connections list UI
// ============================================================

let selectedConnIdx = 0; // which saved item is highlighted
let isNewMode = false;   // true while "New" blank form is open

function renderSavedList(selectIdx = 0) {
  const list = getConnections();
  const el = document.getElementById('saved-list');
  if (list.length === 0) {
    el.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:var(--t2)">No saved connections</div>';
    return;
  }
  el.innerHTML = list.map((c, i) => `
    <div class="saved-item${i === selectIdx && !isNewMode ? ' sel' : ''}" onclick="selectConn(${i})">
      <div class="saved-name">${escAttr(c.name)}</div>
      <div class="saved-host">${escAttr(c.host)}</div>
    </div>
  `).join('');
}

function selectConn(idx) {
  isNewMode = false;
  selectedConnIdx = idx;
  const list = getConnections();
  if (!list[idx]) return;
  fillForm(list[idx]);
  renderSavedList(idx);
}

function fillForm(c) {
  document.getElementById('f-host').value = c.host || '';
  document.getElementById('f-user').value = c.user || '';
  document.getElementById('f-port').value = c.port || '22';
  setAuth(c.auth || 'pw');
}

function newConnection() {
  isNewMode = true;
  // deselect all
  renderSavedList(-1);
  // clear form
  document.getElementById('f-host').value = '';
  document.getElementById('f-user').value = '';
  document.getElementById('f-port').value = '22';
  document.getElementById('f-pw').value = '';
  setAuth('pw');
  document.getElementById('f-host').focus();
}

function cancelNewConnection() {
  // If we were in new mode, revert to last selected
  if (isNewMode) {
    isNewMode = false;
    const list = getConnections();
    if (list.length > 0) {
      selectConn(0);
    } else {
      renderSavedList();
    }
  }
}

// ============================================================
// Main application state
// ============================================================

let currentFile = 'main.py';
let openTabs    = ['main.py'];
let termCwd     = '~/project';
let connUser    = '';
let showLn      = true;
let fontSize    = 12.5;
let savedFlashTimer = null;

// ============================================================
// Editor core
// ============================================================

function loadFile(name) {
  const ta = document.getElementById('editor-ta');
  const content = FILES[name] || '';
  ta.value = content;
  refreshHighlight(name, content);
  refreshGutter(content);
  resizeTa();
  updateCursor();
}

function refreshHighlight(name, content) {
  document.getElementById('hl-pre').innerHTML = highlight(name, content);
}

function refreshGutter(content) {
  const el = document.getElementById('gutter-nums');
  if (!showLn) { el.textContent = ''; return; }
  const lineCount = content.split('\n').length;
  el.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
}

function resizeTa() {
  const ta  = document.getElementById('editor-ta');
  const pre = document.getElementById('hl-pre');
  const cs  = document.getElementById('code-scroll');
  ta.style.height = Math.max(pre.scrollHeight, cs.clientHeight) + 'px';
}

function syncGutter() {
  const scrollTop = document.getElementById('code-scroll').scrollTop;
  const gn = document.getElementById('gutter-nums');
  gn.style.paddingTop = Math.max(0, 14 - scrollTop) + 'px';
  gn.style.marginTop  = scrollTop > 14 ? -(scrollTop - 14) + 'px' : '0';
}

function onEditorInput() {
  const ta = document.getElementById('editor-ta');
  const content = ta.value;
  FILES[currentFile] = content;
  refreshHighlight(currentFile, content);
  refreshGutter(content);
  resizeTa();
  updateCursor();
  const modified = content !== savedFiles[currentFile];
  const tab = document.querySelector(`.tab[data-file="${currentFile}"]`);
  if (tab) tab.classList.toggle('modified', modified);
}

function updateCursor() {
  const ta = document.getElementById('editor-ta');
  const before = ta.value.substring(0, ta.selectionStart);
  const lines  = before.split('\n');
  document.getElementById('sb-cur').textContent =
    `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

function focusEditor() {
  document.getElementById('editor-ta').focus();
}

function onEditorKeyDown(ev) {
  if (ev.key === 's' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    saveCurrentFile();
    return;
  }
  if (ev.key === 'Tab') {
    ev.preventDefault();
    const ta = ev.target;
    const s  = ta.selectionStart;
    const e  = ta.selectionEnd;
    ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(e);
    ta.selectionStart = ta.selectionEnd = s + 4;
    onEditorInput();
  }
}

function saveCurrentFile() {
  savedFiles[currentFile] = FILES[currentFile];
  const tab = document.querySelector(`.tab[data-file="${currentFile}"]`);
  if (tab) tab.classList.remove('modified');
  const el = document.getElementById('sb-saved');
  el.classList.add('show');
  clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ============================================================
// Connect dialog
// ============================================================

function setAuth(type) {
  ['key', 'pw', 'agent'].forEach(t => {
    document.getElementById('opt-' + t).classList.toggle('on', t === type);
    document.getElementById('pane-' + t).classList.toggle('on', t === type);
  });
}

function togglePw() {
  const f = document.getElementById('f-pw');
  const b = document.querySelector('.pw-eye');
  f.type = f.type === 'password' ? 'text' : 'password';
  b.textContent = f.type === 'password' ? 'show' : 'hide';
}

function currentAuthType() {
  if (document.getElementById('opt-key').classList.contains('on'))   return 'key';
  if (document.getElementById('opt-agent').classList.contains('on')) return 'agent';
  return 'pw';
}

function doConnect() {
  const btn  = document.getElementById('btn-connect');
  const host = document.getElementById('f-host').value.trim();
  const user = document.getElementById('f-user').value.trim();
  const port = document.getElementById('f-port').value.trim() || '22';

  if (!host || !user) {
    document.getElementById('f-host').focus();
    return;
  }

  // Save connection if checkbox is checked
  if (document.getElementById('chk-save').checked) {
    const auth = currentAuthType();
    const name = deriveConnName(host, user);
    const list = getConnections();
    const existing = list.findIndex(c => c.host === host && c.user === user && c.port === port);
    const entry = { name, host, user, port, auth };
    if (existing >= 0) {
      list[existing] = entry;
    } else {
      list.push(entry);
    }
    setConnections(list);
    selectedConnIdx = existing >= 0 ? existing : list.length - 1;
    isNewMode = false;
  }

  connUser = user;
  btn.disabled = true;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="8 6" style="animation:spin .8s linear infinite;transform-origin:6.5px 6.5px"/></svg> Connecting\u2026';

  setTimeout(() => {
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5l3 3 5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Connected!';
    setTimeout(() => {
      document.getElementById('screen-connect').classList.remove('active');
      document.getElementById('screen-ide').classList.add('active');
      document.getElementById('conn-label').textContent = `${user}@${host}:${port}`;
      const shortHost = deriveConnName(host, user);
      document.getElementById('t-prompt-span').textContent = `${user}@${shortHost}:${termCwd}$ `;
      document.getElementById('term-host').textContent = `${user}@${shortHost}`;
      // show initial terminal prompt
      initTerminal(user, shortHost);
      loadFile(currentFile);
      setTimeout(() => document.getElementById('editor-ta').focus(), 100);
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 6.5h9M7.5 3l3.5 3.5L7.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Connect';
    }, 400);
  }, 1200);
}

function goDialog() {
  document.getElementById('screen-ide').classList.remove('active');
  document.getElementById('screen-connect').classList.add('active');
  renderSavedList(selectedConnIdx);
}

// ============================================================
// File tree
// ============================================================

function toggleDir(el) {
  const arrow  = el.querySelector('.tree-arrow');
  const isOpen = arrow.textContent.includes('\u25be');
  arrow.textContent = isOpen ? '\u25b8' : '\u25be';
  arrow.style.color = isOpen ? 'var(--t2)' : 'var(--t1)';
  const ch = document.getElementById('dir-' + el.dataset.dir);
  if (ch) ch.classList.toggle('open', !isOpen);
}

function openFile(name, el) {
  document.querySelectorAll('.tree-node[data-file]').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (!openTabs.includes(name)) {
    openTabs.push(name);
    const t = document.createElement('div');
    t.className = 'tab';
    t.dataset.file = name;
    t.innerHTML = `<span class="dot"></span><span class="tab-name">${name}</span><span class="x" onclick="closeTab(event,'${name}')">&times;</span>`;
    t.onclick = () => switchTab(name);
    document.getElementById('tabs-bar').appendChild(t);
  }
  switchTab(name);
}

function switchTab(name) {
  currentFile = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.file === name));
  document.querySelectorAll('.tree-node[data-file]').forEach(n => n.classList.toggle('active', n.dataset.file === name));
  loadFile(name);
  document.getElementById('editor-ta').focus();
}

function closeTab(ev, name) {
  ev.stopPropagation();
  openTabs = openTabs.filter(t => t !== name);
  const t = document.querySelector(`.tab[data-file="${name}"]`);
  if (t) t.remove();
  if (currentFile === name) {
    if (openTabs.length > 0) switchTab(openTabs[openTabs.length - 1]);
    else {
      document.getElementById('hl-pre').innerHTML = '';
      document.getElementById('editor-ta').value  = '';
    }
  }
}

// ============================================================
// Settings
// ============================================================

function openSettings()  { document.getElementById('settings-modal').classList.add('open'); }
function closeSettings() { document.getElementById('settings-modal').classList.remove('open'); }
function closeSettingsOutside(ev) {
  if (ev.target === document.getElementById('settings-modal')) closeSettings();
}

function setFontSize(size) {
  fontSize = size;
  document.querySelectorAll('.seg-b').forEach(b => b.classList.toggle('on', +b.dataset.size === size));
  const px = size + 'px';
  document.getElementById('hl-pre').style.fontSize    = px;
  document.getElementById('editor-ta').style.fontSize = px;
  document.getElementById('gutter-nums').style.fontSize = (size - 0.5) + 'px';
  resizeTa();
}

function toggleLineNumbers(show) {
  showLn = show;
  document.getElementById('gutter-nums').style.visibility = show ? 'visible' : 'hidden';
  refreshGutter(FILES[currentFile] || '');
}

// ============================================================
// Terminal
// ============================================================

function initTerminal(user, shortHost) {
  const body = document.getElementById('term-body');
  const row  = document.getElementById('t-input-row');
  // clear previous lines (keep input row)
  Array.from(body.children).forEach(c => { if (c !== row) c.remove(); });
  // show welcome line
  const welcome = document.createElement('div');
  welcome.className = 't-line';
  welcome.innerHTML = `<span class="t-dim">Connected to ${escAttr(user)}@${escAttr(shortHost)}</span>`;
  body.insertBefore(welcome, row);
  // reset prompt
  termCwd = '~/project';
  document.getElementById('t-prompt-span').textContent = `${user}@${shortHost}:${termCwd}$ `;
  document.getElementById('term-host').textContent = `${user}@${shortHost}`;
}

const TERM_RESPONSES = {
  'ls':            'config.py  main.py  model.py  requirements.txt  README.md  tests/',
  'ls -la':        'total 28\ndrwxr-xr-x 4 user user 4096 May  1 12:00 .\n-rw-r--r-- 1 user user  842 May  1 12:00 README.md\ndrwxr-xr-x 2 user user 4096 May  1 12:00 src\ndrwxr-xr-x 2 user user 4096 May  1 12:00 tests',
  'pwd':           '/home/user/project',
  'whoami':        'user',
  'uname -a':      'Linux example-server 6.1.0 #1 SMP aarch64 GNU/Linux',
  'free -h':       '               total   used   free\nMem:           3.7Gi  612Mi  2.8Gi',
  'df -h':         '/dev/root  29G  8.2G  19G  30% /',
  'git status':    'On branch main\nnothing to commit, working tree clean',
  'git log --oneline -5': 'a1b2c3d feat: add config\ne4f5a6b feat: implement model\n7c8d9e0 init: project structure',
  'pip list':      'Package              Version\n-------------------- -------\nnumpy                1.24.3\nopencv-python        4.8.0\npicamera2            0.3.12',
};

function termKey(ev) {
  if (ev.key !== 'Enter') return;
  const input  = document.getElementById('t-input');
  const cmd    = input.value.trim();
  input.value  = '';
  const body   = document.getElementById('term-body');
  const row    = document.getElementById('t-input-row');
  const prompt = document.getElementById('t-prompt-span').textContent;

  const cmdEl = document.createElement('div');
  cmdEl.className = 't-line';
  cmdEl.innerHTML = `<span class="t-prompt">${prompt}</span> ${escAttr(cmd)}`;
  body.insertBefore(cmdEl, row);

  if (!cmd) { body.scrollTop = body.scrollHeight; return; }
  if (cmd === 'clear') {
    Array.from(body.children).forEach(c => { if (c !== row) c.remove(); });
    return;
  }

  const res = document.createElement('div');
  res.className = 't-line';

  if (cmd.startsWith('python') && cmd.includes('main.py')) {
    res.innerHTML =
      '<span style="color:#8b949e">[INFO] Loading model: mobilenet_v2_imx500.rpk</span>\n' +
      '<span style="color:#8b949e">[INFO] Device: /dev/video0</span>\n' +
      '<span style="color:#1D9E75">[INFO] Inference running \u2014 28.4 fps</span>\n' +
      '<span style="color:#8b949e">^C</span>';
    res.style.whiteSpace = 'pre';
  } else if (cmd === 'exit' || cmd === 'logout') {
    res.innerHTML = '<span class="t-dim">Connection closed.</span>';
  } else if (TERM_RESPONSES[cmd]) {
    res.textContent = TERM_RESPONSES[cmd];
    res.style.whiteSpace = 'pre';
  } else if (cmd.startsWith('cd ')) {
    const dir = cmd.slice(3);
    termCwd = dir.startsWith('~') ? dir : termCwd + '/' + dir;
    const sh = document.getElementById('term-host').textContent.replace(/^.*@/, '');
    document.getElementById('t-prompt-span').textContent = `${connUser}@${sh}:${termCwd}$ `;
    body.scrollTop = body.scrollHeight;
    return;
  } else if (cmd.startsWith('cat ')) {
    const fname = cmd.slice(4);
    if (FILES[fname]) { res.textContent = FILES[fname]; res.style.whiteSpace = 'pre'; }
    else res.innerHTML = `<span class="t-err">cat: ${escAttr(fname)}: No such file or directory</span>`;
  } else {
    res.innerHTML = `<span class="t-err">bash: ${escAttr(cmd)}: command not found</span>`;
  }

  body.insertBefore(res, row);
  body.scrollTop = body.scrollHeight;
}

// ============================================================
// Utilities
// ============================================================

/** Escape HTML for use inside text content or attribute values. */
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Init
// ============================================================

// Render saved connections from localStorage on page load
const initList = getConnections();
renderSavedList(0);
if (initList.length > 0) fillForm(initList[0]);

// Pre-render editor so it isn't blank if IDE opens
document.getElementById('editor-ta').value = FILES['main.py'];
refreshHighlight('main.py', FILES['main.py']);
refreshGutter(FILES['main.py']);
