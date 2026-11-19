
import * as vscode from 'vscode'; import * as path from 'path'; import * as fs from 'fs'; import * as os from 'os';
import type { Database } from 'sql.js';
import { createDb, initEngine } from './database/sqliteEngine';
import { parseDelimited, ParsedFile } from './parser/delimitedParser';
import { loadTable, loadTableAsync, LoadedTable } from './database/tableLoader';
import { loadTableFromFile, LoadCancelledError } from './database/streamLoader';
import { executeQuery, queryPage, stripSql } from './database/queryExecutor';
import { friendlyError } from './utils/errors';
import { toDelimited, formatRow, suggestExportFileName } from './export/resultExporter';
import { sanitizeTableName } from './utils/identifiers';
import { QueryHistory } from './history/queryHistory';
import { getHtml } from './webview/html';
import { delimiterLabel } from './parser/delimiterDetector';
import { log } from './utils/log';
import { decideReadMode, dirtyOverSyncLimit } from './utils/sourceRead';
import { pickFollowTarget } from './utils/followTarget';
import { ColorPreviewPanel } from './colorizer/colorPreview';
import { ColorEditorProvider } from './colorizer/colorEditor';
import { isPainted, setPainted, togglePaint, refreshPainted } from './colorizer/colorizer';
import { detectDelimiter } from './parser/delimiterDetector';

