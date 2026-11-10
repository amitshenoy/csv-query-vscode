
import Papa from 'papaparse';
export const CANDIDATES: { label: string; value: string }[] = [
  { label: 'Comma', value: ',' }, { label: 'Pipe', value: '|' }, { label: 'Tab', value: '\t' },
  { label: 'Semicolon', value: ';' }, { label: 'Caret', value: '^' }];
export interface Detection { delimiter: string; confidence: number; fieldCount: number; }
/** Sample many records; prefer delimiter with most consistent field count >1. */
export function detectDelimiter(text: string): Detection {
  const sample = text.replace(/^\uFEFF/, '').slice(0, 200000);
  let best: Detection = { delimiter: ',', confidence: 0, fieldCount: 1 };
  for (const c of CANDIDATES) {
    const res = Papa.parse<string[]>(sample, { delimiter: c.value, skipEmptyLines: 'greedy' });
    const rows = (res.data as string[][]).filter(r => r.length && !(r.length === 1 && r[0] === '')).slice(0, 50);
    if (rows.length < 1) continue;
    const counts = rows.map(r => r.length);
    const mode = counts.sort((a,b)=>counts.filter(v=>v===b).length-counts.filter(v=>v===a).length)[0];
    if (mode <= 1) continue;
    const consistency = counts.filter(v => v === mode).length / counts.length;
    const score = consistency * Math.log(mode + 1);
    if (score > best.confidence) best = { delimiter: c.value, confidence: score, fieldCount: mode };
  }
  return best;
}
export function delimiterLabel(d: string): string {
  if (d === '\t') return 'Tab'; if (d === ',') return 'Comma ,'; if (d === '|') return 'Pipe |';
  if (d === ';') return 'Semicolon ;'; if (d === '^') return 'Caret ^'; return `Custom "${d}"`;
}
