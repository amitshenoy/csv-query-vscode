import type { Database } from 'sql.js';
import { quoteIdent } from '../utils/identifiers';
import type { ParsedFile } from '../parser/delimitedParser';
export interface LoadedTable { name: string; source: string; rows: number; columns: number; columnNames: string[]; }
function lit(v: string): string { return "'" + String(v ?? '').replace(/'/g, "''") + "'"; }
/** Insert raw row arrays as one bulk literal INSERT — crosses the JS/WASM boundary
    once per call instead of once per row. Rows must already match the column count. */
export function insertRows(db: Database, quotedTable: string, rows: string[][]) {
  if (!rows.length) return;
  const tuples = rows.map(r => '(' + r.map(lit).join(',') + ')');
  db.run(`INSERT INTO ${quotedTable} VALUES ${tuples.join(',')};`);
}
/** DROP + CREATE a table with ALL columns TEXT from {name} columns; returns the quoted name. */
export function createTableFromColumns(db: Database, tableName: string, columns: { name: string }[]): string {
  const q = quoteIdent(tableName);
  db.run(`DROP TABLE IF EXISTS ${q};`);
  db.run(`CREATE TABLE ${q} (${columns.map(c => `${quoteIdent(c.name)} TEXT`).join(', ')});`);
  return q;
}
function insertChunk(db: Database, q: string, parsed: ParsedFile, from: number, to: number) {
  insertRows(db, q, parsed.rows.slice(from, to));
}
function createTable(db: Database, tableName: string, parsed: ParsedFile) {
  return createTableFromColumns(db, tableName, parsed.columns);
}
const CHUNK = 500;
/** Create table with ALL columns TEXT and insert in bulk chunks inside one transaction.
    Bulk literal inserts cross the JS/WASM boundary once per 500 rows instead of once per row. */
export function loadTable(db: Database, tableName: string, parsed: ParsedFile, source: string): LoadedTable {
  const q = createTable(db, tableName, parsed);
  try { db.run('BEGIN TRANSACTION;'); for (let i = 0; i < parsed.rows.length; i += CHUNK) insertChunk(db, q, parsed, i, Math.min(i + CHUNK, parsed.rows.length)); db.run('COMMIT;'); }
  catch (e) { try { db.run('ROLLBACK;'); } catch {} throw e; }
  return { name: tableName, source, rows: parsed.rows.length, columns: parsed.columns.length, columnNames: parsed.columns.map(c => c.name) };
}
/** Same, but yields to the event loop between chunks and reports progress, so a large
    file loads progressively instead of freezing the extension host (and the panel with it). */
export async function loadTableAsync(db: Database, tableName: string, parsed: ParsedFile, source: string, onProgress?: (done: number, total: number) => void): Promise<LoadedTable> {
  const q = createTable(db, tableName, parsed);
  try { db.run('BEGIN TRANSACTION;');
    for (let i = 0; i < parsed.rows.length; i += CHUNK) { insertChunk(db, q, parsed, i, Math.min(i + CHUNK, parsed.rows.length)); if (onProgress && (i % (CHUNK * 10) === 0)) { onProgress(Math.min(i + CHUNK, parsed.rows.length), parsed.rows.length); await new Promise(r => setTimeout(r, 0)); } }
    db.run('COMMIT;');
  } catch (e) { try { db.run('ROLLBACK;'); } catch {} throw e; }
  onProgress?.(parsed.rows.length, parsed.rows.length);
  return { name: tableName, source, rows: parsed.rows.length, columns: parsed.columns.length, columnNames: parsed.columns.map(c => c.name) };
}
