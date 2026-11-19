import * as vscode from 'vscode';
import * as fs from 'fs';
import { buildLineIndex, readLineRange } from './lineIndex';
import { buildColorLinesHtml } from './previewHtml';
import { detectDelimiter, delimiterLabel } from '../parser/delimiterDetector';
import { log } from '../utils/log';

interface EditorState {
  uriString: string;
  fsPath: string;
  delimiter: string;
  offsets?: Float64Array;
  lastFirst: number;
  lastCount: number;
  panel: vscode.WebviewPanel;
  initPromise?: Promise<void>;
  metaLabel?: string;
}

/** The CSV Query Color Editor: a custom editor that takes over a delimited
    file's own tab and renders EVERY line with per-column colours. It exists
    because editor decorations are impossible for the files that need them —
    above 50 MB VS Code will not give extensions the document at all — and a
    300-line preview tab was not what Amit asked for: he wants the file itself,
    in its editor, coloured, all the way through. Rendering is virtualised:
    a byte-offset line index is built once (streamed), and the webview only
    ever holds a moving window of lines read from disk on demand, so a
    3.7M-line file scrolls end to end at constant memory. Read-only: switch
    back to the Text Editor (Reopen Editor With…) to edit. */
export class ColorEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'csvQuery.colorEditor';
  private static openSet = new Set<string>();
  private static listeners = new Set<() => void>();
  private static states = new Set<EditorState>();
  private static indexCache = new Map<string, { key: string; offsets: Float64Array }>();
  /** Set by QueryPanel: the delimiter the panel is using for a URI, if it has one. */
  static delimiterHint: ((uriString: string) => string | undefined) | undefined;

  static onOpenChange(fn: () => void) { ColorEditorProvider.listeners.add(fn); }
  private static emit() { ColorEditorProvider.listeners.forEach(f => { try { f(); } catch {} }); }
  static isOpen(uri: vscode.Uri | string): boolean {
    return ColorEditorProvider.openSet.has(typeof uri === 'string' ? uri : uri.toString());
  }
  /** Show the file coloured as its ONE tab: open the Color Editor, then close
      the file's plain text tab(s), so the tab appears to flip in place instead
      of a second tab opening alongside (Amit: "I dont understand the need of
      opening a new tab"). VS Code offers no API to convert an open text editor
      into a custom editor in place — open-then-close in the same group is the
      closest faithful behaviour. */
  static async openEditor(uri: vscode.Uri): Promise<void> {
    log(`Opening Color Editor for ${uri.fsPath}`);
    await vscode.commands.executeCommand('vscode.openWith', uri, ColorEditorProvider.viewType);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of [...group.tabs]) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString()) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }
  /** Flip back: reopen the file as plain text, then close the coloured tab(s),
      so the file still has exactly one tab. */
  static async closeEditor(uri: vscode.Uri | string): Promise<void> {
    const s = typeof uri === 'string' ? uri : uri.toString();
    const target = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri;
    await vscode.commands.executeCommand('vscode.open', target);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of [...group.tabs]) {
        const input = tab.input;
        if (input instanceof vscode.TabInputCustom && input.viewType === ColorEditorProvider.viewType && input.uri.toString() === s) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }
  /** The panel's delimiter changed for a file whose Color Editor is open:
      re-render its current window with the new delimiter. */
  static refreshDelimiter(uriString: string, delimiter: string) {
    for (const st of ColorEditorProvider.states) {
      if (st.uriString === uriString && st.delimiter !== delimiter) {
        st.delimiter = delimiter;
        void ColorEditorProvider.serve(st, st.lastFirst, st.lastCount || 300);
      }
    }
  }

  constructor(private ctx: vscode.ExtensionContext) {}

  /** VS Code calls this first when a Color Editor tab opens, then hands the
      returned document to resolveCustomEditor. It is a required member of
      CustomReadonlyEditorProvider in the API — 1.3.0–1.3.2 omitted it, and
      Amit's logs showed the result: openWith opened the tab and VS Code never
      called resolveCustomEditor at all, leaving a black editor with no error
      on either side. The document is just the URI; content is read from disk
      on demand via the line index. */
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    log(`Color Editor openCustomDocument: ${uri.fsPath}`);
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    const uri = document.uri;
    log(`Color Editor resolve: ${uri.fsPath}`);
    const st: EditorState = {
      uriString: uri.toString(), fsPath: uri.fsPath,
      delimiter: ColorEditorProvider.delimiterHint?.(uri.toString()) || ',',
      lastFirst: 0, lastCount: 0, panel,
    };
    ColorEditorProvider.states.add(st);
    ColorEditorProvider.openSet.add(st.uriString);
    ColorEditorProvider.emit();
    panel.onDidDispose(() => {
      ColorEditorProvider.states.delete(st);
      if (![...ColorEditorProvider.states].some(s => s.uriString === st.uriString)) ColorEditorProvider.openSet.delete(st.uriString);
      ColorEditorProvider.emit();
    });
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    const wv = panel.webview;
    const css1 = wv.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'colors.css'));
    const css2 = wv.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'colorEditor.css'));
    const js = wv.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'colorEditor.js'));
    wv.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource}; script-src ${wv.cspSource};">
