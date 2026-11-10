
export function friendlyError(err: unknown, columns: string[] = [], sql = ''): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lines: string[] = [];
  const colMatch = msg.match(/no such column:\s*(.+)/i);
  const tableMatch = msg.match(/no such table:\s*(.+)/i);
  if (colMatch) {
    lines.push(`Column "${colMatch[1].trim()}" does not exist.`);
    if (columns.length) { lines.push('', 'Available columns:', ...columns); }
  } else if (tableMatch) {
    lines.push(`Table "${tableMatch[1].trim()}" does not exist. The active file is loaded as THIS.`);
  } else if (/syntax error/i.test(msg)) {
    lines.push(`Query failed: ${msg}. Check the SQL near the highlighted term.`);
  } else lines.push(`Query failed: ${msg}`);
  if (sql) lines.push('', 'SQL:', sql);
  return lines.join('\n');
}
