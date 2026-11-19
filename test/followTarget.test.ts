import { test } from 'node:test'; import assert from 'node:assert';
import { pickFollowTarget } from '../src/utils/followTarget';

const AP = 'file:///Users/x/Downloads/INT882f.txt';
const LEDGER = 'file:///Users/x/Downloads/SHC_Ledger.txt';

test('follow: a synced document wins (small file or untitled)', () => {
  const t = pickFollowTarget({ docUri: AP, docScheme: 'file', tabUri: AP, tabScheme: 'file', tabIsText: true, sourceUri: LEDGER });
  assert.deepEqual(t, { uriString: AP, scheme: 'file', viaDocument: true, kind: 'document' });
  const u = pickFollowTarget({ docUri: 'untitled:Untitled-1', docScheme: 'untitled', tabIsText: false, sourceUri: AP });
  assert.deepEqual(u, { uriString: 'untitled:Untitled-1', scheme: 'untitled', viaDocument: true, kind: 'document' });
});

test('follow: large file — no document, but the tab gives the URI (the 50 MB blind spot)', () => {
  const t = pickFollowTarget({ docUri: undefined, docScheme: undefined, tabUri: AP, tabScheme: 'file', tabIsText: true, sourceUri: LEDGER });
  assert.deepEqual(t, { uriString: AP, scheme: 'file', viaDocument: false, kind: 'tab' });
});

test('follow: a file shown in the Color Editor is followed like any other tab', () => {
  const t = pickFollowTarget({ docUri: undefined, docScheme: undefined, tabIsText: false, customUri: AP, sourceUri: LEDGER });
  assert.deepEqual(t, { uriString: AP, scheme: 'file', viaDocument: false, kind: 'colorEditor' });
  assert.equal(pickFollowTarget({ tabIsText: false, customUri: AP, sourceUri: AP }), undefined, 'already the source');
});

test('follow: no target for the current source, foreign custom editors, or webview tabs', () => {
  assert.equal(pickFollowTarget({ docUri: AP, docScheme: 'file', tabUri: AP, tabScheme: 'file', tabIsText: true, sourceUri: AP }), undefined);
  assert.equal(pickFollowTarget({ tabUri: AP, tabScheme: 'file', tabIsText: false, sourceUri: LEDGER }), undefined, 'a custom editor that is not ours passes no customUri');
  assert.equal(pickFollowTarget({ tabIsText: false, sourceUri: LEDGER }), undefined, 'Welcome tab has no text input');
  assert.equal(pickFollowTarget({ docUri: 'output:extension-output', docScheme: 'output', tabIsText: false, sourceUri: LEDGER }), undefined);
});
