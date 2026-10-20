// ══ CODE NOTES ══════════════════════════════════════════════════════════════
// A Knowledge Hub kind (CODE_NOTE, migration 078) whose note is Markdown
// (content_format 'markdown'). Scripts and queries sit in fenced code blocks,
// each shown with colours and its own Copy button; a bold line right above a
// block is that block's label. `{{name}}` or `{{name:default}}` inside a block
// is a blank, filled in when the block is copied. `[[Other note]]` links to the
// item with that title and `![[file.xlsx]]` to a document of this item.
//
// Rendering is marked → DOMPurify (sanitizeCodeNoteHtml) → the DOM pass below.
// highlight.js only ever sees a block's plain text, and escapes what it returns.
//
// Notes come in one at a time through the editor, or many at once through
// Import .md (one item per file, title from the file name), and go out again
// through Export .md, so nothing is locked in the app.
const CODE_NOTE_TYPE = 'CODE_NOTE';
const CODE_NOTE_LANGUAGES = [
  ['sql', 'SQL'], ['powershell', 'PowerShell'], ['bash', 'Bash'], ['javascript', 'JavaScript'],
  ['python', 'Python'], ['json', 'JSON'], ['xml', 'XML'],
];
const CODE_NOTE_LANGUAGE_ALIASES = {
  tsql: 'sql', mssql: 'sql', plsql: 'sql', mysql: 'sql', pgsql: 'sql', postgres: 'sql', postgresql: 'sql',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell', sh: 'bash', shell: 'bash', zsh: 'bash',
  js: 'javascript', node: 'javascript', py: 'python', html: 'xml',
};
// {{name}} or {{name:default}}: the name is any text without braces, a colon or
// a line break (trimmed); the default runs to the closing braces.
const CODE_NOTE_BLANK = /\{\{\s*([^{}:\n]+?)\s*(?::([^{}\n]*))?\}\}/g;
// Obsidian's embed: ![[file.xlsx]], ![[folder/file.xlsx|label]].
const CODE_NOTE_EMBED = /!\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g;
const CODE_NOTE_MAX_CHARS = 200000;
let knowledgeEditorFormat = 'text';   // the open editor's stored format (knowledge.js)
let codeNoteMarked = null, codeNoteFill = null, codeNoteImport = null, codeNoteImportReady = false;

function isCodeNoteItem(item) { return item?.contentFormat === 'markdown' || item?.type === CODE_NOTE_TYPE; }

// ── Blanks ──
// Each name once, in order of first use; a default given anywhere counts.
function codeNoteBlanks(text) {
  const blanks = new Map();
  for (const match of String(text || '').matchAll(CODE_NOTE_BLANK)) {
    const name = match[1].trim(), fallback = match[2] != null ? match[2].trim() : '';
    if (!blanks.has(name)) blanks.set(name, { name, fallback });
    else if (!blanks.get(name).fallback) blanks.get(name).fallback = fallback;
  }
  return [...blanks.values()];
}
// An empty value falls back to the blank's default; with neither, the blank stays.
function fillCodeNoteBlanks(text, values) {
  return String(text || '').replace(CODE_NOTE_BLANK, (whole, name, fallback) => {
    const value = values[name.trim()];
    if (value != null && value !== '') return value;
    return fallback != null && fallback.trim() ? fallback.trim() : whole;
  });
}

