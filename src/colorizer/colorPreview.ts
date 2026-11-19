import * as vscode from 'vscode';
import { buildColorPreviewHtml } from './previewHtml';
import { delimiterLabel } from '../parser/delimiterDetector';
import { log } from '../utils/log';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The Color Columns preview: a colourised rendering of the loaded file's first
    lines, built from the text the panel already read from disk. This shape is
    forced by a hard VS Code limit, proven by Amit's 91.6 MB AP file: above 50 MB
    VS Code will not give extensions the document at all ("Files above 50MB
    cannot be synchronized with extensions" — the same wall v0.1.4 hit), so
    editor decorations are impossible for exactly the files that need them.
    A preview built from our own copy of the text has no such limit. */
export class ColorPreviewPanel {
  static current: ColorPreviewPanel | undefined;
  private panel: vscode.WebviewPanel;

  private constructor(private ctx: vscode.ExtensionContext, private onStateChange: () => void) {
    this.panel = vscode.window.createWebviewPanel('csvQuery.colorPreview', 'Color Columns', vscode.ViewColumn.Beside, {
      enableScripts: false, localResourceRoots: [ctx.extensionUri], retainContextWhenHidden: true,
    });
    this.panel.onDidDispose(() => {
      if (ColorPreviewPanel.current === this) ColorPreviewPanel.current = undefined;
      this.onStateChange();
    });
  }

  static show(ctx: vscode.ExtensionContext, sourceName: string, text: string, delimiter: string, onStateChange: () => void): ColorPreviewPanel {
    if (ColorPreviewPanel.current) {
      ColorPreviewPanel.current.update(sourceName, text, delimiter);
      ColorPreviewPanel.current.panel.reveal();
      return ColorPreviewPanel.current;
    }
    const p = new ColorPreviewPanel(ctx, onStateChange);
    ColorPreviewPanel.current = p;
    p.update(sourceName, text, delimiter);
    log(`Color Columns preview opened for ${sourceName}`);
    return p;
  }

  update(sourceName: string, text: string, delimiter: string) {
    this.panel.title = `Color Columns — ${sourceName}`;
    const { html, shown, total } = buildColorPreviewHtml(text, delimiter);
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'colors.css'));
    this.panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource};">
<link rel="stylesheet" href="${styleUri}">
</head><body>
<div class="note">Color Columns — ${esc(sourceName)} · Delimiter: ${esc(delimiterLabel(delimiter))} · showing the first ${shown.toLocaleString()} of ${total.toLocaleString()} lines</div>
<div class="wrap">${html}</div>
</body></html>`;
  }

  close() { this.panel.dispose(); }
}
