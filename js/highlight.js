// Syntax highlighting for the prototype editor.
// Supports Python with basic token coloring.
// In production this would be replaced by a proper LSP + Monaco renderer.

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Find index of first '#' comment that is not inside a string. */
function findComment(line) {
  let inStr = false, ch = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!inStr && (c === '"' || c === "'")) { inStr = true; ch = c; }
    else if (inStr && c === ch && line[i - 1] !== '\\') { inStr = false; }
    else if (!inStr && c === '#') return i;
  }
  return -1;
}

/** Apply token colors to a single line of code (no comment part). */
function hlCode(s) {
  const KW = /\b(import|from|def|class|if|elif|else|return|while|for|in|as|with|try|except|pass|True|False|None|and|or|not|is|lambda|raise|yield|break|continue|global|del|assert|async|await)\b/g;
  const BI = /\b(print|len|range|str|int|float|list|dict|set|tuple|bool|type|isinstance|open|zip|sorted|enumerate|sum|min|max|abs|round|super|staticmethod|classmethod)\b/g;

  // strings first to avoid keyword matches inside strings
  s = s.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    '<span style="color:#a5d6ff">$1</span>');
  s = s.replace(/(@\w+)/g,        '<span style="color:#ffa657">$1</span>');
  s = s.replace(KW,               '<span style="color:#ff7b72">$1</span>');
  s = s.replace(BI,               '<span style="color:#79c0ff">$1</span>');
  s = s.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');
  return s;
}

/** Highlight a full Python source string, returns HTML string. */
function hlPython(code) {
  return code.split('\n').map(line => {
    const ci = findComment(line);
    const codePart = ci >= 0 ? line.slice(0, ci) : line;
    const cmPart   = ci >= 0 ? line.slice(ci)    : '';
    const cmHtml   = cmPart
      ? `<span style="color:#8b949e;font-style:italic">${esc(cmPart)}</span>`
      : '';
    return hlCode(esc(codePart)) + cmHtml;
  }).join('\n');
}

/** Dispatch to the right highlighter by filename. */
function highlight(filename, content) {
  if (filename.endsWith('.py')) return hlPython(content);
  return esc(content);
}
