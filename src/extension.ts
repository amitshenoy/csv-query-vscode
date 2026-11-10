
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { initLog, log } from './utils/log';
export function activate(ctx: vscode.ExtensionContext) { initLog(); log('CSV Query extension activated.'); registerCommands(ctx); }
export function deactivate() {}
