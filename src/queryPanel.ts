
import * as vscode from 'vscode'; import * as path from 'path'; import * as fs from 'fs'; import * as os from 'os';
import type { Database } from 'sql.js';
import { createDb, initEngine } from './database/sqliteEngine';
import { parseDelimited, ParsedFile } from './parser/delimitedParser';
import { loadTable, loadTableAsync, LoadedTable } from './database/tableLoader';
import { executeQuery, queryPage, stripSql } from './database/queryExecutor';
import { friendlyError } from './utils/errors';
import { toDelimited, formatRow, suggestExportFileName } from './export/resultExporter';
import { sanitizeTableName } from './utils/identifiers';
import { QueryHistory } from './history/queryHistory';
import { getHtml } from './webview/html';
import { delimiterLabel } from './parser/delimiterDetector';
import { log } from './utils/log';
import { decideReadMode, dirtyOverSyncLimit } from './utils/sourceRead';

export class QueryPanel {
  static current: QueryPanel | undefined;
  private db: Database; private tables: LoadedTable[] = []; private lastResult: any = null;
  private delimiter: string | undefined; private hasHeader: boolean | undefined;
  private sourceName = 'Untitled'; private sourceText = ''; private history: QueryHistory; private sourceUri: string | undefined;
  private webviewReady = false; private lastSql = ''; private static readonly GRID_PAGE = 1000; private pendingPosts: any[] = []; private lastSourcePost: any = null; private lastResultPost: any = null;
  private constructor(private panel: vscode.WebviewPanel, private ctx: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('csvQuery');
    this.history = new QueryHistory(cfg.get<number>('queryHistorySize', 50), ctx.globalState.get('csvQuery.history', []));
    this.db = createDb();
    panel.webview.html = getHtml(panel.webview, ctx.extensionUri, cfg.get<string>('defaultQuery', 'SELECT *\nFROM THIS\nLIMIT 1000;'));
    log('Panel created; webview HTML set (external media/main.js).');
    panel.webview.onDidReceiveMessage(m => this.onMessage(m));
    panel.onDidDispose(() => { try{this.db.close();}catch{} if(QueryPanel.current===this)QueryPanel.current=undefined; });
  }
  /** A source is a file and/or an editor document. For file-backed sources the file is
      read from disk (see utils/sourceRead) — never through VS Code's document sync,
      which hard-fails above 50 MB with "cannot be synchronized with extensions". */
  static async resolveSource(target?: vscode.Uri): Promise<{ uri?: vscode.Uri; document?: vscode.TextDocument; name: string } | undefined> {
    const fromDoc = (doc: vscode.TextDocument) => ({ uri: doc.uri, document: doc, name: doc.isUntitled ? 'Untitled' : path.basename(doc.fileName) });
    if (target && target.scheme === 'file') {
      try { const stat = await vscode.workspace.fs.stat(target);
        if ((stat.type & vscode.FileType.Directory) === 0) { const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === target.toString()); return { uri: target, document: doc, name: path.basename(target.fsPath) }; }
      } catch { return { uri: target, name: path.basename(target.fsPath) }; }
    }
    if (target && target.scheme === 'untitled') { const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === target.toString()); if (doc) return fromDoc(doc); }
    const active = vscode.window.activeTextEditor?.document; if (active) return fromDoc(active);
    const visible = vscode.window.visibleTextEditors.find(e => e.document && e.document.uri.scheme !== 'output')?.document; if (visible) return fromDoc(visible);
    if (QueryPanel.current?.sourceUri) { const uri = vscode.Uri.parse(QueryPanel.current.sourceUri); const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()); return { uri, document: doc, name: uri.scheme === 'file' ? path.basename(uri.fsPath) : 'Untitled' }; }
    const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Query this file' });
    if (picked?.length) return { uri: picked[0], name: path.basename(picked[0].fsPath) };
    return undefined;
  }
  static async createOrShow(ctx: vscode.ExtensionContext, target?: vscode.Uri) {
    log(`createOrShow target=${target ? target.toString() : '(none)'}`);
    const src = await QueryPanel.resolveSource(target);
    log(src ? `Resolved source: ${src.name} uri=${src.uri ? src.uri.toString() : '(none)'} dirty=${!!src.document?.isDirty}` : 'No source resolved');
    if (!src) { vscode.window.showWarningMessage('CSV Query: no file was selected. Open a delimited file, or right-click one in Explorer and choose \u201cQuery with CSV Query\u201d.'); return; }
    const wasm = path.join(ctx.extensionPath, 'out', 'sql-wasm.wasm');
    await initEngine(wasm);
    if (QueryPanel.current) { QueryPanel.current.panel.reveal(vscode.ViewColumn.Beside); await QueryPanel.current.loadFromSource(src); return; }
    const panel = vscode.window.createWebviewPanel('csvQuery', 'CSV Query', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [ctx.extensionUri] });
    const qp = new QueryPanel(panel, ctx); QueryPanel.current = qp; await qp.loadFromSource(src);
  }
  async reloadSource() {
    // Reload the source this panel was loaded from, not whatever editor happens to be active.
    if (this.sourceUri) { const uri = vscode.Uri.parse(this.sourceUri); const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === this.sourceUri); await this.loadFromSource({ uri, document: doc, name: this.sourceName }); return; }
    const src = await QueryPanel.resolveSource(); if (src) await this.loadFromSource(src);
  }
  async loadFromEditor(editor: vscode.TextEditor) { await this.loadFromDocument(editor.document); }
  async loadFromDocument(doc: vscode.TextDocument) { await this.loadFromSource({ uri: doc.uri, document: doc, name: doc.isUntitled ? 'Untitled' : path.basename(doc.fileName) }); }
  async loadFromSource(src: { uri?: vscode.Uri; document?: vscode.TextDocument; name: string }) {
    this.sourceUri = src.uri?.toString(); this.sourceName = src.name;
    const cfg = vscode.workspace.getConfiguration('csvQuery');
    try {
      let sizeBytes: number | undefined;
      if (src.uri?.scheme === 'file') { try { sizeBytes = (await fs.promises.stat(src.uri.fsPath)).size; } catch {} }
      const mode = decideReadMode({ hasFileUri: src.uri?.scheme === 'file', isUntitled: !!src.document?.isUntitled, isDirty: !!src.document?.isDirty, fileSizeBytes: sizeBytes });
      let text: string;
      if (mode === 'disk') {
        if (dirtyOverSyncLimit({ isDirty: !!src.document?.isDirty, fileSizeBytes: sizeBytes })) vscode.window.showWarningMessage(`CSV Query: ${src.name} has unsaved changes, but at ${(sizeBytes! / 1048576).toFixed(0)} MB it is over VS Code's 50 MB extension limit, so the saved version on disk will be queried. Save the file to include your changes.`);
        log(`Reading ${src.name} from disk (${sizeBytes !== undefined ? (sizeBytes / 1048576).toFixed(1) + ' MB' : 'size unknown'}) — bypassing VS Code document sync`);
        this.post({ type: 'source', text: `Reading ${src.name} from disk (${sizeBytes !== undefined ? (sizeBytes / 1048576).toFixed(1) : '?'} MB)…`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
        text = await fs.promises.readFile(src.uri!.fsPath, 'utf8');
      } else {
        const doc = src.document ?? (src.uri ? await vscode.workspace.openTextDocument(src.uri) : undefined);
        if (!doc) throw new Error('No document available for this source.');
        text = doc.getText();
      }
      this.sourceText = text;
      const mb = Buffer.byteLength(text) / 1048576;
      if (cfg.get<boolean>('enableLargeFileWarning', true) && mb > cfg.get<number>('largeFileWarningMB', 200)) {
        const pick = await vscode.window.showWarningMessage(`CSV Query: file is ${mb.toFixed(1)} MB. Continue?`, 'Continue', 'Cancel'); if (pick !== 'Continue') return;
      }
      this.post({ type: 'source', text: `Loading ${this.sourceName} (${mb.toFixed(1)} MB)…`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CSV Query: loading file…' }, async () => this.loadTextAsync(text, this.sourceName, 'THIS'));
    } catch (e) { const msg = friendlyError(e, [], ''); log(`Load failed for ${this.sourceName}: ${e instanceof Error ? e.message : String(e)}`); this.post({ type: 'source', text: `Failed to load ${this.sourceName}.`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' }); this.post({ type: 'error', text: `Loading failed: ${msg}` }); vscode.window.showErrorMessage(`CSV Query: loading ${this.sourceName} failed — ${e instanceof Error ? e.message : String(e)}`); }
  }
  private finishLoad(source: string, parsed: ParsedFile, loaded: LoadedTable, started: number) { log(`Loaded ${source}: ${loaded.rows} rows, ${loaded.columns} cols, delimiter=${JSON.stringify(parsed.delimiter)}, ${Date.now()-started} ms`);
    this.tables = [...this.tables.filter(t=>t.name!==loaded.name), loaded];
    const ms = ((Date.now()-started)/1000).toFixed(2);
    this.post({ type:'source', text:`Source: ${source} · Delimiter: ${delimiterLabel(parsed.delimiter)} · Header: ${parsed.hasHeader?'Yes':'No'} · Columns: ${parsed.columns.length} · Rows: ${parsed.rows.length.toLocaleString()} · Loaded in: ${ms}s`, delimiter: parsed.delimiter, hasHeader: parsed.hasHeader, tables: this.tables.map(t=>`${t.name}: ${t.source} (${t.rows} rows, ${t.columns} cols)`).join('  |  ') });
    this.postHistory();
  }
  loadText(text: string, source: string, table: string) {
    const started = Date.now();
    const parsed: ParsedFile = parseDelimited(text, { delimiter: table==='THIS'?this.delimiter:undefined, hasHeader: table==='THIS'?this.hasHeader:undefined });
    if (table==='THIS'){ this.delimiter=parsed.delimiter; this.hasHeader=parsed.hasHeader; }
    this.finishLoad(source, parsed, loadTable(this.db, table, parsed, source), started);
  }
  async loadTextAsync(text: string, source: string, table: string) {
    const started = Date.now();
    // Yield once so the panel can paint the Loading state before parsing starts.
    await new Promise(r => setTimeout(r, 0));
    const parsed: ParsedFile = parseDelimited(text, { delimiter: table==='THIS'?this.delimiter:undefined, hasHeader: table==='THIS'?this.hasHeader:undefined });
    if (table==='THIS'){ this.delimiter=parsed.delimiter; this.hasHeader=parsed.hasHeader; }
    const loaded = await loadTableAsync(this.db, table, parsed, source, (done, total) => {
      if (table==='THIS') this.post({ type:'source', text:`Loading ${source} — ${done.toLocaleString()} / ${total.toLocaleString()} rows…`, delimiter: parsed.delimiter, hasHeader: parsed.hasHeader, tables: '' });
    });
    this.finishLoad(source, parsed, loaded, started);
  }
  private post(m:any){
    if (m.type==='source') this.lastSourcePost = m; if (m.type==='result') this.lastResultPost = m;
    if (!this.webviewReady) { this.pendingPosts.push(m); return; }
    this.panel.webview.postMessage(m);
  }
  private markReady(){
    this.webviewReady = true; log(`Webview ready; flushing ${this.pendingPosts.length} queued message(s)`);
    const queued = this.pendingPosts; this.pendingPosts = [];
    for (const m of queued) this.panel.webview.postMessage(m);
    // Belt and braces: if the source state predates this webview, resend it so the bar can never stay on "Loading…"
    if (!queued.some(m => m.type==='source') && this.lastSourcePost) this.panel.webview.postMessage(this.lastSourcePost);
    if (!queued.some(m => m.type==='result') && this.lastResultPost) this.panel.webview.postMessage(this.lastResultPost);
  }
  private postHistory(){ this.post({type:'history', items:this.history.list()}); this.ctx.globalState.update('csvQuery.history', this.history.toJSON()); }
  clearHistory(){ this.history.clearUnpinned(); this.postHistory(); }
  async changeDelimiter() {
    const items=[',','|','\t',';','^']; const labels=['Comma ,','Pipe |','Tab','Semicolon ;','Caret ^','Custom…'];
    const pick=await vscode.window.showQuickPick(labels,{placeHolder:'Choose delimiter'}); if(!pick) return;
    let d=items[labels.indexOf(pick)]; if(!d){ const v=await vscode.window.showInputBox({prompt:'Custom delimiter (single character)'}); if(!v)return; d=v[0]; }
    this.delimiter=d; if(this.sourceText) this.loadText(this.sourceText,this.sourceName,'THIS');
  }
  setDelimiter(d:string){ this.delimiter=d; if(this.sourceText) this.loadText(this.sourceText,this.sourceName,'THIS'); }
  async addFile() {
    const uris=await vscode.window.showOpenDialog({canSelectMany:false}); if(!uris?.length) return;
    const alias=await vscode.window.showInputBox({prompt:'Table alias (e.g. REF, CLAR)', value:'REF'}); if(!alias) return;
    const buf=await vscode.workspace.fs.readFile(uris[0]); this.loadText(Buffer.from(buf).toString('utf8'), path.basename(uris[0].fsPath), sanitizeTableName(alias));
  }
  private async offerOpenExported(uri: vscode.Uri, msg: string) {
    const choice = await vscode.window.showInformationMessage(msg, 'Reveal in Finder', 'Open File');
    if (choice === 'Reveal in Finder') { try { await vscode.commands.executeCommand('revealFileInOS', uri); } catch {} }
    else if (choice === 'Open File') { try { await vscode.commands.executeCommand('vscode.open', uri); } catch {} }
  }
  async exportLast() {
    if (!this.lastSql && !this.lastResult) { vscode.window.showWarningMessage('CSV Query: run a query first.'); return; }
    // Pre-fill the save ("download") dialog: same folder as the source file when there is one,
    // suggested name "<source>_results.csv" — the user just confirms or renames.
    let defaultDir: string | undefined;
    try { if (this.sourceUri) { const su = vscode.Uri.parse(this.sourceUri); if (su.scheme === 'file' && su.fsPath) defaultDir = path.dirname(su.fsPath); } } catch {}
    if (!defaultDir) defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    const defaultUri = vscode.Uri.file(path.join(defaultDir, suggestExportFileName(this.sourceName)));
    const uri = await vscode.window.showSaveDialog({ defaultUri, filters: { 'CSV': ['csv'], 'TSV': ['tsv'] }, saveLabel: 'Export' }); if (!uri) return;
    const isTsv = uri.fsPath.endsWith('.tsv'); const delim = isTsv ? '\t' : ','; const cfg = vscode.workspace.getConfiguration('csvQuery'); const bom = cfg.get<boolean>('exportIncludeBom', false);
    // Stream the COMPLETE result set of the last query — no row cap — one statement step at a time.
    if (this.lastSql) {
      let stmt: any; const stream = fs.createWriteStream(uri.fsPath, { encoding: 'utf8' });
      try {
        stmt = this.db.prepare(stripSql(this.lastSql));
        const cols: string[] = stmt.getColumnNames();
        const write = async (chunk: string) => { if (!stream.write(chunk)) await new Promise<void>(r => stream.once('drain', () => r())); };
        if (bom) await write('\uFEFF');
        await write(formatRow(cols, delim) + '\r\n');
        let n = 0; let lines: string[] = [];
        while (stmt.step()) { const vals = stmt.get().map((v: any) => v === null ? null : String(v)); lines.push(formatRow(vals, delim)); n++; if (lines.length >= 5000) { await write(lines.join('\r\n') + '\r\n'); lines = []; } }
        if (lines.length) await write(lines.join('\r\n') + '\r\n');
        await new Promise<void>((resolve, reject) => { stream.end(() => resolve()); stream.on('error', reject); });
        log(`Exported complete result set: ${n} rows to ${uri.fsPath}`);
        await this.offerOpenExported(uri, `CSV Query: exported all ${n.toLocaleString()} rows to ${path.basename(uri.fsPath)} (complete result set, no limit).`);
        return;
      } catch (e) { try { stream.destroy(); } catch {} log(`Streaming export failed (${e instanceof Error ? e.message : String(e)}); falling back to in-memory export`); }
      finally { try { stmt?.free(); } catch {} }
    }
    if (this.lastResult) { const text = toDelimited(this.lastResult.columns, this.lastResult.rows, delim, bom); await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8')); await this.offerOpenExported(uri, `CSV Query: exported ${this.lastResult.rows.length} rows to ${path.basename(uri.fsPath)}.`); }
  }
  private sendPage(offset: number, keepView: boolean) {
    const r = queryPage(this.db, this.lastSql, QueryPanel.GRID_PAGE, offset);
    this.lastResult = { columns: r.columns, rows: r.rows, rowCount: r.total, truncated: false, ms: r.ms };
    const from = r.total === 0 ? 0 : r.offset + 1; const to = r.offset + r.rows.length;
    this.post({ type: 'result', columns: r.columns, rows: r.rows, paged: true, keepView, total: r.total, offset: r.offset, pageSize: r.pageSize,
      meta: `${r.total.toLocaleString()} rows · ${r.ms} ms · Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${r.total.toLocaleString()} — Prev/Next pages through the entire result set. Export includes all ${r.total.toLocaleString()} rows.` });
  }
  private async onMessage(m:any) {
    if(!m||typeof m.type!=='string') return; log(`Webview message received: ${m.type}`); const allowed=['ready','run','export','reload','addFile','setDelimiter','setHeader','clientError','page']; if(!allowed.includes(m.type)) return;
    if(m.type==='clientError'){ log(`WEBVIEW CLIENT ERROR: ${String(m.message||'unknown')}`); return; }
    try{
      if(m.type==='ready'){ this.markReady(); this.postHistory(); }
      if(m.type==='reload'){ await this.reloadSource(); }
      if(m.type==='addFile') await this.addFile();
      if(m.type==='export') await this.exportLast();
      if(m.type==='setDelimiter' && typeof m.delimiter==='string') this.setDelimiter(m.delimiter);
      if(m.type==='setHeader' && typeof m.hasHeader==='boolean'){ this.hasHeader=m.hasHeader; if(this.sourceText) this.loadText(this.sourceText,this.sourceName,'THIS'); }
      if(m.type==='page' && typeof m.offset==='number' && this.lastSql){ this.sendPage(m.offset, true); }
      if(m.type==='run' && typeof m.sql==='string'){
        this.lastSql = m.sql;
        let pagedOk = false;
        try { this.sendPage(0, false); pagedOk = true; } catch { pagedOk = false; }
        if (pagedOk) { this.history.add({sql:m.sql, ts:Date.now(), source:this.sourceName, ok:true}); this.postHistory(); }
        else {
          const r = executeQuery(this.db, m.sql, QueryPanel.GRID_PAGE);
          this.lastResult = r; this.history.add({sql:m.sql, ts:Date.now(), source:this.sourceName, ok:true}); this.postHistory();
          this.post({type:'result', columns:r.columns, rows:r.rows, paged:false, total:r.rowCount, offset:0, pageSize:QueryPanel.GRID_PAGE, meta:`${r.rowCount.toLocaleString()} rows · ${r.ms} ms.`});
        }
      }
    }catch(e){ const cols=this.tables.find(t=>t.name==='THIS')?.columnNames||[]; this.history.add({sql:m.sql||'', ts:Date.now(), source:this.sourceName, ok:false}); this.postHistory(); this.post({type:'error', text:friendlyError(e, cols, m.sql||'')}); }
  }
}
