import { test, before } from 'node:test'; import assert from 'node:assert';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { initEngine, createDb } from '../src/database/sqliteEngine';
import { loadTableFromFile } from '../src/database/streamLoader';
import { executeQuery } from '../src/database/queryExecutor';
before(async () => { await initEngine(path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')); });

function tmpFile(content: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csvq-')), 'data.txt');
  fs.writeFileSync(p, content);
  return p;
}

test('stream loader: pipe file with header loads and is queryable', async () => {
  const db = createDb();
  const f = tmpFile('EntityCode|AccountCode|Spend Category\n10|741095|SC0166\n10|741000|SC0165\n');
  const res = await loadTableFromFile(db, 'THIS', f, 'inv.txt');
  assert.equal(res.delimiter, '|'); assert.equal(res.hasHeader, true);
  assert.equal(res.loaded.rows, 2); assert.equal(res.loaded.columns, 3);
  const r = executeQuery(db, "SELECT * FROM THIS WHERE SpendCategory = 'SC0165'", 10);
  assert.deepEqual(r.rows, [['10', '741000', 'SC0165']]);
  assert.ok(res.headText.includes('EntityCode'), 'head sample kept for the preview');
  db.close();
});

test('stream loader: a later row wider than the header widens the table (two-pass width)', async () => {
  const db = createDb();
  const f = tmpFile('A,B\n1,2\n3,4,5\n');
  const res = await loadTableFromFile(db, 'THIS', f, 'ragged.csv');
  assert.equal(res.loaded.columns, 3);
  const r = executeQuery(db, 'SELECT * FROM THIS ORDER BY A', 10);
  assert.deepEqual(r.rows, [['1', '2', ''], ['3', '4', '5']]);
  db.close();
});

test('stream loader: quoted newlines, blank lines and CRLF survive streaming', async () => {
  const db = createDb();
  const f = tmpFile('Name,Note\r\n"O\'Brien","line1\nline2"\r\n\r\nSmith,001234\r\n');
  const res = await loadTableFromFile(db, 'THIS', f, 'q.csv');
  assert.equal(res.loaded.rows, 2);
  const r = executeQuery(db, "SELECT Note FROM THIS WHERE Name = 'O''Brien'", 10);
  assert.equal(r.rows[0][0], 'line1\nline2');
  const r2 = executeQuery(db, "SELECT Note FROM THIS WHERE Name = 'Smith'", 10);
  assert.equal(r2.rows[0][0], '001234');
  db.close();
});

test('stream loader: no-header file gets ColumnN names; empty file still creates a table', async () => {
  const db = createDb();
  const f = tmpFile('100|200\n300|400\n');
  const res = await loadTableFromFile(db, 'THIS', f, 'nohdr.txt', { delimiter: '|' });
  assert.equal(res.hasHeader, false); assert.equal(res.loaded.rows, 2);
  assert.deepEqual(res.loaded.columnNames, ['Column1', 'Column2']);
  const empty = await loadTableFromFile(db, 'REF', tmpFile(''), 'empty.txt');
  assert.equal(empty.loaded.rows, 0); assert.deepEqual(empty.loaded.columnNames, ['Column1']);
  db.close();
});

test('stream loader: progress reports scan then load phases with the true total', async () => {
  const db = createDb();
  const lines = ['N']; for (let i = 0; i < 12000; i++) lines.push(String(i));
  const f = tmpFile(lines.join('\n'));
  const phases: string[] = []; let last: [number, number] = [0, 0];
  const res = await loadTableFromFile(db, 'THIS', f, 'big.csv', {}, (done, total, phase) => { phases.push(phase); last = [done, total]; });
  assert.equal(res.loaded.rows, 12000);
  assert.ok(phases.includes('scan'), 'scan phase reported');
  assert.equal(phases[phases.length - 1], 'load');
  assert.deepEqual(last, [12000, 12000]);
  db.close();
});

test('stream loader: cancellation aborts promptly with LoadCancelledError', async () => {
  const db = createDb();
  const lines = ['N']; for (let i = 0; i < 60000; i++) lines.push(String(i));
  const f = tmpFile(lines.join('\n'));
  let calls = 0;
  await assert.rejects(
    loadTableFromFile(db, 'THIS', f, 'cancel.csv', { cancelled: () => ++calls > 3 }, () => {}),
    (e: unknown) => e instanceof Error && e.name === 'LoadCancelledError',
  );
  db.close();
});
