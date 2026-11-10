
import type { Database } from 'sql.js';
import { quoteIdent } from '../utils/identifiers';
import type { ParsedFile } from '../parser/delimitedParser';
export interface LoadedTable { name: string; source: string; rows: number; columns: number; columnNames: string[]; }
function lit(v: string): string { return "'" + String(v ?? '').replace(/'/g, "''") + "'"; }
function insertChunk(db: Database, q: string, parsed: ParsedFile, from: number, to: number) {
  const tuples: string[] = [];
  for (let i = from; i < to; i++) tuples.push('(' + parsed.rows[i].map(lit).join(',') + ')');
  db.run(`INSERT INTO ${q} VALUES ${tuples.join(',')};`);
}
function createTable(db: Database, tableName: string, parsed: ParsedFile) {
  const q = quoteIdent(tableName);
  db.run(`DROP TABLE IF EXISTS ${q};`);
  db.run(`CREATE TABLE ${q} (${parsed.columns.map(c => `${quoteIdent(c.name)} TEXT`).join(', ')});`);
  return q;
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
