import { test } from 'node:test'; import assert from 'node:assert';
import { tokenizeLine } from '../src/colorizer/lineTokenizer';

const cols = (line: string, d: string) => tokenizeLine(line, d).map(f => f.col);
const texts = (line: string, d: string) => tokenizeLine(line, d).map(f => line.slice(f.start, f.end));

test('tokenizer splits plain fields and keeps exact ranges', () => {
  assert.deepEqual(cols('a|bb|ccc', '|'), [0, 1, 2]);
  assert.deepEqual(texts('a|bb|ccc', '|'), ['a', 'bb', 'ccc']);
  const r = tokenizeLine('a|bb|ccc', '|');
  assert.deepEqual([r[1].start, r[1].end], [2, 4]);
});

test('tokenizer keeps delimiters inside quoted fields literal', () => {
  assert.deepEqual(texts('a|"b|c"|d', '|'), ['a', '"b|c"', 'd']);
  assert.deepEqual(cols('a|"b|c"|d', '|'), [0, 1, 2]);
});

test('tokenizer handles escaped quotes and quotes that are not field-openers', () => {
  assert.deepEqual(texts('"say ""hi""",x', ','), ['"say ""hi"""', 'x']);
  assert.deepEqual(texts('a"b,c', ','), ['a"b', 'c']); // mid-field quote is literal
});

test('tokenizer handles empty fields, trailing delimiter and unterminated quote', () => {
  assert.deepEqual(texts('a||', '|'), ['a', '', '']);
  assert.deepEqual(texts('', '|'), ['']);
  assert.deepEqual(texts('"open,still', ','), ['"open,still']); // never throws, runs to EOL
  assert.deepEqual(cols(['1', '2', '3'].join('\t'), '\t'), [0, 1, 2]);
});
