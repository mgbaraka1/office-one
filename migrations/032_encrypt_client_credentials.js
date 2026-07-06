// Migration 032 — Encrypt client credentials at rest (Milestone 2).
//
// The password/secret_key columns across the five client_* tables
// (client_vpn_connections, client_servers, client_databases,
// client_external_services, client_internal_systems) have always been stored
// in plain text (see CLAUDE.md's repeated admission of this). This migration
// does NOT touch the schema at all (the columns are already TEXT — ciphertext
// fits fine as base64) — it takes a forced pre-migration backup, then runs
// the first encrypt pass via db.js's `encryptAllPendingCredentials()` (which
// delegates to whatever cipher main.js configured at boot —
// electron.safeStorage, wired up before applyMigrations() runs).
//
// IMPORTANT — why the actual encrypt pass also runs on every boot, not just
// here: migrations are applied at most ONCE per DB, ever (see
// applyMigrations() in db.js). If this migration happened to run on a boot
// where safeStorage wasn't available yet (e.g. a locked-down environment, or
// simply before main.js finished wiring up the cipher), a one-shot migration
// alone would never get a second chance to retroactively encrypt anything —
// it's already marked applied in schema_migrations. So the actual per-row
// encrypt logic lives in db.js's encryptAllPendingCredentials(), called both
// here (once, right after the backup) AND from runMaintenance() on every
// subsequent boot — cheap and fully idempotent (a value already carrying the
// `enc:v1:` marker is left untouched), so it safely "catches up" whenever the
// cipher becomes available, however many boots later that turns out to be.
//
// Forced pre-migration backup: before any row is touched, the live DB file
// (+ -wal/-shm) is copied into <userData>/pre-encryption-backup/ — deliberately
// OUTSIDE <userData>/backups/, since that folder's "keep newest 5" rotation
// prunes by filename text rather than real mtime (see CLAUDE.md) and a backup
// this important should never be at risk of that. This backup folder is never
// auto-pruned by anything in this app. Only taken if a cipher is configured
// this run (no point backing up before a pass that won't do anything yet).
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  version: 32,
  name: 'encrypt_client_credentials',
  up() {
    // Sibling module (NOT the raw sqlite handle `up()` would otherwise
    // receive) — for dbPath()/isCredentialEncryptionAvailable()/
    // encryptAllPendingCredentials(). Safe despite the circular require: by
    // the time migrations run, db.js has finished its own top-level init.
    const dbModule = require('../db');

    if (!dbModule.isCredentialEncryptionAvailable()) return; // nothing to do yet; runMaintenance() catches up later

    const dbFile = dbModule.dbPath();
    const backupDir = path.join(path.dirname(dbFile), 'pre-encryption-backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const suffix of ['', '-wal', '-shm']) {
      const src = dbFile + suffix;
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupDir, 'cooperation-tools-PRE-032-ENCRYPT-' + stamp + '.db' + suffix));
      }
    }

    dbModule.encryptAllPendingCredentials();
  },
};
