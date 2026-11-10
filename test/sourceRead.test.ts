import { test } from 'node:test'; import assert from 'node:assert';
import { decideReadMode, dirtyOverSyncLimit, VSCODE_SYNC_LIMIT_BYTES } from '../src/utils/sourceRead';
const MB = 1048576;
test('clean file-backed source reads from disk (never document sync)',()=>{assert.equal(decideReadMode({hasFileUri:true,isUntitled:false,isDirty:false,fileSizeBytes:60*MB}),'disk');});
test('small dirty file uses document so unsaved changes are included',()=>{assert.equal(decideReadMode({hasFileUri:true,isUntitled:false,isDirty:true,fileSizeBytes:2*MB}),'document');});
test('dirty file over 50MB sync limit falls back to disk and warns',()=>{const o={hasFileUri:true,isUntitled:false,isDirty:true,fileSizeBytes:VSCODE_SYNC_LIMIT_BYTES+1};assert.equal(decideReadMode(o),'disk');assert.equal(dirtyOverSyncLimit(o),true);});
test('untitled buffer always uses document',()=>{assert.equal(decideReadMode({hasFileUri:false,isUntitled:true,isDirty:true}),'document');});
test('small clean file also reads from disk (uniform path)',()=>{assert.equal(decideReadMode({hasFileUri:true,isUntitled:false,isDirty:false,fileSizeBytes:1*MB}),'disk');});
