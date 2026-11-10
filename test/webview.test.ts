import { test } from 'node:test'; import assert from 'node:assert'; import * as fs from 'fs'; import * as path from 'path'; import * as vm from 'vm';

/** Executes the exact webview script shipped in the .vsix (media/main.js) in a stub DOM.
    Guards the regression Amit hit: panel renders but buttons do nothing and no ready
    message is ever posted. If the script throws on load, or Run/Clear stop working, this fails. */
test('shipped webview script loads, posts ready, Run posts the SQL, Clear empties the editor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'media', 'main.js'), 'utf8');
  const posted: any[] = []; const els = new Map<string, any>();
  const makeEl = (id: string) => {
    if (!els.has(id)) els.set(id, { id, value: id === 'sql' ? 'SELECT * FROM THIS;' : '', checked: true, textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, handlers: {} as Record<string, Function>, addEventListener(t: string, f: Function) { this.handlers[t] = f; }, querySelectorAll: () => [] });
    return els.get(id);
  };
  const windowHandlers: Record<string, Function> = {}; const docHandlers: Record<string, Function> = {};
  const sandbox: any = { console, navigator: {}, acquireVsCodeApi: () => ({ postMessage: (m: any) => posted.push(m) }),
    document: { getElementById: makeEl, addEventListener: (t: string, f: Function) => { docHandlers[t] = f; } },
    window: { addEventListener: (t: string, f: Function) => { windowHandlers[t] = f; } } };
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  assert.ok(posted.some(m => m.type === 'ready'), 'script must post ready on load');
  assert.equal(makeEl('scriptStatus').style.display, 'none', 'script must hide the not-run banner');
  assert.equal(typeof makeEl('run').handlers.click, 'function'); makeEl('run').handlers.click();
  assert.ok(posted.some(m => m.type === 'run' && m.sql === 'SELECT * FROM THIS;'), 'Run click must post the SQL');
  makeEl('clearSql').handlers.click(); assert.equal(makeEl('sql').value, '', 'Clear click must empty the SQL editor');
  // A source message must update the source bar, delimiter and header controls
  windowHandlers['message']({ data: { type: 'source', text: 'Source: x.txt · Rows: 1', delimiter: '|', hasHeader: true, tables: '' } });
  assert.match(makeEl('source').textContent, /x\.txt/); assert.equal(makeEl('delim').value, '|');
});
