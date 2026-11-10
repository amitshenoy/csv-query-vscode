import * as vscode from 'vscode';
import { QueryPanel } from './queryPanel';
export function registerCommands(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('csvQuery.openQueryPanel', (uri?: vscode.Uri) => QueryPanel.createOrShow(ctx, uri)),
    vscode.commands.registerCommand('csvQuery.queryWith', (uri?: vscode.Uri) => QueryPanel.createOrShow(ctx, uri)),
    vscode.commands.registerCommand('csvQuery.reloadActiveFile', async () => { if (QueryPanel.current) await QueryPanel.current.reloadSource(); else await QueryPanel.createOrShow(ctx); }),
    vscode.commands.registerCommand('csvQuery.changeDelimiter', () => QueryPanel.current?.changeDelimiter()),
    vscode.commands.registerCommand('csvQuery.addFileAsTable', () => QueryPanel.current?.addFile()),
    vscode.commands.registerCommand('csvQuery.exportQueryResults', () => QueryPanel.current?.exportLast()),
    vscode.commands.registerCommand('csvQuery.clearHistory', () => QueryPanel.current?.clearHistory()),
  );
}