export class QueryPanel implements vscode.WebviewViewProvider {
  static current: QueryPanel | undefined;
  static readonly viewId = 'csvQuery.view';
  private db!: Database; private tables: LoadedTable[] = []; private lastResult: any = null;
  private delimiter: string | undefined; private hasHeader: boolean | undefined;
  private sourceName = 'Untitled'; private sourceText = ''; private history: QueryHistory; private sourceUri: string | undefined;
  /** True when THIS was streamed from a file on disk; then sourceText holds only the
      head sample (for the Color Columns preview), and reloads must re-stream. */
  private sourceOnDisk = false;
  /** Load serialisation: a new load request bumps the generation (which cancels
      any in-flight streaming load at its next batch) and queues as the pending
      source; only the latest queued source is ever loaded next. */
  private loadGen = 0; private loadBusy = false;
  private pendingSource: { uri?: vscode.Uri; document?: vscode.TextDocument; name: string } | undefined;
  private webviewReady = false; private lastSql = ''; private static readonly GRID_PAGE = 1000; private pendingPosts: any[] = []; private lastSourcePost: any = null; private lastResultPost: any = null;
  private view: vscode.WebviewView | undefined;
  private constructor(private ctx: vscode.ExtensionContext) {
    const cfg = vscode.workspace.getConfiguration('csvQuery');
    this.history = new QueryHistory(cfg.get<number>('queryHistorySize', 50), ctx.globalState.get('csvQuery.history', []));
    // The Color Editor asks the panel which delimiter a file is being queried
    // with, and the panel's toggle button tracks the editor opening/closing.
    ColorEditorProvider.delimiterHint = (u) => this.delimiterFor(u);
    ColorEditorProvider.onOpenChange(() => this.postColorState());
  }
  /** The delimiter this panel is using for the given source URI, if it is ours. */
  delimiterFor(uriString: string): string | undefined {
    return this.sourceUri === uriString ? this.delimiter : undefined;
  }
  /** Registers the singleton provider for the bottom-Panel webview view (v1.1.0: the UI
      lives in the Panel area below the editor, not in an editor tab beside the file). */
  static register(ctx: vscode.ExtensionContext): QueryPanel {
    // Singleton: registerCommands and activate both call this, and registering
    // a second webview view provider for the same view id throws inside
    // activate() — which silently aborted activation before the Color Editor
    // provider (registered after this call) was ever reached. That is why the
    // Color Editor tab opened from the manifest yet its provider was never
    // called, in every version since the editor existed.
    if (QueryPanel.current) return QueryPanel.current;
    const provider = new QueryPanel(ctx); QueryPanel.current = provider;
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider(QueryPanel.viewId, provider, { webviewOptions: { retainContextWhenHidden: true } }));
    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => { provider.scheduleFollow(); }));
    ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => { provider.scheduleFollow(); }));
    ctx.subscriptions.push(vscode.window.tabGroups.onDidChangeTabGroups(() => { provider.scheduleFollow(); }));
    return provider;
  }
  private followTimer: NodeJS.Timeout | undefined;
  /** Follow triggers arrive in bursts (editor + tabs + groups events for one
      switch — and a Color Editor tab-swap closes and opens tabs in quick
      succession, briefly activating a neighbouring file). Debounce briefly
      and follow only where the user actually lands. */
  private scheduleFollow() {
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => { this.followTimer = undefined; void this.followCurrent(); }, 300);
  }
  /** Follow the editor: when the user switches to a different data file, load it,
      so the panel and its results always describe the file being looked at.
      Staying bound to a previously loaded file while the user eyeballs another
      one is, in Amit's words, pointless. Disable with csvQuery.followActiveEditor.

      Two blind spots shaped this (both proven by Amit's logs): the active-editor
      event carries no document for files over VS Code's 50 MB sync limit — the
      tab is visible but the extension host sees no editor — so the active TAB
      (Tabs API, which does report large-file tabs) is followed as well; and the
      event never fires for the editor restored with the window, so the panel
      also runs this once when its view first resolves. */
  private async followCurrent() {
    if (!vscode.workspace.getConfiguration('csvQuery').get<boolean>('followActiveEditor', true)) return;
    const ed = vscode.window.activeTextEditor;
    const doc = ed?.document;
    const tabInput = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
    const tabText = tabInput instanceof vscode.TabInputText ? tabInput : undefined;
    const tabCustom = tabInput instanceof vscode.TabInputCustom && tabInput.viewType === ColorEditorProvider.viewType ? tabInput : undefined;
    const target = pickFollowTarget({
      docUri: doc?.uri.toString(), docScheme: doc?.uri.scheme,
      tabUri: tabText?.uri.toString(), tabScheme: tabText?.uri.scheme, tabIsText: !!tabText,
      customUri: tabCustom?.uri.toString(),
      sourceUri: this.sourceUri,
    });
    if (!target) return;
    try {
      await initEngine(path.join(this.ctx.extensionPath, 'out', 'sql-wasm.wasm'));
      this.ensureDb();
      if (target.viaDocument && doc) {
        log(`Following active editor: ${doc.fileName}`);
        await this.loadFromSource({ uri: doc.uri, document: doc, name: doc.isUntitled ? 'Untitled' : path.basename(doc.fileName) });
      } else {
        const uri = vscode.Uri.parse(target.uriString);
        log(target.kind === 'colorEditor' ? `Following Color Editor tab: ${uri.fsPath}` : `Following active tab (document not synced): ${uri.fsPath}`);
        await this.loadFromSource({ uri, name: path.basename(uri.fsPath) });
      }
    } catch (e) { log(`Follow load failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  private ensureDb() { if (!this.db) this.db = createDb(); }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view; this.webviewReady = false; this.pendingPosts = [];
    const cfg = vscode.workspace.getConfiguration('csvQuery');
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.html = getHtml(view.webview, this.ctx.extensionUri, cfg.get<string>('defaultQuery', 'SELECT *\nFROM THIS\nLIMIT 1000;'));
    log('View resolved in Panel area; webview HTML set (external media/main.js).');
    view.webview.onDidReceiveMessage(m => this.onMessage(m));
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    // Make Run work even when the user opens the view directly from the Panel,
    // before any command has loaded a file.
    (async () => { try { await initEngine(path.join(this.ctx.extensionPath, 'out', 'sql-wasm.wasm')); this.ensureDb(); } catch (e) { log(`Engine init from view failed: ${e instanceof Error ? e.message : String(e)}`); } })();
    if (!this.sourceUri) { this.post({ type: 'source', text: 'No file loaded yet — open a delimited file and run “CSV Query: Open Query Panel”.', delimiter: this.delimiter || ',', hasHeader: true, tables: '' }); void this.followCurrent(); }
  }
  /** Shows the bottom Panel and focuses the CSV Query view there. */
  async reveal() { await vscode.commands.executeCommand(`${QueryPanel.viewId}.focus`); }
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
    const qp = QueryPanel.current ?? QueryPanel.register(ctx);
    qp.ensureDb();
    await qp.reveal();
    await qp.loadFromSource(src);
  }
  async reloadSource() {
    // Reload the source this panel was loaded from, not whatever editor happens to be active.
    if (this.sourceUri) { const uri = vscode.Uri.parse(this.sourceUri); const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === this.sourceUri); await this.loadFromSource({ uri, document: doc, name: this.sourceName }); return; }
    const src = await QueryPanel.resolveSource(); if (src) await this.loadFromSource(src);
  }
  async loadFromEditor(editor: vscode.TextEditor) { await this.loadFromDocument(editor.document); }
  async loadFromDocument(doc: vscode.TextDocument) { await this.loadFromSource({ uri: doc.uri, document: doc, name: doc.isUntitled ? 'Untitled' : path.basename(doc.fileName) }); }
  /** Serialised load entry point: requests are generation-stamped; a newer
      request cancels an in-flight streaming load and replaces any queued one,
      so rapid file switching loads only where the user lands. */
  async loadFromSource(src: { uri?: vscode.Uri; document?: vscode.TextDocument; name: string }) {
    const gen = ++this.loadGen;
    if (this.loadBusy) { this.pendingSource = src; return; }
    this.loadBusy = true;
    try {
      let cur: typeof src | undefined = src; let curGen = gen;
      while (cur) {
        await this.doLoadFromSource(cur, () => curGen !== this.loadGen);
        cur = this.pendingSource; this.pendingSource = undefined;
        if (cur) curGen = this.loadGen;
      }
    } finally { this.loadBusy = false; }
  }
  private async doLoadFromSource(src: { uri?: vscode.Uri; document?: vscode.TextDocument; name: string }, cancelled: () => boolean) {
    this.sourceUri = src.uri?.toString(); this.sourceName = src.name;
    const cfg = vscode.workspace.getConfiguration('csvQuery');
    try {
      let sizeBytes: number | undefined;
      if (src.uri?.scheme === 'file') { try { sizeBytes = (await fs.promises.stat(src.uri.fsPath)).size; } catch {} }
      const mode = decideReadMode({ hasFileUri: src.uri?.scheme === 'file', isUntitled: !!src.document?.isUntitled, isDirty: !!src.document?.isDirty, fileSizeBytes: sizeBytes });
      if (mode === 'disk') {
        // Stream the file from disk in two passes (streamLoader): the whole file is
        // never held as one string. The old read-whole-file path died with RangeError
        // "Invalid string length" on a real multi-hundred-MB export — V8 caps a single
        // string at ~512M characters regardless of RAM.
        if (dirtyOverSyncLimit({ isDirty: !!src.document?.isDirty, fileSizeBytes: sizeBytes })) vscode.window.showWarningMessage(`CSV Query: ${src.name} has unsaved changes, but at ${(sizeBytes! / 1048576).toFixed(0)} MB it is over VS Code's 50 MB extension limit, so the saved version on disk will be queried. Save the file to include your changes.`);
        log(`Streaming ${src.name} from disk (${sizeBytes !== undefined ? (sizeBytes / 1048576).toFixed(1) + ' MB' : 'size unknown'}) — bypassing VS Code document sync`);
        this.post({ type: 'source', text: `Reading ${src.name} from disk (${sizeBytes !== undefined ? (sizeBytes / 1048576).toFixed(1) : '?'} MB)…`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
        const started = Date.now();
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CSV Query: loading file…' }, async () => {
          const res = await loadTableFromFile(this.db, 'THIS', src.uri!.fsPath, src.name, { delimiter: this.delimiter, hasHeader: this.hasHeader, cancelled }, (done, total, phase) => {
            const text = phase === 'scan' ? `Scanning ${src.name} — ${done.toLocaleString()} rows scanned…` : `Loading ${src.name} — ${done.toLocaleString()} / ${total.toLocaleString()} rows…`;
            this.post({ type: 'source', text, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
          });
          this.delimiter = res.delimiter; this.hasHeader = res.hasHeader; this.sourceText = res.headText; this.sourceOnDisk = true;
          this.finishLoad(src.name, { delimiter: res.delimiter, hasHeader: res.hasHeader, confidence: 1, columns: res.columns, rows: [] }, res.loaded, started);
        });
        return;
      }
      const doc = src.document ?? (src.uri ? await vscode.workspace.openTextDocument(src.uri) : undefined);
      if (!doc) throw new Error('No document available for this source.');
      if (cancelled()) return;
      const text = doc.getText();
      this.sourceText = text; this.sourceOnDisk = false;
      const mb = Buffer.byteLength(text) / 1048576;
      this.post({ type: 'source', text: `Loading ${this.sourceName} (${mb.toFixed(1)} MB)…`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CSV Query: loading file…' }, async () => this.loadTextAsync(text, this.sourceName, 'THIS'));
    } catch (e) {
      if (e instanceof LoadCancelledError) { log(`Load of ${this.sourceName} cancelled — a newer source was requested`); return; }
      const msg = friendlyError(e, [], ''); log(`Load failed for ${this.sourceName}: ${e instanceof Error ? e.message : String(e)}`); this.post({ type: 'source', text: `Failed to load ${this.sourceName}.`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' }); this.post({ type: 'error', text: `Loading failed: ${msg}` }); vscode.window.showErrorMessage(`CSV Query: loading ${this.sourceName} failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** Re-run the current THIS load after a delimiter/header change. A disk-streamed
      source must be re-streamed from its file — its sourceText is only the head
      sample kept for the Color Columns preview, never the whole file. */
  private reloadThis() {
    if (this.sourceOnDisk && this.sourceUri) { void this.reloadSource(); return; }
    if (this.sourceText) this.loadText(this.sourceText, this.sourceName, 'THIS');
  }
  private finishLoad(source: string, parsed: ParsedFile, loaded: LoadedTable, started: number) { log(`Loaded ${source}: ${loaded.rows} rows, ${loaded.columns} cols, delimiter=${JSON.stringify(parsed.delimiter)}, ${Date.now()-started} ms`);
    this.tables = [...this.tables.filter(t=>t.name!==loaded.name), loaded];
    const ms = ((Date.now()-started)/1000).toFixed(2);
    this.post({ type:'source', text:`Source: ${source} · Delimiter: ${delimiterLabel(parsed.delimiter)} · Header: ${parsed.hasHeader?'Yes':'No'} · Columns: ${parsed.columns.length} · Rows: ${loaded.rows.toLocaleString()} · Loaded in: ${ms}s`, delimiter: parsed.delimiter, hasHeader: parsed.hasHeader, tables: this.tables.map(t=>`${t.name}: ${t.source} (${t.rows} rows, ${t.columns} cols)`).join('  |  ') });
    this.postHistory();
    this.syncColorsAfterLoad();
  }
  /** Color Columns plumbing: after a (re)load, refresh an open preview with the
      file's real delimiter, honour the colour-by-default setting (which opens
      the Color Editor for file-backed sources), and sync the toggle button. */
  private syncColorsAfterLoad() {
    if (ColorPreviewPanel.current && this.sourceText) ColorPreviewPanel.current.update(this.sourceName, this.sourceText, this.delimiter || ',');
    else if (this.sourceUri && vscode.workspace.getConfiguration('csvQuery').get<boolean>('colorColumnsByDefault', false)) {
      const uri = vscode.Uri.parse(this.sourceUri);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === this.sourceUri);
      if (doc) { if (!isPainted(this.sourceUri)) void setPainted(this.sourceUri, true); }
      else if (this.sourceOnDisk && !ColorEditorProvider.isOpen(uri)) void ColorEditorProvider.openEditor(uri);
    }
    this.postColorState();
  }
  postColorState() {
    const editorOn = this.sourceUri ? ColorEditorProvider.isOpen(this.sourceUri) : false;
    const painted = this.sourceUri ? isPainted(this.sourceUri) : false;
    this.post({ type: 'colorState', enabled: editorOn || painted || !!ColorPreviewPanel.current });
  }
  /** Color Columns, two ways — Amit's rule is "paint the current file itself":
      if VS Code syncs the source's document to extensions (files up to the
      ~50 MB sync limit, untitled buffers), paint that editor IN PLACE with
      decorations; no tab changes at all. If there is no synced document (a
      large file), swap the file's one tab to the Color Editor — the plain tab
      closes as the coloured one opens — and swap back on the next click.
      Buffer-only sources with no document open anywhere keep the 300-line
      preview fallback. */
  async toggleColor() {
    if (this.sourceUri) {
      const uri = vscode.Uri.parse(this.sourceUri);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === this.sourceUri);
      if (doc) {
        const on = await togglePaint(this.sourceUri);
        log(`Color Columns ${on ? 'painted in place' : 'unpainted'}: ${doc.fileName}`);
        this.postColorState();
        return;
      }
      if (uri.scheme === 'file') {
        if (ColorEditorProvider.isOpen(uri)) await ColorEditorProvider.closeEditor(uri);
        else await ColorEditorProvider.openEditor(uri);
        this.postColorState();
        return;
      }
    }
    if (ColorPreviewPanel.current) { ColorPreviewPanel.current.close(); this.postColorState(); return; }
    let text = this.sourceText; let delim = this.delimiter; let name = this.sourceName;
    if (!text) {
      const ed = vscode.window.activeTextEditor;
      if (ed) { text = ed.document.getText(); name = ed.document.isUntitled ? 'Untitled' : path.basename(ed.document.fileName); }
    }
    if (!text) { vscode.window.showWarningMessage('CSV Query: load a file in the panel (or open one in the editor), then toggle Color Columns.'); return; }
    if (!delim) delim = detectDelimiter(text.slice(0, 200000)).delimiter;
    ColorPreviewPanel.show(this.ctx, name, text, delim, () => this.postColorState());
    this.postColorState();
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
    if (!this.view || !this.webviewReady) { this.pendingPosts.push(m); return; }
    this.view.webview.postMessage(m);
  }
  private markReady(){
    if (!this.view) return;
    this.webviewReady = true; log(`Webview ready; flushing ${this.pendingPosts.length} queued message(s)`);
    const queued = this.pendingPosts; this.pendingPosts = [];
    for (const m of queued) this.view.webview.postMessage(m);
    // Belt and braces: if the source state predates this webview, resend it so the bar can never stay on "Loading…"
    if (!queued.some(m => m.type==='source') && this.lastSourcePost) this.view.webview.postMessage(this.lastSourcePost);
    if (!queued.some(m => m.type==='result') && this.lastResultPost) this.view.webview.postMessage(this.lastResultPost);
    this.postColorState();
  }
  private postHistory(){ this.post({type:'history', items:this.history.list()}); this.ctx.globalState.update('csvQuery.history', this.history.toJSON()); }
  clearHistory(){ this.history.clearUnpinned(); this.postHistory(); }
  async changeDelimiter() {
    const items=[',','|','\t',';','^']; const labels=['Comma ,','Pipe |','Tab','Semicolon ;','Caret ^','Custom…'];
    const pick=await vscode.window.showQuickPick(labels,{placeHolder:'Choose delimiter'}); if(!pick) return;
    let d=items[labels.indexOf(pick)]; if(!d){ const v=await vscode.window.showInputBox({prompt:'Custom delimiter (single character)'}); if(!v)return; d=v[0]; }
    this.delimiter=d; if (this.sourceUri) { ColorEditorProvider.refreshDelimiter(this.sourceUri, d); refreshPainted(this.sourceUri); } this.reloadThis();
  }
  setDelimiter(d:string){ this.delimiter=d; if (this.sourceUri) { ColorEditorProvider.refreshDelimiter(this.sourceUri, d); refreshPainted(this.sourceUri); } this.reloadThis(); }
  async addFile() {
    const uris=await vscode.window.showOpenDialog({canSelectMany:false}); if(!uris?.length) return;
    const alias=await vscode.window.showInputBox({prompt:'Table alias (e.g. REF, CLAR)', value:'REF'}); if(!alias) return;
    // Stream the joined file from disk too — the same whole-file read died on big files.
    const table = sanitizeTableName(alias); const name = path.basename(uris[0].fsPath); const started = Date.now();
    try {
      const res = await loadTableFromFile(this.db, table, uris[0].fsPath, name, {}, (done, total) => {
        this.post({ type: 'source', text: `Loading ${name} as ${table} — ${done.toLocaleString()} / ${total.toLocaleString()} rows…`, delimiter: this.delimiter || ',', hasHeader: !!this.hasHeader, tables: '' });
      });
      this.finishLoad(name, { delimiter: res.delimiter, hasHeader: res.hasHeader, confidence: 1, columns: res.columns, rows: [] }, res.loaded, started);
    } catch (e) { log(`Add-file failed for ${name}: ${e instanceof Error ? e.message : String(e)}`); vscode.window.showErrorMessage(`CSV Query: loading ${name} failed — ${e instanceof Error ? e.message : String(e)}`); }
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
    if(!m||typeof m.type!=='string') return; log(`Webview message received: ${m.type}`); const allowed=['ready','run','export','reload','addFile','setDelimiter','setHeader','clientError','page','toggleColor']; if(!allowed.includes(m.type)) return;
    if(m.type==='clientError'){ log(`WEBVIEW CLIENT ERROR: ${String(m.message||'unknown')}`); return; }
    try{
      if(m.type==='ready'){ this.markReady(); this.postHistory(); }
      if(m.type==='reload'){ await this.reloadSource(); }
      if(m.type==='addFile') await this.addFile();
      if(m.type==='export') await this.exportLast();
      if(m.type==='toggleColor') await this.toggleColor();
      if(m.type==='setDelimiter' && typeof m.delimiter==='string') this.setDelimiter(m.delimiter);
      if(m.type==='setHeader' && typeof m.hasHeader==='boolean'){ this.hasHeader=m.hasHeader; this.reloadThis(); }
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
