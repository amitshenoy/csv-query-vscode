# CSV Query for VS Code

Run standard SQLite SQL against any delimited text file — recreating the Notepad++ CSV Query experience. Open file → Open CSV Query → `SELECT * FROM THIS` → view results.

## What it does
- Works on `.csv`, `.txt`, `.tsv`, `.dat`, `.clar`, extensionless files, and **untitled/unsaved** documents — no renaming, no saving first. It queries the active editor's current contents.
- Auto-detects comma / pipe / tab / semicolon / caret by sampling many records for the most consistent field count; you can override in the panel or with **CSV Query: Change Delimiter**.
- Auto-detects a header row; override with the "First row contains column names" checkbox. No header → `Column1, Column2, …`. Duplicate/blank headers become unique (`Name, Name_2, Column3`).
- **All columns are TEXT, always.** Leading zeros and business IDs are preserved exactly: `001234`, `PC007`, `20260901`. A later alphanumeric row can never fail a load. Convert explicitly in SQL: `WHERE CAST(Amount AS REAL) > 1000`.
- In-memory SQLite via sql.js (WebAssembly) — no native dependencies, no Python/SQLite/DuckDB/Homebrew, no server, no internet, no telemetry, no CDN. Works on macOS Apple Silicon and Windows.

## Install from the .vsix
1. In VS Code: Extensions view → `…` menu → **Install from VSIX…** → pick `csv-query-for-vscode-1.0.0.vsix`.
   Or from a terminal: `code --install-extension csv-query-for-vscode-1.0.0.vsix`
2. Reload VS Code if prompted.

## Use
1. Open any delimited file (or paste data into an untitled editor).
2. Run **CSV Query: Open Query Panel** — Command Palette, editor/Explorer right-click → *Query with CSV Query*, or shortcut **Option+Command+Q** (macOS) / **Alt+Ctrl+Q** (Windows/Linux).
3. Press **Cmd/Ctrl+Enter** to run. Default: `SELECT * FROM THIS LIMIT 1000;`

The panel shows source, delimiter, header, column/row counts and load time; a sortable (click header), filterable, paginated grid (1,000 rows/page, paging through the complete result set — no 10,000-row browsing cap); NULL distinct from empty string; double-click a cell to copy it; query history (last 50, persisted, click to restore, pinned entries survive Clear History via the Clear Query History command clearing unpinned).

## The THIS table
The active file is always table `THIS` (quoted internally, you write it plainly):
Spaces are removed from column names, so a header like `Spend Category` is queried as `SpendCategory` and `Revenue Category` as `RevenueCategory` — no quoting needed. (If two headers collide after removing spaces, the later one gets a `_2` suffix.)
```sql
SELECT * FROM THIS WHERE PayorCode = 'PC007';
SELECT Employee_ID, COUNT(*) AS DuplicateCount FROM THIS GROUP BY Employee_ID HAVING COUNT(*) > 1;
SELECT * FROM THIS WHERE Employee_ID IS NULL OR TRIM(Employee_ID) = '';
SELECT * FROM THIS WHERE CAST(Amount AS REAL) > 1000;
```

## Working with numbers
Every column is TEXT by design — that's what keeps account codes like `001234` and `PC007` intact. The trade-off: comparisons and sorting on numeric-looking columns are *text* operations until you say otherwise. As text, `'900' > '1000'` is true, so `WHERE Amount > '1000'` would wrongly include a 900 row. Filter identifiers as text, and `CAST` when you mean numbers:

```sql
-- exact ID match, leading zeros and all
SELECT * FROM THIS WHERE EntityCode = '001234';

-- a real numeric comparison
SELECT * FROM THIS WHERE CAST(Amount AS REAL) > 1000;

-- totals by category
SELECT "Spend Category", SUM(CAST(Amount AS REAL)) AS Total
FROM THIS GROUP BY "Spend Category" ORDER BY Total DESC;
```

Two gotchas worth knowing:
- `CAST` of an empty or non-numeric value is `0`, so blanks quietly count as zero in a `SUM`. If that matters, exclude them: `WHERE TRIM(Amount) <> ''`.
- Amounts exported with currency symbols or thousands separators (`$1,234.56`) also cast to `0`. Strip the decoration first: `CAST(REPLACE(REPLACE(Amount, '$', ''), ',', '') AS REAL)` gives `1234.56`.

## Multiple files / joins
Run **CSV Query: Add File as Table**, pick a file and an alias (`REF`, `CLAR`), then:
```sql
SELECT t.* FROM THIS t LEFT JOIN REF r ON t.Employee_ID = r.Employee_ID WHERE r.Employee_ID IS NULL;
```

## Export
**CSV Query: Export Query Results** (or the panel button) — a Save dialog pre-filled with `<source>_results.csv` in the source file's folder (just confirm or rename — that's where the file lands), CSV or TSV by file extension, correct quoting for embedded delimiters/quotes/newlines, headers included, leading zeros preserved, optional UTF-8 BOM via `csvQuery.exportIncludeBom`. Export re-runs your last query and streams the complete result set to the file — there is no row cap. (A `LIMIT` you write in your own SQL still applies, since it bounds the query itself.)

## Large files
Files are parsed with Papa Parse and inserted in a single transaction in batches. Files on disk are read directly from disk, so VS Code's 50 MB document-sync limit does not apply — a 50 MB+ ledger loads and queries the same way a small file does (verified on a real 1,692,797-row file). Above `csvQuery.largeFileWarningMB` (default 200 MB) you get a Continue/Cancel warning with the size. ~100 MB files are the design target; multi-GB files are out of scope for v1.

## Privacy
Local-only. No telemetry, analytics, external API calls, or CDN scripts. Imported file data is held only in memory and discarded when the panel closes; only query text is kept in history.

## Settings
`csvQuery.defaultDelimiter`, `autoDetectDelimiter`, `firstRowIsHeader` (auto/true/false), `queryHistorySize` (50), `exportIncludeBom`, `treatAllColumnsAsText`, `enableLargeFileWarning`, `largeFileWarningMB`, `defaultQuery`, `rememberLastDelimiterByFile`. `defaultResultLimit` / `maxResultLimit` are deprecated and no longer restrict anything — results are uncapped.

## Troubleshooting
- *Column "X" does not exist* — the panel lists the actual available columns; check for spaces/renamed duplicates (`Name_2`).
- *Wrong delimiter detected* — change it in the panel dropdown; the file reloads in place and your SQL is kept.
- *Numbers comparing wrong* — columns are TEXT by design; use `CAST(col AS REAL)`.

## Develop
```bash
npm install
npm run compile   # esbuild bundle + copies sql-wasm.wasm to out/
npm test          # 29 unit tests (node:test) covering acceptance tests 4–12 plus detection, webview, paging and large-file loading
npm run lint
npm run package   # produces the .vsix
```
Launch the Extension Development Host: open this folder in VS Code and press F5.

## License
Copyright (c) 2026 Amit Shenoy — **all rights reserved.** This is proprietary software: the published extension is free to install and use via the Visual Studio Marketplace, but the source code may not be copied, modified, redistributed, or used to create derivative works without the author's written permission.
