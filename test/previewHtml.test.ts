import { test } from 'node:test'; import assert from 'node:assert';
import { buildColorPreviewHtml, PREVIEW_LINES } from '../src/colorizer/previewHtml';

test('color preview colours each field with its column class and dims delimiters', () => {
  const { html, shown, total } = buildColorPreviewHtml('A|B\n1|2', '|');
  assert.equal(shown, 2); assert.equal(total, 2);
  assert.ok(html.includes('<span class="c0">A</span>'), 'first field gets class c0');
  assert.ok(html.includes('<span class="c1">B</span>'), 'second field gets class c1');
  assert.ok(html.includes('<span class="d">|</span>'), 'delimiter is dimmed');
  assert.ok(html.includes('hdr'), 'first row is marked as the header');
});

test('color preview escapes HTML and respects quoted delimiters', () => {
  const { html } = buildColorPreviewHtml('"<a>|b",c', ',');
  assert.ok(!html.includes('<a>'), 'raw HTML from the file must never reach the preview');
  assert.ok(html.includes('&lt;a&gt;'), 'angle brackets are escaped');
  assert.ok(html.includes('<span class="c1">c</span>'), 'quoted comma does not shift the columns');
});

test('color preview caps at PREVIEW_LINES lines', () => {
  const big = Array.from({ length: PREVIEW_LINES + 50 }, (_, i) => `r${i},x`).join('\n');
  const { shown, total } = buildColorPreviewHtml(big, ',');
  assert.equal(shown, PREVIEW_LINES); assert.equal(total, PREVIEW_LINES + 50);
});