// ── Rendering ──
function codeNoteLanguage(raw) {
  const lang = String(raw || '').trim().toLowerCase().split(/\s+/)[0] || '';
  const resolved = CODE_NOTE_LANGUAGE_ALIASES[lang] || lang;
  return resolved && window.hljs?.getLanguage(resolved) ? resolved : '';
}
function codeNoteLanguageLabel(lang) {
  return CODE_NOTE_LANGUAGES.find(([code]) => code === lang)?.[1] || lang.toUpperCase();
}
function codeNoteParser() {
  if (codeNoteMarked) return codeNoteMarked;
  codeNoteMarked = new window.marked.Marked({ gfm: true, breaks: false });
  // [[Note]], [[Note|label]] and ![[file]] become fragment links; the DOM pass
  // turns them into working links once it knows what exists.
  codeNoteMarked.use({ extensions: [{
    name: 'wikilink', level: 'inline',
    start(src) {
      const index = src.indexOf('[[');
      if (index < 0) return undefined;
      return index > 0 && src[index - 1] === '!' ? index - 1 : index;
    },
    tokenizer(src) {
      const match = /^(!?)\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/.exec(src);
      if (!match) return undefined;
      return { type: 'wikilink', raw: match[0], embed: !!match[1], target: match[2].trim(), label: (match[3] || '').trim() };
    },
    renderer(token) {
      const href = (token.embed ? '#kh-file:' : '#kh-note:') + encodeURIComponent(token.target);
      return `<a class="${token.embed ? 'cn-embed' : 'cn-wikilink'}" href="${href}">${esc(token.label || token.target)}</a>`;
    },
  }] });
  return codeNoteMarked;
}
function codeNoteDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
function codeNoteBaseName(value) { return String(value || '').split(/[\\/]/).pop().trim(); }
// [[Folder/Note.md]] finds the item titled "Note", ignoring case.
function codeNoteFindItem(target) {
  const title = codeNoteBaseName(target).replace(/\.(md|markdown)$/i, '').toLowerCase();
  return knowledgeItems.find(item => item.title.trim().toLowerCase() === title) || null;
}
// ![[Checklist.xlsx]] finds the latest version of that document on the item.
function codeNoteFindAttachment(item, target) {
  const name = codeNoteBaseName(target).toLowerCase(), key = knowledgeDocKey(name, true);
  const matches = (item?.documents || []).filter(file => String(file.originalName || '').toLowerCase() === name
    || knowledgeDocKey(file.name) === key);
  return matches.sort(knowledgeVersionCompare)[0] || null;
}
// opts.preview: the editor's preview, where links do nothing.
function renderCodeNoteContent(host, markdown, item, opts = {}) {
  host.classList.remove('kh-content-text', 'kh-content-html'); host.classList.add('kh-content-md');
  let html = '';
  try { html = sanitizeCodeNoteHtml(codeNoteParser().parse(String(markdown || ''))); } catch { html = ''; }
  host.innerHTML = html;
  if (!host.childElementCount) { host.appendChild(pjMk('p', 'kh-detail-summary', 'Your formatted preview will appear here.')); return; }
  // Arabic paragraphs read right to left; code always reads left to right.
  host.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, th, td').forEach(el => el.setAttribute('dir', 'auto'));
  host.querySelectorAll('a[href]').forEach(link => wireCodeNoteLink(link, item, opts));
  host.querySelectorAll('pre').forEach(pre => buildCodeNoteBlock(pre, item));
  [...host.children].forEach(el => { if (!el.classList.contains('cn-block')) el.dataset.userContent = ''; });
}
function prependCodeNoteIcon(el, name) {
  const holder = document.createElement('span'); holder.innerHTML = ic(name);
  el.prepend(holder.firstChild);
}
function wireCodeNoteLink(link, item, opts) {
  const href = link.getAttribute('href') || '';
  let open = null;
  if (href.startsWith('#kh-note:')) {
    const target = codeNoteFindItem(codeNoteDecode(href.slice(9)));
    link.classList.toggle('missing', !target);
    if (target) open = () => openKnowledgeInHub(target.id);
    else open = () => toast('No item has this title yet');
  } else if (href.startsWith('#kh-file:')) {
    const file = codeNoteFindAttachment(item, codeNoteDecode(href.slice(9)));
    link.classList.toggle('missing', !file);
    prependCodeNoteIcon(link, file ? 'file-text' : 'triangle-alert');
    if (file) open = () => openKnowledgeAttachment(file.id);
    else open = () => toast('This file is not attached to the item');
  } else {
    link.title = href;
    if (/^https?:\/\//i.test(href)) open = () => window.api.openExternal(href);
  }
  link.addEventListener('click', event => { event.preventDefault(); if (open && !opts.preview) open(); });
}
// Wraps every {{blank}} in a block's text in a <mark>, after highlighting.
function markCodeNoteBlanks(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('{{')) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const text = node.nodeValue, fragment = document.createDocumentFragment(); let last = 0;
    for (const match of text.matchAll(CODE_NOTE_BLANK)) {
      fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
      fragment.appendChild(pjMk('mark', 'cn-blank', match[0]));
      last = match.index + match[0].length;
    }
    if (!last) return;
    fragment.appendChild(document.createTextNode(text.slice(last)));
    node.replaceWith(fragment);
  });
}
// Puts the blanks taken out before highlighting back, each in a <mark>.
function restoreCodeNoteBlanks(root, found) {
  if (!found.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('cnblank')) nodes.push(walker.currentNode);
  nodes.forEach(node => {
    const fragment = document.createDocumentFragment();
    node.nodeValue.split(/(cnblank\d+x)/).forEach(part => {
      const match = /^cnblank(\d+)x$/.exec(part);
      if (match && found[Number(match[1])] != null) fragment.appendChild(pjMk('mark', 'cn-blank', found[Number(match[1])]));
      else if (part) fragment.appendChild(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  });
}
function buildCodeNoteBlock(pre, item) {
  const source = pre.querySelector('code') || pre;
  const text = source.textContent.replace(/\n$/, '');
  const lang = codeNoteLanguage((source.className.match(/language-(\S+)/) || [])[1]);
  // A paragraph that is nothing but bold text, right above the block, labels it.
  let label = '';
  const prev = pre.previousElementSibling;
  if (prev?.tagName === 'P' && prev.childElementCount === 1 && prev.firstElementChild.tagName === 'STRONG'
      && prev.textContent.trim() === prev.firstElementChild.textContent.trim()) {
    label = prev.textContent.trim().replace(/\s*:$/, '');
    prev.remove();
  }
  const block = pjMk('div', 'cn-block'), head = pjMk('div', 'cn-block-head');
  if (label) { const name = pjMk('span', 'cn-block-label', label); name.dataset.userContent = ''; name.dir = 'auto'; head.appendChild(name); }
  else head.appendChild(pjMk('span', 'cn-block-label cn-block-label-empty'));
  if (lang) { const tag = pjMk('span', 'cn-block-lang', codeNoteLanguageLabel(lang)); tag.dataset.userContent = ''; head.appendChild(tag); }
  const blanks = codeNoteBlanks(text);
  if (blanks.length) {
    const names = pjMk('span', 'cn-block-blanks'); names.title = 'Blanks you fill in when you copy';
    prependCodeNoteIcon(names, 'braces');
    const list = pjMk('span', '', blanks.map(blank => blank.name).join(' · ')); list.dataset.userContent = '';
    names.appendChild(list); head.appendChild(names);
  }
  const copy = pjMk('button', 'btn small cn-copy'); copy.type = 'button';
  copy.innerHTML = ic('copy'); copy.appendChild(pjMk('span', '', blanks.length ? 'Fill & copy' : 'Copy'));
  copy.title = blanks.length ? 'Fill in the blanks, then copy' : 'Copy this block';
  copy.onclick = () => copyCodeNoteBlock(text, label, item);
  head.appendChild(copy);
  const code = pjMk('pre', 'cn-code'); code.dir = 'ltr'; code.dataset.userContent = '';
  const inner = document.createElement('code'); inner.className = 'hljs' + (lang ? ' language-' + lang : '');
  // Blanks are swapped for plain words before highlighting, so a grammar can't
  // split one across tokens ("{{days:30}}" would lose its number), and back after.
  const found = [];
  const swapped = text.replace(CODE_NOTE_BLANK, whole => `cnblank${found.push(whole) - 1}x`);
  let highlighted = esc(swapped);
  if (lang) { try { highlighted = window.hljs.highlight(swapped, { language: lang, ignoreIllegals: true }).value; } catch { highlighted = esc(swapped); } }
  inner.innerHTML = highlighted;
  restoreCodeNoteBlanks(inner, found);
  code.appendChild(inner);
  block.append(head, code);
  pre.replaceWith(block);
}

// ── Copy ──
async function writeCodeNoteClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const area = document.createElement('textarea');
      area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.focus(); area.select();
      const copied = document.execCommand('copy'); area.remove(); return copied;
    } catch { return false; }
  }
}
async function copyCodeNoteBlock(text, label, item) {
  const blanks = codeNoteBlanks(text);
  if (blanks.length) { openCodeNoteFill(text, label, item, blanks); return; }
  toast(await writeCodeNoteClipboard(text) ? 'Code copied' : 'Could not copy to clipboard');
}

