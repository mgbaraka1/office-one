// Migration 011 — Per-project documents gain a real uploaded file.
//
// Until now a `project_documents` row tracked only a boolean availability flag
// (`is_available`) per (project, document_type). This adds metadata for an actual
// file stored on disk under the Electron userData path (Option A: files on disk,
// metadata in SQLite). The binary itself lives at
//   <userData>/projects/{projectId}/documents/{documentType}-{timestamp}.{ext}
// and is NEVER stored in the database — only its metadata is.
//
// Changes (purely additive — five nullable columns, no rewrite/rename/drop):
//   file_path     TEXT     — path RELATIVE to userData (portable across machines)
//   original_name TEXT     — the user's original filename, for display/download
//   file_size     INTEGER  — bytes
//   mime_type     TEXT     — resolved from the extension
//   uploaded_at   TEXT     — ISO timestamp of the upload
//
// `is_available` is intentionally kept (not dropped): availability is now derived
// from the presence of a file, and `is_available` is maintained in sync, but
// leaving the column in place means this migration is rollback-safe — reverting
// the code keeps reading `is_available` exactly as before, and the new columns are
// inert nullable orphans to the old code.
//
// Runs in the default migration transaction.
module.exports = {
  version: 11,
  name: 'project_document_files',
  up(db) {
    // Add each column only if it is missing, so a re-run after a rolled-back
    // partial failure (or a hand-patched DB) is a no-op rather than an error.
    const existing = new Set(
      db.prepare('PRAGMA table_info(project_documents)').all().map(c => c.name)
    );
    const NEW_COLUMNS = [
      ['file_path',     'TEXT'],
      ['original_name', 'TEXT'],
      ['file_size',     'INTEGER'],
      ['mime_type',     'TEXT'],
      ['uploaded_at',   'TEXT'],
    ];
    for (const [name, type] of NEW_COLUMNS) {
      if (!existing.has(name)) db.exec(`ALTER TABLE project_documents ADD COLUMN ${name} ${type}`);
    }

    // Integrity: every FK must still point at a real row (or be NULL).
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
