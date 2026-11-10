
export function escapeField(v: string | null, delimiter: string): string {
  if (v === null) return '';
  if (v.includes(delimiter) || v.includes('"') || v.includes('\n') || v.includes('\r')) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
export function toDelimited(columns: string[], rows: (string|null)[][], delimiter = ',', includeBom = false): string {
  const lines = [columns.map(c=>escapeField(c,delimiter)).join(delimiter), ...rows.map(r=>r.map(v=>escapeField(v,delimiter)).join(delimiter))];
  return (includeBom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}

export function formatRow(values: (string | null)[], delimiter: string): string { return values.map(v => escapeField(v, delimiter)).join(delimiter); }

/** Suggested download filename for an export: "<source base>_results.csv".
 *  Falls back to "query-results.csv" for untitled/blank sources. */
export function suggestExportFileName(sourceName: string): string {
  let base = (sourceName || '').split(/[\\/]/).pop() || '';
  base = base.replace(/\.[^.]*$/, '').trim();
  if (!base || /^untitled/i.test(base)) base = 'query-results';
  return `${base}_results.csv`.replace('query-results_results.csv', 'query-results.csv');
}
