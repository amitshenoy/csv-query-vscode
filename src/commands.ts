import * as vscode from 'vscode';
import { QueryPanel } from './queryPanel';
import { ColorPreviewPanel } from './colorizer/colorPreview';
import { ColorEditorProvider } from './colorizer/colorEditor';
import { togglePaint } from './colorizer/colorizer';
export function registerCommands(ctx: vscode.ExtensionContext) {
  QueryPanel.register(ctx);
  ctx.subscriptions.push(
    vscode.commands.registerCommand('csvQuery.openQueryPanel', (uri?: vscode.Uri) => QueryPanel.createOrShow(ctx, uri)),
    vscode.commands.registerCommand('csvQuery.queryWith', (uri?: vscode.Uri) => QueryPanel.createOrShow(ctx, uri)),
    vscode.commands.registerCommand('csvQuery.reloadActiveFile', async () => { if (QueryPanel.current) await QueryPanel.current.reloadSource(); else await QueryPanel.createOrShow(ctx); }),
    vscode.commands.registerCommand('csvQuery.changeDelimiter', () => QueryPanel.current?.changeDelimiter()),
    vscode.commands.registerCommand('csvQuery.addFileAsTable', () => QueryPanel.current?.addFile()),
    vscode.commands.registerCommand('csvQuery.exportQueryResults', () => QueryPanel.current?.exportLast()),
    vscode.commands.registerCommand('csvQuery.clearHistory', () => QueryPanel.current?.clearHistory()),
    vscode.commands.registerCommand('csvQuery.toggleColors', async () => {
      // The panel's toggle is the main route. Without a panel, an active text
      // editor means the document is synced, so paint it in place; with no
      // editor at all there is nothing to colour.
      const panel = QueryPanel.current;
      if (panel) { await panel.toggleColor(); return; }
      if (ColorPreviewPanel.current) { ColorPreviewPanel.current.close(); return; }
      const ed = vscode.window.activeTextEditor;
      if (!ed) { vscode.window.showWarningMessage('CSV Query: open a delimited file to color its columns.'); return; }
      await togglePaint(ed.document.uri.toString());
    }),
    vscode.commands.registerCommand('csvQuery.openColorEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || target.scheme !== 'file') { vscode.window.showWarningMessage('CSV Query: the Color Editor opens files on disk — save the file first.'); return; }
      await ColorEditorProvider.openEditor(target);
    }),
  );
}
