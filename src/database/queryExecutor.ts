
import type { Database } from 'sql.js';
export interface QueryResult { columns: string[]; rows: (string|null)[][]; rowCount: number; truncated: boolean; ms: number; }
export function executeQuery(db: Database, sql: string, limit: number): QueryResult {
  const started = Date.now();
  const res = db.exec(sql);
  const ms = Date.now() - started;
  if (!res.length) return { columns: [], rows: [], rowCount: 0, truncated: false, ms };
  const { columns, values } = res[0];
  const total = values.length;
  const rows = values.slice(0, limit).map(r => r.map(v => v === null ? null : String(v)));
  return { columns, rows, rowCount: total, truncated: total > limit, ms };
}
export function stripSql(sql: string): string { return sql.trim().replace(/;+\s*$/, ''); }
export interface PagedResult { columns: string[]; rows: (string|null)[][]; total: number; offset: number; pageSize: number; ms: number; }
/** Page through a SELECT's complete result set with no row cap: the user's SQL runs as a
    subquery, so COUNT(*) gives the true total and LIMIT/OFFSET fetches any window of it.
    A LIMIT inside the user's own SQL is respected (it bounds the subquery).
    Throws for non-SELECT / multi-statement SQL; callers fall back to executeQuery. */
export function queryPage(db: Database, sql: string, pageSize: number, offset: number): PagedResult {
  const started = Date.now(); const inner = stripSql(sql);
  const limit = Math.max(1, Math.floor(pageSize)); const off = Math.max(0, Math.floor(offset));
  const countRes = db.exec(`SELECT COUNT(*) AS n FROM (${inner})`);
  const total = Number(countRes[0].values[0][0]);
  const pageRes = db.exec(`SELECT * FROM (${inner}) LIMIT ${limit} OFFSET ${off}`);
  const ms = Date.now() - started;
  if (!pageRes.length) return { columns: [], rows: [], total, offset: off, pageSize: limit, ms };
  const { columns, values } = pageRes[0];
  return { columns, rows: values.map(r => r.map(v => v === null ? null : String(v))), total, offset: off, pageSize: limit, ms };
}
