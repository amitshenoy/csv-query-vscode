'use strict';
/* CSV Query webview script. Loaded as an external file via asWebviewUri — no inline
   script and no CSP nonce, so there is nothing for the host to silently block.
   First actions: hide the "script has not run" banner and tell the extension we are
   ready, BEFORE wiring anything else, so a later error can never look like a dead panel. */
const vscode = acquireVsCodeApi();
function post(t, d) { vscode.postMessage(Object.assign({ type: t }, d || {})); }
window.addEventListener('error', function (e) { post('clientError', { message: String((e && e.message) || 'unknown webview error') }); });
var banner = document.getElementById('scriptStatus');
if (banner) banner.style.display = 'none';
post('ready', {});

let result = { columns: [], rows: [] }, page = 0, sortCol = -1, sortDir = 1, filterText = '';
let server = { paged: false, total: 0, offset: 0, pageSize: 1000 };
const PAGE = 500;
function el(id) { return document.getElementById(id); }
function sql() { return el('sql').value; }

el('run').addEventListener('click', function () { post('run', { sql: sql() }); });
el('export').addEventListener('click', function () { post('export', {}); });
el('reload').addEventListener('click', function () { post('reload', {}); });
el('addFile').addEventListener('click', function () { post('addFile', {}); });
el('clearSql').addEventListener('click', function () { el('sql').value = ''; });
el('fmt').addEventListener('click', function () {
  el('sql').value = sql().replace(/\s+/g, ' ').replace(/ (FROM|WHERE|GROUP BY|ORDER BY|LEFT JOIN|HAVING|LIMIT) /gi, '\n$1 ');
});
el('delim').addEventListener('change', function (e) { post('setDelimiter', { delimiter: e.target.value }); });
el('hdr').addEventListener('change', function (e) { post('setHeader', { hasHeader: e.target.checked }); });
document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post('run', { sql: sql() }); });
el('filter').addEventListener('input', function (e) { filterText = e.target.value.toLowerCase(); page = 0; render(); });
el('prev').addEventListener('click', function () { if (server.paged) { if (server.offset > 0) post('page', { offset: Math.max(0, server.offset - server.pageSize) }); } else if (page > 0) { page--; render(); } });
el('next').addEventListener('click', function () { if (server.paged) { if (server.offset + server.pageSize < server.total) post('page', { offset: server.offset + server.pageSize }); } else { page++; render(); } });

function esc(v) { return String(v).replace(/</g, '&lt;'); }
function visibleRows() {
  let r = result.rows;
  if (filterText) r = r.filter(function (row) { return row.some(function (v) { return (v == null ? '' : v).toLowerCase().includes(filterText); }); });
  if (sortCol >= 0) r = r.slice().sort(function (a, b) { return sortDir * ((a[sortCol] == null ? '' : a[sortCol]) < (b[sortCol] == null ? '' : b[sortCol]) ? -1 : (a[sortCol] == null ? '' : a[sortCol]) > (b[sortCol] == null ? '' : b[sortCol]) ? 1 : 0); });
  return r;
}
function render() {
  const rows = visibleRows();
  if (server.paged) {
    el('page').textContent = 'Rows ' + (rows.length ? (server.offset + 1).toLocaleString() + '–' + (server.offset + rows.length).toLocaleString() : '0') + ' of ' + server.total.toLocaleString() + ' · Prev/Next move through the whole result (sorting/filtering apply to this page — use ORDER BY / WHERE in SQL for the whole set)';
    if (!result.columns.length) { el('grid').innerHTML = ''; return; }
    let h = '<table><thead><tr><th>#</th>' + result.columns.map(function (c, i) { return '<th data-i="' + i + '">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
    h += rows.map(function (r, ri) { return '<tr><td>' + (server.offset + ri + 1) + '</td>' + r.map(function (v) { return v === null ? '<td class="null">NULL</td>' : '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    const g = el('grid'); g.innerHTML = h;
    g.querySelectorAll('th[data-i]').forEach(function (th) { th.addEventListener('click', function () { const i = +th.dataset.i; if (sortCol === i) sortDir *= -1; else { sortCol = i; sortDir = 1; } render(); }); });
    g.querySelectorAll('td').forEach(function (td) { td.addEventListener('dblclick', function () { if (navigator.clipboard) navigator.clipboard.writeText(td.textContent); }); });
    return;
  }
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (page >= pages) page = pages - 1;
  const slice = rows.slice(page * PAGE, (page + 1) * PAGE);
  el('page').textContent = 'Page ' + (page + 1) + ' / ' + pages + ' · ' + rows.length + ' shown rows';
  if (!result.columns.length) { el('grid').innerHTML = ''; return; }
  let h = '<table><thead><tr><th>#</th>' + result.columns.map(function (c, i) { return '<th data-i="' + i + '">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
  h += slice.map(function (r, ri) {
    return '<tr><td>' + (page * PAGE + ri + 1) + '</td>' + r.map(function (v) { return v === null ? '<td class="null">NULL</td>' : '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';
  }).join('') + '</tbody></table>';
  const g = el('grid'); g.innerHTML = h;
  g.querySelectorAll('th[data-i]').forEach(function (th) { th.addEventListener('click', function () { const i = +th.dataset.i; if (sortCol === i) sortDir *= -1; else { sortCol = i; sortDir = 1; } render(); }); });
  g.querySelectorAll('td').forEach(function (td) { td.addEventListener('dblclick', function () { if (navigator.clipboard) navigator.clipboard.writeText(td.textContent); }); });
}

window.addEventListener('message', function (e) {
  const m = e.data; if (!m || typeof m.type !== 'string') return;
  if (m.type === 'source') { el('source').textContent = m.text; el('delim').value = m.delimiter; el('hdr').checked = m.hasHeader; el('tables').textContent = m.tables || ''; }
  if (m.type === 'result') { result = { columns: m.columns, rows: m.rows }; server = { paged: !!m.paged, total: (m.total != null ? m.total : m.rows.length), offset: m.offset || 0, pageSize: m.pageSize || 1000 }; if (!m.keepView) { page = 0; sortCol = -1; filterText = ''; el('filter').value = ''; } el('meta').textContent = m.meta; const s = el('status'); s.textContent = m.meta; s.className = 'status'; render(); }
  if (m.type === 'error') { const s = el('status'); s.textContent = m.text; s.className = 'status error'; }
  if (m.type === 'history') {
    el('history').innerHTML = m.items.map(function (h, i) { return '<div class="hist" data-i="' + i + '">' + (h.pinned ? '📌 ' : '') + new Date(h.ts).toLocaleString() + ' · ' + esc(h.source) + ' — ' + esc(h.sql).slice(0, 120) + '</div>'; }).join('');
    el('history').querySelectorAll('.hist').forEach(function (node) { node.addEventListener('click', function () { el('sql').value = m.items[+node.dataset.i].sql; }); });
  }
  if (m.type === 'setSql') { el('sql').value = m.sql; }
});
