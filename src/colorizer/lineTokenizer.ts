export interface FieldRange { start: number; end: number; col: number; }

/** Split one line into field ranges by a single-character delimiter, honouring
    double quotes: a quote that opens a field keeps delimiters inside it literal
    until the closing quote, and "" inside a quoted field is an escaped quote.
    A quote anywhere else is literal text. Ranges include the surrounding quotes
    (they read as part of the field when coloured). An unterminated quote simply
    runs to the end of the line — colouring must never throw on odd input.
    Pure and dependency-free so it is unit-testable without a VS Code host. */
export function tokenizeLine(line: string, delimiter: string): FieldRange[] {
  const out: FieldRange[] = [];
  const d = delimiter && delimiter.length ? delimiter[0] : ',';
  let col = 0, start = 0, i = 0, inQuotes = false, fieldStart = true;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      i++; continue;
    }
    if (ch === '"' && fieldStart) { inQuotes = true; fieldStart = false; i++; continue; }
    if (ch === d) { out.push({ start, end: i, col }); col++; i++; start = i; fieldStart = true; continue; }
    fieldStart = false; i++;
  }
  out.push({ start, end: line.length, col });
  return out;
}
