/** VS Code refuses to synchronise files above 50 MB with extensions
    ("Files above 50MB cannot be synchronized with extensions"). Any load path that
    touches TextDocument.getText() or workspace.openTextDocument() for such a file
    fails with that error. File-backed sources are therefore read directly from
    disk; the editor document is only used when its in-memory contents matter
    (untitled buffers, and unsaved changes to files under the sync limit). */
export const VSCODE_SYNC_LIMIT_BYTES = 50 * 1024 * 1024;
export type ReadMode = 'document' | 'disk';
export function decideReadMode(opts: { hasFileUri: boolean; isUntitled: boolean; isDirty: boolean; fileSizeBytes?: number }): ReadMode {
  if (opts.isUntitled || !opts.hasFileUri) return 'document';
  if (opts.isDirty && (opts.fileSizeBytes === undefined || opts.fileSizeBytes < VSCODE_SYNC_LIMIT_BYTES)) return 'document';
  return 'disk';
}
/** True when unsaved changes exist but cannot be used because the file is over the sync limit. */
export function dirtyOverSyncLimit(opts: { isDirty: boolean; fileSizeBytes?: number }): boolean {
  return opts.isDirty && opts.fileSizeBytes !== undefined && opts.fileSizeBytes >= VSCODE_SYNC_LIMIT_BYTES;
}