// ── Fill in the blanks ──
// The last values used are remembered per item (uiState.codeNoteValues, keyed
// 'n' + id so the keys keep their insertion order; the oldest drop off past 200).
function codeNoteRemembered(itemId) {
  const all = uiState.codeNoteValues;
  return itemId && all && typeof all === 'object' && all['n' + itemId] && typeof all['n' + itemId] === 'object' ? all['n' + itemId] : {};
}
function rememberCodeNoteValues(itemId, values) {
  if (!itemId) return;
  const all = uiState.codeNoteValues && typeof uiState.codeNoteValues === 'object' ? uiState.codeNoteValues : {};
  const key = 'n' + itemId, merged = { ...codeNoteRemembered(itemId) };
  Object.entries(values).forEach(([name, value]) => { if (value !== '') merged[name] = String(value).slice(0, 500); });
  delete all[key]; all[key] = merged;
  Object.keys(all).slice(0, Math.max(0, Object.keys(all).length - 200)).forEach(old => delete all[old]);
  uiState.codeNoteValues = all; saveUiStateDebounced();
}
function codeNoteSuggestionKind(name) {
  if (/database|catalog|^db|db$|_db|db_/i.test(name)) return 'databases';
  if (/server|host|instance|^ip$|_ip$|^ip_/i.test(name)) return 'servers';
  return '';
}
function openCodeNoteFill(text, label, item, blanks) {
  const itemId = item?.id || null, remembered = codeNoteRemembered(itemId);
  codeNoteFill = { text, itemId };
  const caption = document.getElementById('cn-fill-label');
  caption.textContent = label; caption.hidden = !label;
  const host = document.getElementById('cn-fill-fields'); host.innerHTML = '';
  blanks.forEach((blank, index) => {
    const row = pjMk('div', 'form-group full cn-fill-row'), id = 'cn-fill-' + index;
    const name = pjMk('label', 'cn-fill-name', blank.name); name.htmlFor = id; name.dataset.userContent = '';
    const input = document.createElement('input');
    input.id = id; input.maxLength = 500; input.autocomplete = 'off'; input.spellcheck = false; input.dir = 'ltr';
    input.dataset.blank = blank.name; input.dataset.i18nIgnore = '';
    input.value = remembered[blank.name] ?? blank.fallback;
    if (blank.fallback) input.placeholder = blank.fallback;
    input.oninput = () => { clearFieldError(input); updateCodeNoteFillPreview(); };
    row.append(name, input); host.appendChild(row);
  });
  updateCodeNoteFillPreview();
  const overlay = document.getElementById('code-note-fill-overlay');
  overlay.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCodeNoteFill(); }
    else if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); submitCodeNoteFill(); }
  };
  overlay.classList.add('open');
  setTimeout(() => {
    const inputs = [...host.querySelectorAll('input')];
    (inputs.find(input => !input.value) || inputs[0])?.focus();
  }, 50);
  // Suggestions arrive after the form is open, so a slow answer never holds it up.
  if (itemId && blanks.some(blank => codeNoteSuggestionKind(blank.name))) {
    window.api.codeNoteSuggestions(itemId).then(found => {
      if (codeNoteFill?.itemId !== itemId) return;
      host.querySelectorAll('input[data-blank]').forEach((input, index) => {
        const values = found?.[codeNoteSuggestionKind(input.dataset.blank)] || [];
        if (!values.length) return;
        const list = document.createElement('datalist'); list.id = 'cn-fill-list-' + index;
        values.forEach(value => { const option = document.createElement('option'); option.value = value; option.dataset.userContent = ''; list.appendChild(option); });
        input.after(list); input.setAttribute('list', list.id);
      });
    }).catch(() => {});
  }
}
function codeNoteFillValues() {
  const values = {};
  document.querySelectorAll('#cn-fill-fields input[data-blank]').forEach(input => { values[input.dataset.blank] = input.value; });
  return values;
}
function updateCodeNoteFillPreview() {
  if (!codeNoteFill) return;
  const preview = document.getElementById('cn-fill-preview');
  preview.textContent = fillCodeNoteBlanks(codeNoteFill.text, codeNoteFillValues());
  markCodeNoteBlanks(preview);
}
async function submitCodeNoteFill() {
  if (!codeNoteFill) return;
  clearErrorsIn('#code-note-fill-modal');
  const values = codeNoteFillValues(), blanks = codeNoteBlanks(codeNoteFill.text);
  const empty = [...document.querySelectorAll('#cn-fill-fields input[data-blank]')]
    .filter(input => !input.value.trim() && !blanks.find(blank => blank.name === input.dataset.blank)?.fallback);
  if (empty.length) { empty.forEach(input => markError(input.id, 'Fill in this blank.')); empty[0].focus(); return; }
  const { text, itemId } = codeNoteFill;
  if (!await writeCodeNoteClipboard(fillCodeNoteBlanks(text, values))) { toast('Could not copy to clipboard'); return; }
  rememberCodeNoteValues(itemId, values);
  closeCodeNoteFill();
  toast('Filled in and copied');
}
function closeCodeNoteFill() {
  codeNoteFill = null;
  document.getElementById('code-note-fill-overlay').classList.remove('open');
}
function codeNoteFillOverlayClick(event) { if (event.target === document.getElementById('code-note-fill-overlay')) closeCodeNoteFill(); }