<link rel="stylesheet" href="${css1}"><link rel="stylesheet" href="${css2}">
</head><body>
<div id="head">Color Columns — indexing…</div>
<div id="scroll"><div id="content"><div id="spacer"></div><div id="win"></div></div></div>
<script src="${js}"></script>
</body></html>`;
    log(`Color Editor html set: ${uri.fsPath.split('/').pop()}`);
    wv.onDidReceiveMessage(async (m: { type?: string; first?: number; count?: number; message?: string }) => {
      if (!m || typeof m.type !== 'string') return;
      log(`Color Editor message: ${m.type}`);
      if (m.type === 'range' && st.offsets) { st.lastFirst = m.first ?? 0; st.lastCount = m.count ?? 300; await ColorEditorProvider.serve(st, st.lastFirst, st.lastCount); }
      if (m.type === 'clientError') log(`Color Editor webview error: ${m.message || 'unknown'}`);
      if (m.type === 'ready') { await this.ensureInit(st); this.sendMeta(st); }
    });
    // Start indexing immediately — do not gate it on the webview's 'ready'.
    // In 1.3.1 the whole startup hung off that one message: when it never
    // arrived (Amit's log showed the tab open with not a single resolve/init
    // line after it), the editor sat black and silent. Now 'ready' only
    // triggers a meta re-send, which also covers a 'meta' posted before the
    // page's listener attached.
    void this.ensureInit(st);
  }

  private sendMeta(st: EditorState) {
    if (!st.offsets || !st.metaLabel) return;
    st.panel.webview.postMessage({ type: 'meta', total: st.offsets.length, label: st.metaLabel });
  }

  private ensureInit(st: EditorState): Promise<void> {
    if (!st.initPromise) st.initPromise = this.init(st);
    return st.initPromise;
  }

  private async init(st: EditorState) {
    const name = st.fsPath.split('/').pop();
    try {
      log(`Color Editor init: ${name}`);
      const stat = await fs.promises.stat(st.fsPath);
      const key = `${stat.size}|${stat.mtimeMs}`;
      const cached = ColorEditorProvider.indexCache.get(st.fsPath);
      if (cached && cached.key === key) st.offsets = cached.offsets;
      else {
        st.panel.webview.postMessage({ type: 'status', text: `Color Columns — indexing ${name}…` });
        st.offsets = await buildLineIndex(st.fsPath);
        ColorEditorProvider.indexCache.set(st.fsPath, { key, offsets: st.offsets });
      }
      if (!ColorEditorProvider.delimiterHint?.(st.uriString)) {
        const fh = await fs.promises.open(st.fsPath, 'r');
        try { const buf = Buffer.alloc(65536); const { bytesRead } = await fh.read(buf, 0, 65536, 0); st.delimiter = detectDelimiter(buf.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '')).delimiter; }
        finally { await fh.close(); }
      } else st.delimiter = ColorEditorProvider.delimiterHint(st.uriString)!;
      st.metaLabel = `Color Columns · ${name} · Delimiter: ${delimiterLabel(st.delimiter)} · ${st.offsets.length.toLocaleString()} lines`;
      log(`Color Editor opened for ${name}: ${st.offsets.length.toLocaleString()} lines indexed, delimiter ${JSON.stringify(st.delimiter)}`);
      this.sendMeta(st);
      void ColorEditorProvider.serve(st, 0, 300);
    } catch (e) {
      st.panel.webview.postMessage({ type: 'status', text: `Color Columns — could not read the file: ${e instanceof Error ? e.message : String(e)}` });
      log(`Color Editor failed for ${st.fsPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private static async serve(st: EditorState, first: number, count: number) {
    if (!st.offsets) return;
    try {
      const lines = await readLineRange(st.fsPath, st.offsets, first, count);
      st.panel.webview.postMessage({ type: 'lines', first, count: lines.length, html: buildColorLinesHtml(lines, st.delimiter, first + 1) });
    } catch (e) { log(`Color Editor range failed (${st.fsPath} @${first}): ${e instanceof Error ? e.message : String(e)}`); }
  }
}
