// Migration 002 — normalization + multi-user ownership.
//
// This is the keystone migration. It:
//   • promotes the per-day `rows` JSON blob into a real `day_entries` child table
//     (one typed row per entry), preserving every field;
//   • gives `days` a surrogate `id` and a `user_id` owner, renames `name` →
//     `employee_name`, and makes (user_id, date) unique;
//   • adds a `user_id` owner to `subscriptions` and `backlog`;
//   • converts `subscriptions.cost` from TEXT to REAL and renames its camelCase
//     columns to snake_case (billing_cycle / end_date / renewal_date);
//   • splits the generic `meta` K/V store into `app_settings` (shared app config)
//     and `machine_prefs` (this-machine-only window state);
//   • adds indexes for the user-scoped lookups the app does at runtime.
//
// Ownership of pre-existing data: migrations run before login. If legacy data
// exists but no account does yet, an INACTIVE placeholder user ('__unclaimed__',
// is_active = 0, un-loginable) is created to own it; first-run setup CLAIMS that
// placeholder, turning it into the real first account (see auth.setup()). On a
// fresh install there is no legacy data, so no placeholder is created.
//
// Runs as one manual transaction with foreign_keys temporarily OFF (required for
// the table-rebuild + rename procedure), then verifies integrity with
// foreign_key_check before committing.
module.exports = {
  version: 2,
  name: 'normalize',
  manualTransaction: true,
  up(db) {
    const now = new Date().toISOString();
    const parse = (t, f) => { try { return JSON.parse(t); } catch { return f; } };

    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      // ── Resolve the owner for any pre-existing data ──────────────────────────
      const userCount   = db.prepare('SELECT COUNT(*) n FROM users').get().n;
      const legacyCount = ['days', 'subscriptions', 'backlog']
        .reduce((acc, t) => acc + db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0);

      let ownerId = null;
      if (legacyCount > 0) {
        ownerId = userCount > 0
          ? db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get().id
          : Number(db.prepare(
              "INSERT INTO users(username, password_hash, created_at, is_active) VALUES('__unclaimed__', '!', ?, 0)"
            ).run(now).lastInsertRowid);
      }

      // ── New schema ───────────────────────────────────────────────────────────
      db.exec(`
        CREATE TABLE days_new (
          id            INTEGER PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id),
          date          TEXT NOT NULL,
          employee_name TEXT NOT NULL DEFAULT '',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL,
          UNIQUE(user_id, date)
        );

        CREATE TABLE day_entries (
          id            INTEGER PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id),
          day_id        INTEGER NOT NULL REFERENCES days_new(id) ON DELETE CASCADE,
          company       TEXT NOT NULL DEFAULT '',
          project       TEXT NOT NULL DEFAULT '',
          activity_type TEXT NOT NULL DEFAULT '',
          time_type     TEXT NOT NULL DEFAULT '',
          description   TEXT NOT NULL DEFAULT '',
          source        TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'In Progress',
          minutes       INTEGER,
          tags          TEXT NOT NULL DEFAULT '[]',
          sort_order    INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        CREATE TABLE subscriptions_new (
          id            TEXT PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id),
          name          TEXT NOT NULL DEFAULT '',
          cost          REAL NOT NULL DEFAULT 0,
          currency      TEXT NOT NULL DEFAULT 'USD',
          billing_cycle TEXT NOT NULL DEFAULT 'Monthly',
          end_date      TEXT,
          renewal_date  TEXT,
          sort_order    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE backlog_new (
          id            TEXT PRIMARY KEY,
          user_id       INTEGER NOT NULL REFERENCES users(id),
          company       TEXT NOT NULL DEFAULT '',
          project       TEXT NOT NULL DEFAULT '',
          activity_type TEXT NOT NULL DEFAULT '',
          time_type     TEXT NOT NULL DEFAULT '',
          description   TEXT NOT NULL DEFAULT '',
          source        TEXT NOT NULL DEFAULT '',
          tags          TEXT NOT NULL DEFAULT '[]',
          sort_order    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE app_settings  ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
        CREATE TABLE machine_prefs ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
      `);

      // ── Copy days + explode rows JSON into day_entries ───────────────────────
      const insDay = db.prepare(
        'INSERT INTO days_new(user_id, date, employee_name, created_at, updated_at) VALUES(?,?,?,?,?)'
      );
      const insEntry = db.prepare(`
        INSERT INTO day_entries
          (user_id, day_id, company, project, activity_type, time_type,
           description, source, status, minutes, tags, sort_order, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

      for (const d of db.prepare('SELECT date, name, rows FROM days ORDER BY date ASC').all()) {
        const dayId = Number(insDay.run(ownerId, d.date, d.name || '', now, now).lastInsertRowid);
        parse(d.rows, []).forEach((r, i) => {
          const mins = (r.minutes === undefined || r.minutes === null || r.minutes === '')
            ? null : Number(r.minutes);
          insEntry.run(
            ownerId, dayId,
            r.company ?? '', r.project ?? '', r.natural ?? '', r.time ?? '',
            r.description ?? '', r.source ?? '',
            r.status === 'Done' ? 'Done' : 'In Progress',
            Number.isFinite(mins) ? mins : null,
            JSON.stringify(Array.isArray(r.tags) ? r.tags : []),
            i, now, now
          );
        });
      }

      // ── Copy subscriptions (cost TEXT → REAL) ────────────────────────────────
      const insSub = db.prepare(`
        INSERT INTO subscriptions_new
          (id, user_id, name, cost, currency, billing_cycle, end_date, renewal_date, sort_order)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      db.prepare('SELECT id, name, cost, currency, billingCycle, endDate, renewalDate, sort_order FROM subscriptions ORDER BY sort_order')
        .all().forEach((s, i) => {
          const cost = parseFloat(String(s.cost ?? '').replace(/[^0-9.]/g, '')) || 0;
          insSub.run(
            s.id, ownerId, s.name || '', cost, s.currency || 'USD',
            s.billingCycle || 'Monthly', s.endDate || null, s.renewalDate || null,
            s.sort_order ?? i
          );
        });

      // ── Copy backlog ─────────────────────────────────────────────────────────
      const insBl = db.prepare(`
        INSERT INTO backlog_new
          (id, user_id, company, project, activity_type, time_type, description, source, tags, sort_order)
        VALUES(?,?,?,?,?,?,?,?,?,?)`);
      db.prepare('SELECT id, company, project, natural, time, description, source, tags, sort_order FROM backlog ORDER BY sort_order')
        .all().forEach((b, i) => insBl.run(
          b.id, ownerId, b.company || '', b.project || '', b.natural || '', b.time || '',
          b.description || '', b.source || '', b.tags || '[]', b.sort_order ?? i
        ));

      // ── Split meta → app_settings (shared) / machine_prefs (this machine) ────
      const insApp     = db.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES(?,?)');
      const insMachine = db.prepare('INSERT OR REPLACE INTO machine_prefs(key, value) VALUES(?,?)');
      for (const m of db.prepare('SELECT key, value FROM meta').all()) {
        if (m.key === 'window_prefs') insMachine.run('window_prefs', m.value ?? '');
        else if (m.key === 'lookups' || m.key === 'subscriptions_default_currency') insApp.run(m.key, m.value ?? '');
        // internal one-time flags (e.g. notyet_backlog_migrated) are intentionally dropped
      }

      // ── Swap old tables out ──────────────────────────────────────────────────
      db.exec(`
        DROP TABLE days;
        DROP TABLE subscriptions;
        DROP TABLE backlog;
        DROP TABLE meta;
        ALTER TABLE days_new          RENAME TO days;
        ALTER TABLE subscriptions_new RENAME TO subscriptions;
        ALTER TABLE backlog_new       RENAME TO backlog;
      `);

      // ── Indexes for user-scoped access paths ─────────────────────────────────
      db.exec(`
        CREATE INDEX idx_day_entries_user_day ON day_entries(user_id, day_id);
        CREATE INDEX idx_day_entries_day      ON day_entries(day_id);
        CREATE INDEX idx_days_user_date       ON days(user_id, date);
        CREATE INDEX idx_backlog_user         ON backlog(user_id, sort_order);
        CREATE INDEX idx_subscriptions_user   ON subscriptions(user_id, sort_order);
      `);

      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  },
};
