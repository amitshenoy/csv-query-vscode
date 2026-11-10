
import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs'; import * as path from 'path';
let SQL: any;
export async function initEngine(wasmPath?: string): Promise<void> {
  if (SQL) return;
  const locate = wasmPath && fs.existsSync(wasmPath) ? wasmPath : undefined;
  SQL = await initSqlJs(locate ? { locateFile: () => locate! } : { locateFile: (f: string) => path.join(__dirname, f) });
}
export function createDb(): Database { if (!SQL) throw new Error('SQLite engine not initialised'); return new SQL.Database(); }
export function getSQL(){ return SQL; }
