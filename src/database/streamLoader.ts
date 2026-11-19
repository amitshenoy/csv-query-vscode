import * as fs from 'fs';
import Papa from 'papaparse';
import type { Database } from 'sql.js';
import { detectDelimiter } from '../parser/delimiterDetector';
import { detectHeader } from '../parser/headerDetector';
import { makeUniqueColumns } from '../utils/identifiers';
import { createTableFromColumns, insertRows, type LoadedTable } from './tableLoader';

export interface StreamLoadResult {
  loaded: LoadedTable;
  delimiter: string;
  hasHeader: boolean;
  columns: { name: string; label: string }[];
  /** The file's first bytes (BOM-stripped) — enough for the Color Columns preview,
      which only ever renders the first few hundred lines. */
  headText: string;
}

/** Thrown when a load is aborted via opts.cancelled — e.g. the user switched to
    another file and the panel moved on. Callers treat it as benign, never an error. */
export class LoadCancelledError extends Error {
  constructor() { super('Load cancelled'); this.name = 'LoadCancelledError'; }
}

export type LoadPhase = 'scan' | 'load';
export type LoadProgress = (done: number, total: number, phase: LoadPhase) => void;

const SAMPLE_BYTES = 512 * 1024;
const BATCH = 500;

async function readHead(filePath: string, bytes: number): Promise<string> {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally { await fh.close(); }
}

function isBlankRow(r: string[]): boolean { return r.length === 1 && r[0] === ''; }
function padRow(r: string[], width: number): string[] {
  const out = r.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}
function stripBomCell(row: string[], isFirst: boolean): string[] {
  if (isFirst && row.length && row[0].startsWith('\uFEFF')) return [row[0].slice(1), ...row.slice(1)];
  return row;
}

/** Stream a delimited file through Papa Parse row by row. Mirrors parseDelimited's
    row semantics: blank single-field lines are skipped entirely (which also drops
    the trailing record a final newline produces). If `cancelled` starts returning
    true, parsing aborts and the promise rejects with LoadCancelledError. */
function streamRows(filePath: string, delimiter: string, onRow: (row: string[], parser: { pause(): void; resume(): void; abort(): void }) => void, cancelled?: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });
    stream.on('error', (e) => done(() => reject(cancelled?.() ? new LoadCancelledError() : e)));
    Papa.parse(stream as unknown as string, {
      delimiter, skipEmptyLines: false,
      step: (res: Papa.ParseStepResult<string[]>, parser: unknown) => {
        const p = parser as { pause(): void; resume(): void; abort(): void };
        if (cancelled?.()) { try { p.abort(); } catch {} try { stream.destroy(); } catch {} return; }
        const raw: unknown = res.data;
        const row = Array.isArray(raw) ? raw.map(v => (v ?? '') as string) : [String(raw ?? '')];
        onRow(row, p);
      },
      complete: () => done(() => (cancelled?.() ? reject(new LoadCancelledError()) : resolve())),
      error: (e: Error) => done(() => reject(cancelled?.() ? new LoadCancelledError() : (e instanceof Error ? e : new Error(String((e as unknown as { message?: string })?.message ?? e))))),
    });
  });
}

/** Load a delimited file into SQLite by streaming it from disk in two passes —
    pass 1 finds the true column width (a later row may be wider than the header),
    counts rows and samples the first rows for header detection; pass 2 inserts in
    500-row batches inside one transaction. The whole file is never held as a
    single string, and parsed rows are never all kept in memory: the previous
    read-whole-file path died with RangeError "Invalid string length" on a real
    multi-hundred-MB export, because V8 caps a string at ~512M characters no
    matter how much RAM the machine has. Peak memory here is the SQLite database
    itself plus one batch. */
export async function loadTableFromFile(
  db: Database, tableName: string, filePath: string, sourceLabel: string,
  opts: { delimiter?: string; hasHeader?: boolean; cancelled?: () => boolean } = {},
  onProgress?: LoadProgress,
): Promise<StreamLoadResult> {
  const headText = (await readHead(filePath, SAMPLE_BYTES)).replace(/^\uFEFF/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(headText).delimiter;

  // Pass 1: width, row count, first rows. Progress is reported as rows scanned
  // (the total is what this pass exists to discover), yielding every 5,000 rows
  // so the panel can paint and a cancellation lands promptly.
  let width = 0; let totalRows = 0; const sample: string[][] = []; let firstRow: string[] | undefined;
  await streamRows(filePath, delimiter, (row, parser) => {
    const r = stripBomCell(row, totalRows === 0 && !firstRow);
    if (isBlankRow(r)) return;
    totalRows++;
    if (r.length > width) width = r.length;
    if (!firstRow) firstRow = r;
    if (sample.length < 20) sample.push(r);
    if (totalRows % 5000 === 0) {
      try { parser.pause(); onProgress?.(totalRows, 0, 'scan'); setTimeout(() => { try { parser.resume(); } catch {} }, 0); } catch {}
    }
  }, opts.cancelled);

  if (!totalRows || width === 0 || !firstRow) {
    const columns = [{ name: 'Column1', label: 'Column1' }];
    createTableFromColumns(db, tableName, columns);
    return { loaded: { name: tableName, source: sourceLabel, rows: 0, columns: 1, columnNames: ['Column1'] }, delimiter, hasHeader: false, columns, headText };
  }

  const hasHeader = opts.hasHeader !== undefined ? opts.hasHeader : detectHeader(sample.map(r => padRow(r, width)));
  const labels = hasHeader ? padRow(firstRow, width) : Array.from({ length: width }, (_, i) => `Column${i + 1}`);
  const columns = makeUniqueColumns(labels);
  const q = createTableFromColumns(db, tableName, columns);
  const dataTotal = totalRows - (hasHeader ? 1 : 0);

  // Pass 2: insert, yielding to the event loop every 5,000 rows for progress.
  let seen = 0; let inserted = 0; let batch: string[][] = [];
  const flush = () => { if (batch.length) { insertRows(db, q, batch); batch = []; } };
  try {
    db.run('BEGIN TRANSACTION;');
    await streamRows(filePath, delimiter, (row, parser) => {
      const r = stripBomCell(row, seen === 0);
      if (isBlankRow(r)) return;
      seen++;
      if (hasHeader && seen === 1) return;
      batch.push(padRow(r, width));
      inserted++;
      if (batch.length >= BATCH) flush();
      if (inserted % 5000 === 0 && inserted < dataTotal) {
        try { parser.pause(); onProgress?.(inserted, dataTotal, 'load'); setTimeout(() => { try { parser.resume(); } catch {} }, 0); } catch {}
      }
    }, opts.cancelled);
    flush();
    db.run('COMMIT;');
  } catch (e) { try { db.run('ROLLBACK;'); } catch {} throw e; }
  onProgress?.(dataTotal, dataTotal, 'load');
  return { loaded: { name: tableName, source: sourceLabel, rows: dataTotal, columns: width, columnNames: columns.map(c => c.name) }, delimiter, hasHeader, columns, headText };
}