// ── Editor ──
// The editor turns into a Markdown editor for a Code Note, or for any item
// already stored as Markdown: monospace text, a toolbar and a preview.
function codeNoteEditorActive() {
  return document.getElementById('kh-type-input').value === CODE_NOTE_TYPE || knowledgeEditorFormat === 'markdown';
}
function syncCodeNoteEditor() {
  const on = codeNoteEditorActive();
  document.getElementById('kh-md-toolbar').hidden = !on;
  document.getElementById('kh-notes-input').classList.toggle('kh-notes-md', on);
  document.getElementById('kh-notes-label').textContent = on ? 'Note (Markdown)' : 'Notes';
  document.getElementById('kh-notes-hint-text').hidden = on;
  document.getElementById('kh-notes-hint-md').hidden = !on;
  if (!on) showCodeNotePreview(false);
}
function showCodeNotePreview(show) {
  const input = document.getElementById('kh-notes-input'), preview = document.getElementById('kh-md-preview');
  const button = document.getElementById('kh-md-preview-btn');
  preview.hidden = !show; input.hidden = show;
  button.classList.toggle('active', show); button.setAttribute('aria-pressed', String(show));
  document.querySelectorAll('#kh-md-toolbar [data-md-edit]').forEach(el => { el.disabled = show; });
  if (show) {
    const item = knowledgeCurrentItem?.id === knowledgeEditId ? knowledgeCurrentItem : knowledgeItems.find(entry => entry.id === knowledgeEditId);
    renderCodeNoteContent(preview, input.value, item, { preview: true });
  } else preview.innerHTML = '';
}
function toggleCodeNotePreview() { showCodeNotePreview(document.getElementById('kh-md-preview').hidden); }
// Replaces [start, end) of the note through the browser's own editing, so
// Ctrl+Z still undoes it, then selects [selectFrom, selectTo) of the new text.
function replaceCodeNoteText(start, end, text, selectFrom = text.length, selectTo = selectFrom) {
  const input = document.getElementById('kh-notes-input');
  input.focus(); input.setSelectionRange(start, end);
  let done = false;
  try { done = document.execCommand('insertText', false, text); } catch { done = false; }
  if (!done || input.value.slice(start, start + text.length) !== text) input.setRangeText(text, start, end, 'end');
  input.setSelectionRange(start + selectFrom, start + selectTo);
  markKnowledgeEditorDirty();
}
// Text placed on lines of its own: a line break is added before / after only
// where the neighbouring text is not already one.
function codeNoteOwnLines(value, start, end, text) {
  const before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const after = end < value.length && value[end] !== '\n' ? '\n' : '';
  return { text: before + text + after, offset: before.length };
}
function codeNoteBold() {
  const input = document.getElementById('kh-notes-input'), start = input.selectionStart, end = input.selectionEnd;
  const selected = input.value.slice(start, end) || 'bold text';
  replaceCodeNoteText(start, end, '**' + selected + '**', 2, 2 + selected.length);
}
// Heading and list work on every line the selection touches; pressing again
// takes the marker off.
function codeNoteLinePrefix(prefix) {
  const input = document.getElementById('kh-notes-input'), value = input.value;
  const start = value.lastIndexOf('\n', input.selectionStart - 1) + 1;
  let end = value.indexOf('\n', input.selectionEnd); if (end < 0) end = value.length;
  const lines = value.slice(start, end).split('\n');
  const marker = prefix.startsWith('#') ? /^#{1,6}\s+/ : /^\s*[-*+]\s+/;
  const all = lines.every(line => line.startsWith(prefix));
  const next = lines.map(line => all ? line.slice(prefix.length) : prefix + line.replace(marker, '')).join('\n');
  replaceCodeNoteText(start, end, next, 0, next.length);
}
function codeNoteHeading() { codeNoteLinePrefix('## '); }
function codeNoteList() { codeNoteLinePrefix('- '); }
function codeNoteCodeBlock() {
  const input = document.getElementById('kh-notes-input'), start = input.selectionStart, end = input.selectionEnd;
  const lang = document.getElementById('kh-md-lang').value, selected = input.value.slice(start, end).replace(/\n$/, '');
  const fence = '```' + lang + '\n';
  const placed = codeNoteOwnLines(input.value, start, end, fence + selected + '\n```');
  const at = placed.offset + fence.length;
  replaceCodeNoteText(start, end, placed.text, at, at + selected.length);
}
function codeNoteSeparator() {
  const input = document.getElementById('kh-notes-input'), start = input.selectionStart, end = input.selectionEnd;
  const placed = codeNoteOwnLines(input.value, start, end, '\n---\n');
  replaceCodeNoteText(start, end, placed.text);
}
// The selected value becomes {{value}} everywhere it appears as a whole word,
// except inside a blank that already exists. One Ctrl+Z puts it all back.
function makeCodeNoteBlank() {
  const input = document.getElementById('kh-notes-input');
  const raw = input.value.slice(input.selectionStart, input.selectionEnd).trim();
  if (!raw || /[\n{}]/.test(raw)) { toast('Select a value first, such as a database name'); return; }
  const token = '{{' + raw.replace(/:/g, '_') + '}}';
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = /[\p{L}\p{N}_]/u;
  const pattern = new RegExp((word.test(raw[0]) ? '(?<![\\p{L}\\p{N}_])' : '') + escaped
    + (word.test(raw[raw.length - 1]) ? '(?![\\p{L}\\p{N}_])' : ''), 'gu');
  let count = 0;
  const next = input.value.split(/(\{\{[^{}\n]*\}\})/).map((part, index) => index % 2 ? part
    : part.replace(pattern, () => { count++; return token; })).join('');
  if (!count) { toast('Select a value first, such as a database name'); return; }
  replaceCodeNoteText(0, input.value.length, next);
  toast(count === 1 ? 'Made 1 blank' : `Made ${count} blanks`);
}

