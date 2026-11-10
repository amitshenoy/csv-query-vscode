import * as vscode from 'vscode';
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri, defaultQuery: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles.css'));
  const dq = defaultQuery.replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${styleUri}">
</head><body>
<div id="scriptStatus">⚠ The panel script has not run yet. If this message stays visible, the webview script is being blocked — please open View → Output → “CSV Query” and send me that log.</div>
<div class="bar" id="source">Loading…</div>
<div class="row"><label>Delimiter <select id="delim"><option value=",">Comma</option><option value="|">Pipe</option><option value="&#9;">Tab</option><option value=";">Semicolon</option><option value="^">Caret</option></select></label>
<label><input type="checkbox" id="hdr" checked> First row contains column names</label>
<button class="secondary" id="reload">Reload Active File</button><button class="secondary" id="addFile">Add File as Table</button></div>
<div id="tables" class="bar"></div>
<textarea id="sql">${dq}</textarea>
<div class="row"><button id="run">▶ Run (Ctrl/Cmd+Enter)</button><button class="secondary" id="fmt">Format SQL</button><button class="secondary" id="clearSql">Clear</button><button class="secondary" id="export">Export Results</button><span id="meta"></span></div>
<div class="status" id="status">Ready. Table name is THIS — e.g. SELECT * FROM THIS;</div>
<div class="row"><input id="filter" placeholder="Filter shown rows…" style="flex:1"></div>
<div class="gridwrap" id="grid"></div>
<div class="row"><button class="secondary" id="prev">‹ Prev</button><span id="page"></span><button class="secondary" id="next">Next ›</button><span>Click a header to sort · Double-click a cell to copy it</span></div>
<h3>Query history</h3><div id="history"></div>
<script src="${scriptUri}"></script>
</body></html>`;
}
