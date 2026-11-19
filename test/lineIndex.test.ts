import { test } from 'node:test'; import assert from 'node:assert';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { buildLineIndex, readLineRange } from '../src/colorizer/lineIndex';
import { buildColorLinesHtml } from '../src/colorizer/previewHtml';

function tmpFile(content: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csvq-idx-')), 'data.txt');
  fs.writeFileSync(p, content);
  return p;
}

test('line index: offsets and range reads (LF, trailing newline = final empty line)', async () => {
  const f = tmpFile('a|b\n1|2\n3|4\n');
  const idx = await buildLineIndex(f);
  assert.equal(idx.length, 4); // 3 content lines + the empty line after the final \n
  assert.deepEqual(await readLineRange(f, idx, 0, 2), ['a|b', '1|2']);
  assert.deepEqual(await readLineRange(f, idx, 2, 10), ['3|4', '']);
  assert.deepEqual(await readLineRange(f, idx, 99, 5), []);
});

test('line index: CRLF stripped, no trailing newline, quoted newline stays inside its line pair', async () => {
  const f = tmpFile('A,B\r\n"x\ny",2\r\nlast,3');
  const idx = await buildLineIndex(f);
  assert.equal(idx.length, 4); // the quoted \n is a physical line for indexing — colours may misalign after it, the documented limit
  assert.deepEqual(await readLineRange(f, idx, 0, 4), ['A,B', '"x', 'y",2', 'last,3']);
});

test('line index: a window in the middle of a larger file reads exactly those lines', async () => {
  const lines = Array.from({ length: 5000 }, (_, i) => `row${i},v${i}`);
  const f = tmpFile(lines.join('\n'));
  const idx = await buildLineIndex(f);
  assert.equal(idx.length, 5000);
  assert.deepEqual(await readLineRange(f, idx, 4995, 5), lines.slice(4995));
  assert.deepEqual(await readLineRange(f, idx, 0, 1), ['row0,v0']);
});

test('color lines html: numbering starts at the given line, header only on line 1', () => {
  const mid = buildColorLinesHtml(['1|2', '3|4'], '|', 285);
  assert.ok(mid.includes('<span class="no">285</span>'));
  assert.ok(!mid.includes('hdr'), 'no header styling mid-file');
  const top = buildColorLinesHtml(['A|B'], '|', 1);
  assert.ok(top.includes('hdr'));
  assert.ok(top.includes('<span class="c1">B</span>'));
});