// ── Export ──
async function exportKnowledgeMarkdown(item) {
  let result; try { result = await window.api.exportKnowledgeMarkdown(item.id); } catch { result = null; }
  if (result?.ok) toast('Note saved as a .md file');
  else if (!result?.canceled) toast(result?.error || 'Could not export the note');
}

// ── Import .md ──
// Many files at once, picked or dropped. Every .md file is one note; any other
// file in the same selection is attached to the notes that embed it. Nothing
// is saved until Import, and the import can be undone from its toast.
function isCodeNoteMarkdownFile(file) { return /\.(md|markdown)$/i.test(String(file?.name || '')); }
// Files embedded in a note: ![[name.ext]], not other notes (![[Note]] / .md).
function codeNoteEmbeds(markdown) {
  const names = new Map();
  for (const match of String(markdown || '').matchAll(CODE_NOTE_EMBED)) {
    const name = codeNoteBaseName(match[1]);
    if (/\.[a-z0-9]{1,8}$/i.test(name) && !/\.(md|markdown)$/i.test(name) && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}
function setupCodeNoteImport() {
  if (codeNoteImportReady) return;
  codeNoteImportReady = true;
  setupKnowledgeTagInput(document.getElementById('cn-import-tags-input'),
    value => { if (codeNoteImport && pushKnowledgeTag(codeNoteImport.tags, value)) { codeNoteImport.tagsTouched = true; renderCodeNoteImport(); } },
    () => { if (codeNoteImport?.tags.length) { codeNoteImport.tags.pop(); codeNoteImport.tagsTouched = true; renderCodeNoteImport(); } });
  const input = document.getElementById('cn-import-input'), zone = document.getElementById('cn-import-drop');
  input.onchange = () => { addCodeNoteImportFiles(input.files); input.value = ''; };
  zone.addEventListener('dragover', event => { if (!knowledgeDragHasFiles(event)) return; event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('over');
    addCodeNoteImportFiles(event.dataTransfer?.files || []);
  });
}
function openCodeNoteImport(files) {
  setupCodeNoteImport();
  codeNoteImport = { files: [], rows: [], busy: false, tags: [], tagsTouched: false };
  fillKnowledgeTagSuggestions('cn-import-tag-suggestions');
  // Opened from a filtered Hub (a system's or a client's page), the import starts linked to it.
  const preset = kind => [...knowledgeFilters].filter(key => key.startsWith(kind + ':')).map(key => Number(key.slice(kind.length + 1))).filter(Number.isInteger);
  const systems = preset('SYSTEM'), clients = preset('CLIENT');
  if (systems.length) setCodeNoteImportLink('SYSTEM', systems);
  else setCodeNoteImportLink(clients.length ? 'COMPANY' : 'none', clients);
  renderCodeNoteImport();
  const overlay = document.getElementById('code-note-import-overlay');
  overlay.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCodeNoteImport(); }
  };
  overlay.classList.add('open');
  if (files?.length) addCodeNoteImportFiles(files);
}
// The notes link to systems or to clients, never both; linking is optional.
function setCodeNoteImportLink(kind, selected = []) {
  if (!codeNoteImport) return;
  codeNoteImport.linkKind = kind;
  document.querySelectorAll('#cn-import-link-kind .seg-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.kind === kind));
  const host = document.getElementById('cn-import-link-picker');
  host.hidden = kind === 'none';
  if (kind === 'none') { host.innerHTML = ''; codeNoteImport.linkPicker = null; return; }
  const options = lkOptions(kind, true).filter(o => o.isActive)
    .map(o => ({ id: o.id, label: kind === 'COMPANY' ? companyDisplayName(o) : lookupDisplayName(o) }));
  codeNoteImport.linkPicker = buildTagPicker(host, options, selected, kind === 'COMPANY' ? 'Search clients…' : 'Search systems…', () => renderCodeNoteImport(), { autoSelectSingle: false });
  renderCodeNoteImport();
}
function chooseCodeNoteImportFiles() { document.getElementById('cn-import-input').click(); }
async function addCodeNoteImportFiles(list) {
  if (!codeNoteImport) return;
  const same = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  [...list].filter(file => file?.name).forEach(file => { if (!codeNoteImport.files.some(known => same(known, file))) codeNoteImport.files.push(file); });
  await buildCodeNoteImportRows();
  suggestCodeNoteImportTag();
  renderCodeNoteImport();
}
// Notes from one Obsidian folder ("Gizmos") are tagged with it, until the tags are edited by hand.
function suggestCodeNoteImportTag() {
  const state = codeNoteImport; if (!state || state.tagsTouched) return;
  const folders = new Set(state.rows.map(row => { try { return window.api.fileFolderName(row.file); } catch { return ''; } }));
  const folder = folders.size === 1 ? [...folders][0] : '';
  state.tags = [];
  if (folder) pushKnowledgeTag(state.tags, folder);
}
// A note with no client, system or tag can't be saved. A replaced note keeps what it had.
function codeNoteImportNeedsTag() {
  const state = codeNoteImport; if (!state) return false;
  if (state.tags.length || (state.linkPicker?.getSelectedIds() || []).length) return false;
  return codeNoteImportChosen().some(row => {
    const item = row.existing && row.action === 'replace' ? row.existing : null;
    return !item || !((item.companies || []).length || (item.systems || []).length || (item.tags || []).length);
  });
}
async function buildCodeNoteImportRows() {
  const state = codeNoteImport, previous = new Map(state.rows.map(row => [row.file, row]));
  const notes = state.files.filter(isCodeNoteMarkdownFile), others = state.files.filter(file => !isCodeNoteMarkdownFile(file));
  const rows = [];
  for (const file of notes) {
    let row = previous.get(file);
    if (!row) {
      let content = null;
      try { content = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); } catch { content = null; }
      const problem = content == null ? 'unreadable' : content.length > CODE_NOTE_MAX_CHARS ? 'too-long' : '';
      row = { file, content, problem, include: !problem, action: 'skip' };
    }
    rows.push(row);
  }
  // Titles come from file names; two files with one name get " (2)", " (3)"…
  const used = new Set();
  rows.forEach(row => {
    const base = row.file.name.replace(/\.(md|markdown)$/i, '').trim().slice(0, 290) || 'Untitled note';
    let title = base;
    for (let n = 2; used.has(title.toLowerCase()); n++) title = `${base} (${n})`;
    used.add(title.toLowerCase());
    row.title = title;
    row.existing = knowledgeItems.find(item => item.title.trim().toLowerCase() === title.toLowerCase()) || null;
    row.embeds = codeNoteEmbeds(row.content).map(name => ({
      name, file: others.find(file => file.name.toLowerCase() === name.toLowerCase()) || null,
    }));
  });
  state.rows = rows;
}
function codeNoteImportChosen() {
  return (codeNoteImport?.rows || []).filter(row => row.include && !row.problem && !(row.existing && row.action === 'skip'));
}
function renderCodeNoteImport() {
  const state = codeNoteImport; if (!state) return;
  const list = document.getElementById('cn-import-list'); list.innerHTML = '';
  const notes = state.rows.length, others = state.files.filter(file => !isCodeNoteMarkdownFile(file)).length;
  document.getElementById('cn-import-empty').hidden = notes > 0;
  state.rows.forEach(row => {
    const line = pjMk('div', 'cn-import-row' + (row.problem ? ' bad' : ''));
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.include; check.disabled = !!row.problem;
    check.setAttribute('aria-label', 'Import this file');
    check.onchange = () => { row.include = check.checked; renderCodeNoteImport(); };
    const copy = pjMk('div', 'cn-import-copy'), title = pjMk('b', '', row.title); title.dataset.userContent = ''; title.dir = 'auto';
    const file = pjMk('span', 'cn-import-file', row.file.name + ' · ' + fmtFileSize(row.file.size)); file.dataset.userContent = '';
    copy.append(title, file);
    row.embeds.forEach(embed => {
      const chip = pjMk('span', 'cn-import-embed' + (embed.file ? '' : ' missing'));
      prependCodeNoteIcon(chip, embed.file ? 'file-text' : 'triangle-alert');
      const name = pjMk('span', '', embed.name); name.dataset.userContent = ''; chip.appendChild(name);
      chip.appendChild(pjMk('span', 'cn-import-embed-note', embed.file ? 'attached' : 'not in this selection'));
      copy.appendChild(chip);
    });
    const status = pjMk('div', 'cn-import-status');
    if (row.problem === 'unreadable') status.appendChild(pjMk('span', 'kh-pill archived', 'Could not read'));
    else if (row.problem === 'too-long') status.appendChild(pjMk('span', 'kh-pill archived', 'Over 200,000 characters'));
    else if (row.existing) {
      status.appendChild(pjMk('span', 'kh-pill draft', 'Already in the Hub'));
      const action = document.createElement('select'); action.className = 'cn-import-action';
      action.setAttribute('aria-label', 'What to do with the item that has this title');
      [['skip', 'Skip'], ['replace', 'Replace its note']].forEach(([value, label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; action.appendChild(option);
      });
      action.value = row.action; action.disabled = !row.include;
      action.onchange = () => { row.action = action.value; renderCodeNoteImport(); };
      status.appendChild(action);
    } else status.appendChild(pjMk('span', 'kh-pill', 'New'));
    line.append(check, copy, status); list.appendChild(line);
  });
  renderKnowledgeTagTokens(document.getElementById('cn-import-tag-tokens'), state.tags, () => { state.tagsTouched = true; renderCodeNoteImport(); });
  const chosen = codeNoteImportChosen().length, needsTag = chosen > 0 && codeNoteImportNeedsTag();
  document.getElementById('cn-import-tag-field').classList.toggle('field-error', needsTag);
  document.getElementById('cn-import-count').textContent = !notes ? ''
    : needsTag ? 'Add a tag, or link the notes to systems or clients'
    : `${chosen} of ${notes} notes will be imported` + (others ? ` · ${others} other files` : '');
  const go = document.getElementById('cn-import-go');
  go.disabled = !chosen || needsTag || state.busy;
  go.textContent = chosen === 1 ? 'Import 1 note' : `Import ${chosen} notes`;
}
async function runCodeNoteImport() {
  const state = codeNoteImport, chosen = codeNoteImportChosen();
  const typed = document.getElementById('cn-import-tags-input');
  if (state && typed.value.trim()) { pushKnowledgeTag(state.tags, typed.value); typed.value = ''; state.tagsTouched = true; }
  if (!state || !chosen.length || state.busy || codeNoteImportNeedsTag()) { renderCodeNoteImport(); return; }
  const bytes = chosen.reduce((sum, row) => sum + row.content.length * 2, 0);
  if (bytes > 10 * 1024 * 1024) { toast('That is too much at once. Import fewer files.'); return; }
  state.busy = true; renderCodeNoteImport();
  let result;
  const linked = state.linkPicker?.getSelectedIds() || [];
  const companyIds = state.linkKind === 'COMPANY' ? linked : [], systemIds = state.linkKind === 'SYSTEM' ? linked : [];
  try {
    result = await window.api.importCodeNotes(chosen.map(row => ({
      title: row.title, content: row.content, replaceId: row.existing && row.action === 'replace' ? row.existing.id : null,
      companyIds, systemIds, tags: state.tags,
    })));
  } catch { result = null; }
  if (!result?.ok) { state.busy = false; renderCodeNoteImport(); toast(result?.error || 'Could not import the notes'); return; }
  // Embedded files become documents of their note. A version the note already
  // has (a replaced note imported twice) is left as it is.
  let attached = 0, notAdded = 0;
  for (const [index, row] of chosen.entries()) {
    const done = new Set();
    for (const embed of row.embeds.filter(entry => entry.file && !done.has(entry.file))) {
      done.add(embed.file);
      let upload;
      try {
        upload = await window.api.uploadKnowledgeFile(result.ids[index], embed.file, {
          name: knowledgeTitleFromFile(embed.file.name) || embed.file.name,
          version: knowledgeParseFileName(embed.file.name).version || '1.0',
        });
      } catch { upload = null; }
      if (upload?.ok) attached++;
      else if (!/already exists/i.test(upload?.error || '')) notAdded++;
    }
  }
  closeCodeNoteImport(true);
  await loadKnowledgeItems(chosen.length === 1 ? result.ids[0] : undefined);
  const token = result.token;
  let message = chosen.length === 1 ? 'Imported 1 note' : `Imported ${chosen.length} notes`;
  if (attached) message += attached === 1 ? ' · 1 file attached' : ` · ${attached} files attached`;
  if (notAdded) message += notAdded === 1 ? ' · 1 file not added' : ` · ${notAdded} files not added`;
  toast(message, {
    actionLabel: 'Undo', duration: 5000,
    onAction: async () => {
      let undone; try { undone = await window.api.undoCodeNoteImport(token); } catch { undone = null; }
      if (undone?.ok) await loadKnowledgeItems();
      toast(undone?.ok ? 'Import undone' : (undone?.error || 'Could not undo the import'));
    },
    onExpire: () => { window.api.forgetCodeNoteImport(token).catch(() => {}); },
  });
}
function closeCodeNoteImport(force) {
  if (!force && codeNoteImport?.busy) return;
  codeNoteImport = null;
  document.getElementById('code-note-import-overlay').classList.remove('open');
}
function codeNoteImportOverlayClick(event) { if (event.target === document.getElementById('code-note-import-overlay')) closeCodeNoteImport(); }
