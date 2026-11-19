import * as fs from 'fs';

/** A byte-offset index of a file's lines: offsets[i] is the byte where line i
    (0-based) starts. Built by streaming the file once and recording every '\n'.
    A trailing newline produces a final offset equal to the file size — the empty
    last line the editor itself shows. Memory is 8 bytes per line (Float64Array),
    so a 3.7M-line export costs ~30 MB and any line range can then be read from
    disk on demand without ever holding the file in memory. */
export async function buildLineIndex(filePath: string): Promise<Float64Array> {
  const offsets: number[] = [0];
  let pos = 0;
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
    s.on('data', (chunk: Buffer) => {
      let i = -1;
      while ((i = chunk.indexOf(10, i + 1)) !== -1) offsets.push(pos + i + 1);
      pos += chunk.length;
    });
    s.on('end', () => resolve());
    s.on('error', reject);
  });
  return Float64Array.from(offsets);
}

/** Read `count` lines starting at 0-based line `first` using the offset index.
    Reads exactly the byte range those lines span — line-aligned, so UTF-8
    sequences are never split. Trailing '\r' is stripped (CRLF files). */
export async function readLineRange(filePath: string, offsets: Float64Array, first: number, count: number): Promise<string[]> {
  const total = offsets.length;
  if (first >= total || count <= 0) return [];
  const last = Math.min(total - 1, first + count - 1);
  const start = offsets[first];
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const size = (await fh.stat()).size;
    const stop = last + 1 < total ? offsets[last + 1] : size;
    const len = Math.max(0, stop - start);
    if (!len) return [''];
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const lines = buf.toString('utf8').split('\n');
    // When the range ends exactly at the next line's start, the text ends with
    // '\n' and split leaves a phantom empty entry for the following line.
    if (last + 1 < total && lines.length) lines.pop();
    return lines.map(l => l.replace(/\r$/, ''));
  } finally { await fh.close(); }
}
