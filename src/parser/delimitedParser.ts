
import Papa from 'papaparse';
import { detectDelimiter } from './delimiterDetector';
import { detectHeader } from './headerDetector';
import { makeUniqueColumns } from '../utils/identifiers';
export interface ParsedFile {
  delimiter: string; hasHeader: boolean; confidence: number;
  columns: { name: string; label: string }[];
  rows: string[][]; // data rows, padded/truncated to column count, empty string preserved; parser never yields null here
}
export function parseDelimited(text: string, opts: { delimiter?: string; hasHeader?: boolean } = {}): ParsedFile {
  const clean = text.replace(/^\uFEFF/, '');
  const det = opts.delimiter ? { delimiter: opts.delimiter, confidence: 1 } : detectDelimiter(clean);
  const res = Papa.parse<string[]>(clean, { delimiter: det.delimiter, skipEmptyLines: false });
  let all = (res.data as unknown as string[][]).map(r => (Array.isArray(r) ? r.map(v => v ?? '') : [String(r ?? '')]));
  // Drop fully trailing empty record produced by final newline
  while (all.length && all[all.length-1].length === 1 && all[all.length-1][0] === '') all.pop();
  // Remove blank lines in middle? Keep spec: skip lines that are single empty field only if they were blank lines
  all = all.filter(r => !(r.length === 1 && r[0] === ''));
  if (!all.length) return { delimiter: det.delimiter, hasHeader: false, confidence: det.confidence, columns: [{name:'Column1',label:'Column1'}], rows: [] };
  // Width via a plain loop: Math.max(...rows) spreads every row as a call argument and
  // throws RangeError: Maximum call stack size exceeded somewhere between 100k–200k rows.
  let width = 0; for (const r of all) { if (r.length > width) width = r.length; }
  const padded = all.map(r => { while (r.length<width) r.push(''); if (r.length>width) r.length = width; return r; });
  const hasHeader = opts.hasHeader !== undefined ? opts.hasHeader : detectHeader(padded);
  const labels = hasHeader ? padded[0] : Array.from({length: width}, (_,i)=>`Column${i+1}`);
  const columns = makeUniqueColumns(labels);
  const rows = hasHeader ? padded.slice(1) : padded;
  return { delimiter: det.delimiter, hasHeader, confidence: det.confidence, columns, rows };
}
