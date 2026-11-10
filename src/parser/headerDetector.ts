
/** Heuristic: first row is header if its cells are non-numeric, non-empty-ish and differ from row 2 patterns. */
export function detectHeader(rows: string[][]): boolean {
  if (rows.length < 2) return rows.length === 1 ? true : false;
  const [first, second] = rows;
  if (!first.some(c => c.trim())) return false;
  const firstNumeric = first.filter(c => c.trim() !== '' && !isNaN(Number(c))).length;
  const looksNumericHeader = firstNumeric / Math.max(1, first.filter(c=>c.trim()).length) > 0.5;
  if (looksNumericHeader) return false;
  // Headers usually have unique-ish text values and no values that look like long IDs repeated below is fine
  const hasText = first.some(c => /[A-Za-z_]/.test(c));
  return hasText;
}
