/** Decide which editor the query panel should follow, if any. Pure and unit-tested;
    the panel feeds it whatever VS Code currently exposes and loads the result.

    The subtleties are VS Code's document rules. Above the ~50 MB sync limit the
    extension host gets NO document for a file even though its tab is right
    there — but the Tabs API still reports the tab and its URI. And a file
    flipped into the CSV Query Color Editor is shown by a custom editor: no
    text editor, no TabInputText — yet it is still "the file being looked at",
    so switching to its tab must load it just the same (this was missed at
    first: once Color Columns worked on big files, follow appeared to stop
    entirely, because every tab Amit switched to was a Color Editor tab).
    So: a synced document wins when it exists (it carries unsaved changes and
    untitled buffers); our own Color Editor tab is next; a plain text tab is
    the fallback for unsynced files. Foreign custom editors and webview tabs
    (Welcome) are never follow targets. */
export interface FollowCandidate { uriString: string; scheme: string; viaDocument: boolean; kind: 'document' | 'tab' | 'colorEditor' }
export function pickFollowTarget(input: {
  docUri?: string; docScheme?: string;
  tabUri?: string; tabScheme?: string; tabIsText: boolean;
  customUri?: string;
  sourceUri?: string;
}): FollowCandidate | undefined {
  const { docUri, docScheme, tabUri, tabScheme, tabIsText, customUri, sourceUri } = input;
  if (docUri && (docScheme === 'file' || docScheme === 'untitled')) {
    return docUri === sourceUri ? undefined : { uriString: docUri, scheme: docScheme, viaDocument: true, kind: 'document' };
  }
  if (customUri) {
    return customUri === sourceUri ? undefined : { uriString: customUri, scheme: 'file', viaDocument: false, kind: 'colorEditor' };
  }
  if (tabIsText && tabUri && tabScheme === 'file') {
    return tabUri === sourceUri ? undefined : { uriString: tabUri, scheme: 'file', viaDocument: false, kind: 'tab' };
  }
  return undefined;
}
