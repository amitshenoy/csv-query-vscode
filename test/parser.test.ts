
import { test } from 'node:test'; import assert from 'node:assert';
import { parseDelimited } from '../src/parser/delimitedParser';
test('TEST4 leading zeros preserved as text',()=>{const p=parseDelimited('Employee_ID,Name\n001234,Amit');assert.equal(p.rows[0][0],'001234');});
test('TEST6 quoted delimiter',()=>{const p=parseDelimited('ID,Description,PayorCode\n1001,"Ad Hoc Bank Transaction, Children First",PC007');assert.equal(p.rows[0][1],'Ad Hoc Bank Transaction, Children First');assert.equal(p.rows[0].length,3);});
test('TEST7 pipe inside quotes',()=>{const p=parseDelimited('ID|Description|PayorCode\n1001|"Description with | symbol"|PC007');assert.equal(p.rows[0][1],'Description with | symbol');});
test('TEST8 duplicate headers unique',()=>{const p=parseDelimited('ID,Name,Name,\n1,a,b,c');assert.equal(new Set(p.columns.map(c=>c.name)).size,4);});
test('TEST5 mixed identifiers load',()=>{const p=parseDelimited('PayorCode\n10001\n10002\nPC007');assert.deepEqual(p.rows.map(r=>r[0]),['10001','10002','PC007']);});
test('no header generates Column1..',()=>{const p=parseDelimited('10001,10002\n10003,PC007',{hasHeader:false});assert.deepEqual(p.columns.map(c=>c.name),['Column1','Column2']);});
test('BOM and CRLF',()=>{const p=parseDelimited('\uFEFFA,B\r\n1,2\r\n');assert.equal(p.columns[0].name,'A');assert.equal(p.rows.length,1);});

test('300k rows parse without stack overflow (regression: Math.max spread)',()=>{const rows=['A|B|C'];for(let i=0;i<300000;i++)rows.push('10|PC007|hello');rows.push('1|2|3|4');const p=parseDelimited(rows.join('\n'));assert.equal(p.rows.length,300001);assert.equal(p.columns.length,4);});
test('spaced headers lose spaces in names, labels keep originals',()=>{const p=parseDelimited('Entity Code|Spend Category|Revenue Category\n19|SC0127|000000');assert.deepEqual(p.columns.map(c=>c.name),['EntityCode','SpendCategory','RevenueCategory']);assert.deepEqual(p.columns.map(c=>c.label),['Entity Code','Spend Category','Revenue Category']);});
test('headers colliding after space-stripping get suffixed',()=>{const p=parseDelimited('Spend Category|SpendCategory\nSC0127|SC0129');assert.deepEqual(p.columns.map(c=>c.name),['SpendCategory','SpendCategory_2']);});
