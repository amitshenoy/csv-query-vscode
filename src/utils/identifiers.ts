
export function quoteIdent(name: string): string { return '"' + name.replace(/"/g, '""') + '"'; }
export function sanitizeTableName(raw: string): string {
  let s = (raw || 'TABLE').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!s) s = 'TABLE'; if (/^[0-9]/.test(s)) s = '_' + s; return s.toUpperCase();
}
/** Make unique, SQLite-safe column names while preserving display labels.
 *  Whitespace is stripped from the queryable name ("Spend Category" -> "SpendCategory",
 *  "Revenue Category" -> "RevenueCategory") so headers can be typed in SQL without
 *  quoting; the original header text is kept in `label`. Uniqueness is enforced on
 *  the stripped name, so "Spend Category" and "SpendCategory" in one file become
 *  SpendCategory and SpendCategory_2. */
export function makeUniqueColumns(labels: string[]): { name: string; label: string }[] {
  const seen = new Map<string, number>(); const used = new Set<string>();
  return labels.map((raw, i) => {
    const label = raw ?? '';
    let base = label.trim().replace(/"/g, '""').replace(/\s+/g, '');
    if (!base) base = `Column${i + 1}`;
    let name = base; const key = base.toLowerCase();
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    if (n > 1 || used.has(name.toLowerCase())) name = `${base}_${n}`;
    while (used.has(name.toLowerCase())) name = name + '_';
    used.add(name.toLowerCase());
    return { name, label: label || name };
  });
}
