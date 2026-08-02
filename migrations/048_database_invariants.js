// Migration 048 — enforce critical relationship invariants in SQLite.
//
// The application layer already validates all of these rules. Triggers provide
// defense in depth against a future write path accidentally bypassing those
// checks. They are additive, preserve every row/id/FK, and abort only invalid
// INSERT/UPDATE statements.

const RULES = [
  ['tasks', 'status_id', 'ENTRY_STATUS'],
  ['tasks', 'company_id', 'COMPANY'],
  ['tasks', 'system_id', 'SYSTEM'],
  ['tasks', 'department_id', 'DEPARTMENT'],
  ['work_logs', 'time_type_id', 'TIME_TYPE'],
  ['work_logs', 'activity_type_id', 'ACTIVITY_TYPE'],
  ['subscriptions', 'currency_id', 'CURRENCY'],
  ['subscriptions', 'billing_cycle_id', 'BILLING_CYCLE'],
  ['client_vpn_connections', 'company_id', 'COMPANY'],
  ['client_servers', 'company_id', 'COMPANY'],
  ['client_servers', 'system_id', 'SYSTEM'],
  ['client_servers', 'role_id', 'SERVER_ROLE'],
  ['client_internal_systems', 'company_id', 'COMPANY'],
  ['project_companies', 'company_id', 'COMPANY'],
  ['project_systems', 'system_id', 'SYSTEM'],
];

function safeName(value) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe invariant identifier: ${value}`);
  return value;
}

module.exports = {
  version: 48,
  name: 'database_invariants',
  destructive: false,
  up(db) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_tasks_link_exclusive_insert
      BEFORE INSERT ON tasks
      WHEN (NEW.project_id IS NOT NULL) + (NEW.department_id IS NOT NULL) + (NEW.support_year_id IS NOT NULL) > 1
      BEGIN
        SELECT RAISE(ABORT, 'task may belong to only one project, department, or support year');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_tasks_link_exclusive_update
      BEFORE UPDATE OF project_id, department_id, support_year_id ON tasks
      WHEN (NEW.project_id IS NOT NULL) + (NEW.department_id IS NOT NULL) + (NEW.support_year_id IS NOT NULL) > 1
      BEGIN
        SELECT RAISE(ABORT, 'task may belong to only one project, department, or support year');
      END;
    `);

    for (const [rawTable, rawColumn, category] of RULES) {
      const table = safeName(rawTable);
      const column = safeName(rawColumn);
      for (const operation of ['INSERT', 'UPDATE']) {
        const suffix = operation.toLowerCase();
        const updateOf = operation === 'UPDATE' ? ` OF ${column}` : '';
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_${table}_${column}_${suffix}_category
          BEFORE ${operation}${updateOf} ON ${table}
          WHEN NEW.${column} IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM lookup_codes
              WHERE id = NEW.${column} AND category = '${category}'
           )
          BEGIN
            SELECT RAISE(ABORT, '${table}.${column} has the wrong lookup category');
          END;
        `);
      }
    }

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};
