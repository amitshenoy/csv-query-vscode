
import { test } from 'node:test'; import assert from 'node:assert';
import { toDelimited, formatRow } from '../src/export/resultExporter';
test('TEST11 export preserves leading zeros, commas, quotes, multiline',()=>{const out=toDelimited(['ID','Desc'],[['001234','a,b'],['0001','say "hi"'],['0002','line1\nline2']],',',false);assert.match(out,/001234/);assert.match(out,/"a,b"/);assert.match(out,/"say ""hi"""/);assert.match(out,/"line1\nline2"/);});
test('formatRow (streaming export row) quoting',()=>{assert.equal(formatRow(['001234','a,b',null],','),'001234,"a,b",');});
test('suggestExportFileName derives <source>_results.csv',()=>{const {suggestExportFileName}=require('../src/export/resultExporter');assert.equal(suggestExportFileName('SHC_General_Ledger_Detail_11102026.txt'),'SHC_General_Ledger_Detail_11102026_results.csv');assert.equal(suggestExportFileName('Untitled-1'),'query-results.csv');assert.equal(suggestExportFileName(''),'query-results.csv');assert.equal(suggestExportFileName('/data/reports/q1.clar'),'q1_results.csv');});
