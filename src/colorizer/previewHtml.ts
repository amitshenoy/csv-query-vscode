import { tokenizeLine } from './lineTokenizer';

export const PREVIEW_LINES = 300;
const MAX_LINE_CHARS = 20000;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render raw lines as colourised HTML rows: every field wrapped in a span of its
    column class (c0..c7, colours in media/colors.css, matching the palette),
    delimiters dimmed, line numbers on the left. `firstLineNumber` is the 1-based
    number of lines[0]; the file's first line (number 1) is marked as the header.
    Shared by the Color Columns preview (first 300 lines of a buffer) and the
    Color Editor (any window of a file, via its line index). Pure and unit-tested. */
export function buildColorLinesHtml(lines: string[], delimiter: string, firstLineNumber: number): string {
  const delimHtml = `<span class="d">${esc(delimiter)}</span>`;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const n = firstLineNumber + i;
    let line = lines[i].replace(/\r$/, '');
    if (line.length > MAX_LINE_CHARS) line = line.slice(0, MAX_LINE_CHARS) + '…';
    const fields = tokenizeLine(line, delimiter);
    const parts = fields.map((f, idx) => `${idx ? delimHtml : ''}<span class="c${f.col % 8}">${esc(line.slice(f.start, f.end))}</span>`).join('');
    out.push(`<div class="ln${n === 1 ? ' hdr' : ''}"><span class="no">${n}</span>${parts}</div>`);
  }
  return out.join('');
}

/** Build the colourised preview body for a buffer's text — only the first
    PREVIEW_LINES lines; the preview is for eyeballing structure, not reading
    end to end. (Files use the Color Editor instead, which covers every line.) */
export function buildColorPreviewHtml(text: string, delimiter: string): { html: string; shown: number; total: number } {
  const lines = text.split('\n');
  const total = lines.length;
  const shown = Math.min(total, PREVIEW_LINES);
  return { html: buildColorLinesHtml(lines.slice(0, shown), delimiter, 1), shown, total };
}
