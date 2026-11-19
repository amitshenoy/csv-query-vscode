import * as vscode from 'vscode';
import { tokenizeLine } from './lineTokenizer';
import { COLUMN_COLORS } from './palette';
import { detectDelimiter } from '../parser/delimiterDetector';
import { log } from '../utils/log';

/** In-place column painting for documents VS Code syncs to extensions (files
    up to the ~50 MB sync limit, and untitled buffers): the file's OWN editor
    is painted with text decorations — no new tab, no editor swap, exactly
    what Amit asked for ("paint the current file itself, query window below").
    Above the sync limit there is no document to paint — the extension host
    never sees the file — so QueryPanel.toggleColor swaps the file's tab to
    the Color Editor for those instead. Painting is per-file, persisted
    across sessions, covers visible ranges only (recomputed on scroll and
    edit), and uses the panel's delimiter for the loaded source,
    auto-detected from the first line otherwise. */
const STATE_KEY = 'csvQuery.paintedFiles';
let types: vscode.TextEditorDecorationType[] = [];
let ctxRef: vscode.ExtensionContext | undefined;
let delimiterFor: (uriString: string) => string | undefined = () => undefined;

export function isPainted(uriString: string): boolean {
  if (!ctxRef) return false;
  return ctxRef.globalState.get<string[]>(STATE_KEY, []).includes(uriString);
}
export async function setPainted(uriString: string, on: boolean): Promise<void> {
  if (!ctxRef) return;
  const s = new Set(ctxRef.globalState.get<string[]>(STATE_KEY, []));
  if (on) s.add(uriString); else s.delete(uriString);
  await ctxRef.globalState.update(STATE_KEY, [...s]);
  paintAllEditors();
}
export async function togglePaint(uriString: string): Promise<boolean> {
  const on = !isPainted(uriString);
  await setPainted(uriString, on);
  return on;
}
function delimiterOf(doc: vscode.TextDocument): string {
  const hint = delimiterFor(doc.uri.toString());
  if (hint) return hint;
  return detectDelimiter(doc.lineCount > 0 ? doc.lineAt(0).text : '').delimiter;
}
export function paintEditor(editor: vscode.TextEditor) {
  const doc = editor.document;
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return;
  if (!isPainted(doc.uri.toString())) { for (const t of types) editor.setDecorations(t, []); return; }
  const delim = delimiterOf(doc);
  const perCol: vscode.Range[][] = COLUMN_COLORS.map(() => []);
  for (const vr of editor.visibleRanges) {
    const start = Math.max(0, vr.start.line), end = Math.min(doc.lineCount - 1, vr.end.line);
    for (let ln = start; ln <= end; ln++) {
      const text = doc.lineAt(ln).text;
      if (!text) continue;
      for (const f of tokenizeLine(text, delim)) {
        if (f.end > f.start) perCol[f.col % COLUMN_COLORS.length].push(new vscode.Range(ln, f.start, ln, f.end));
      }
    }
  }
  types.forEach((t, i) => editor.setDecorations(t, perCol[i]));
}
export function paintAllEditors() { for (const ed of vscode.window.visibleTextEditors) paintEditor(ed); }
/** The panel's delimiter changed for a painted file: repaint it. */
export function refreshPainted(uriString: string) {
  for (const ed of vscode.window.visibleTextEditors) if (ed.document.uri.toString() === uriString) paintEditor(ed);
}
export function registerPainter(ctx: vscode.ExtensionContext, hint: (uriString: string) => string | undefined) {
  ctxRef = ctx;
  delimiterFor = hint;
  types = COLUMN_COLORS.map(c => vscode.window.createTextEditorDecorationType({ color: c }));
  ctx.subscriptions.push(...types);
  let editTimer: NodeJS.Timeout | undefined;
  ctx.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges(e => paintEditor(e.textEditor)),
    vscode.window.onDidChangeVisibleTextEditors(() => paintAllEditors()),
    vscode.window.onDidChangeActiveTextEditor(() => paintAllEditors()),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (!isPainted(e.document.uri.toString())) return;
      if (editTimer) clearTimeout(editTimer);
      editTimer = setTimeout(() => paintAllEditors(), 150);
    }),
  );
  paintAllEditors();
  log('Color Columns painter ready (in-place painting for synced documents).');
}
