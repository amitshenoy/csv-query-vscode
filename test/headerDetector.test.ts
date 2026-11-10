
import { test } from 'node:test'; import assert from 'node:assert';
import { detectHeader } from '../src/parser/headerDetector';
test('header text row',()=>{assert.equal(detectHeader([['Employee_ID','Name'],['001234','Amit']]),true);});
test('numeric first row is data',()=>{assert.equal(detectHeader([['10001','10002'],['10003','PC007']]),false);});
