
import { test } from 'node:test'; import assert from 'node:assert';
import { detectDelimiter } from '../src/parser/delimiterDetector';
test('detects pipe',()=>{assert.equal(detectDelimiter('A|B|C\n1|2|3\n4|5|6').delimiter,'|');});
test('detects comma',()=>{assert.equal(detectDelimiter('A,B,C\n1,2,3').delimiter,',');});
test('detects tab',()=>{assert.equal(detectDelimiter('A\tB\tC\n1\t2\t3').delimiter,'\t');});
test('detects semicolon',()=>{assert.equal(detectDelimiter('A;B;C\n1;2;3').delimiter,';');});
