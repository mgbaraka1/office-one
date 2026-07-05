// Migration 029 — Internal Tasks (Departments).
//
// Adds the DEPARTMENT lookup category (seeded HR / Cybersecurity / Management /
// Finance) and a nullable tasks.department_id FK -> lookup_codes, mirroring how
// company_id/system_id already work. Departments are deliberately a plain lookup
// category (managed from Settings like Company/System), not a new table — there
// is no per-department profile/description/documents. Purely additive; no
// existing table/column touched. Runs foreign_key_check.
module.exports = {
  version: 29,
  name: 'departments',
  up(db) {
    const now = new Date().toISOString();
    const seedExists = db.prepare("SELECT 1 FROM lookup_codes WHERE category = 'DEPARTMENT' AND code = ?");
    const seedIns = db.prepare(
      `INSERT INTO lookup_codes(category, code, label, sort_order, is_active, created_at)
       VALUES('DEPARTMENT', ?, ?, ?, 1, ?)`
    );
    const SEED = [
      ['HR', 'HR', 0],
      ['CYBERSECURITY', 'Cybersecurity', 1],
      ['MANAGEMENT', 'Management', 2],
      ['FINANCE', 'Finance', 3],
    ];
    for (const [code, label, sort] of SEED) {
      if (!seedExists.get(code)) seedIns.run(code, label, sort, now);
    }

    const taskCols = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
    if (!taskCols.has('department_id')) {
      db.exec('ALTER TABLE tasks ADD COLUMN department_id INTEGER REFERENCES lookup_codes(id)');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department_id)');

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
