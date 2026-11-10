import * as vscode from 'vscode';
let channel: vscode.OutputChannel | undefined;
export function initLog(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('CSV Query');
  return channel;
}
export function log(msg: string) {
  try { initLog().appendLine(`[${new Date().toISOString()}] ${msg}`); } catch { /* logging must never break the extension */ }
}
