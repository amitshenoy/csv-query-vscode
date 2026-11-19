import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { QueryPanel } from './queryPanel';
import { ColorEditorProvider } from './colorizer/colorEditor';
import { registerPainter } from './colorizer/colorizer';
import { initLog, log } from './utils/log';
export function activate(ctx: vscode.ExtensionContext) {
  initLog();
  try {
    log('CSV Query extension activated.');
    // The Color Editor provider goes FIRST: until 1.3.4 it was registered last,
    // after a duplicate QueryPanel.register() call that threw on the repeated
    // view-provider registration — so this line was never reached and VS Code
    // opened Color Editor tabs (from the manifest contribution) with no
    // provider behind them: black, silent, in every version. The try/catch and
    // the completion lines make any future activation failure name itself in
    // the CSV Query log instead of hiding in the extension host log.
    ctx.subscriptions.push(vscode.window.registerCustomEditorProvider(ColorEditorProvider.viewType, new ColorEditorProvider(ctx), { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
    log('Color Editor provider registered.');
    registerCommands(ctx);
    registerPainter(ctx, (u) => QueryPanel.current?.delimiterFor(u));
    // Register the panel eagerly (not on first command) so it can follow the
    // active editor from the start; createOrShow reuses this instance.
    QueryPanel.register(ctx);
    log('Activation complete.');
  } catch (e) {
    log(`ACTIVATION FAILED: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}
export function deactivate() {}
