'use strict';

// Where Office ONE keeps its data is the user's choice, made once on first
// launch and remembered in a small JSON file that lives OUTSIDE every data
// folder (main.js puts it at %APPDATA%\office-one-location.json). This module
// is the part of that which needs no Electron: reading and writing the file,
// classifying a folder, and deciding at startup what to do. main.js owns the
// dialogs, app.setPath() and the relaunch.
//
// Lives apart from main.js so it is exercisable under plain Node — see
// test/data-location-smoke.js.
//
// The one rule everything here serves: a database is only ever created in a
// folder the user picked as empty THIS time. A saved folder that has since gone
// missing or lost its database is reported, never quietly re-seeded — that
// would look exactly like every record the user ever entered had vanished.

const fs = require('node:fs');
const path = require('node:path');

const DB_FILENAME = 'cooperation-tools.db';
// Chromium's file holding the DPAPI-wrapped key that opens every stored
// credential — see USER_DATA_KEY_ENTRY in db.js.
const KEY_FILENAME = 'Local State';

// { ok: true, location: { dataDir, createNew } }
// { ok: false, reason: 'none' }               — no file yet: first launch
// { ok: false, reason: 'corrupt', error }     — unreadable, or not our shape
function readLocation(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf-8'); }
  catch (err) {
    if (err.code === 'ENOENT') return { ok: false, reason: 'none' };
    return { ok: false, reason: 'corrupt', error: String(err.message || err) };
  }
  try {
    // A hand-edited file (Windows PowerShell 5.1, older Notepad) gains a UTF-8
    // BOM, which JSON.parse rejects — tolerate it rather than call it corrupt.
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed.dataDir !== 'string' || !path.isAbsolute(parsed.dataDir)) {
      return { ok: false, reason: 'corrupt', error: 'dataDir is missing or not an absolute path' };
    }
    return { ok: true, location: { dataDir: parsed.dataDir, createNew: parsed.createNew === true } };
  } catch (err) {
    return { ok: false, reason: 'corrupt', error: String(err.message || err) };
  }
}

// Atomic: written beside the target and renamed over it, so a crash mid-write
// leaves the previous file (or none), never a half-written one.
function writeLocation(file, { dataDir, createNew = false }) {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
    throw new Error('dataDir must be an absolute path');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const body = JSON.stringify({ dataDir, createNew: createNew === true, savedAt: new Date().toISOString() }, null, 2);
  fs.writeFileSync(tmp, body + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

// 'missing'   — no such folder (or not a folder)
// 'existing'  — holds a database; hasKey says whether `Local State` is beside it
// 'empty'     — a folder with nothing in it
// 'not-empty' — a folder with other things in it but no database
function classifyFolder(dir) {
  let stat;
  try { stat = fs.statSync(dir); } catch { return { kind: 'missing' }; }
  if (!stat.isDirectory()) return { kind: 'missing' };
  if (fs.existsSync(path.join(dir, DB_FILENAME))) {
    return { kind: 'existing', hasKey: fs.existsSync(path.join(dir, KEY_FILENAME)) };
  }
  return { kind: fs.readdirSync(dir).length === 0 ? 'empty' : 'not-empty' };
}

// Decides, before app 'ready', which folder this process will use.
//
// { mode: 'override', dataDir }          — env var; used as-is, may be empty
// { mode: 'saved', dataDir, createNew }  — the remembered folder, good to open
// { mode: 'setup', problem, savedDir }   — ask the user; problem is null on a
//                                          first launch, else 'missing' |
//                                          'no-database' | 'corrupt'
function resolveStartup({ override, locationFile }) {
  if (override) return { mode: 'override', dataDir: override };

  const read = readLocation(locationFile);
  if (!read.ok) {
    return read.reason === 'none'
      ? { mode: 'setup', problem: null, savedDir: null }
      : { mode: 'setup', problem: 'corrupt', savedDir: null, error: read.error };
  }

  const { dataDir, createNew } = read.location;
  const folder = classifyFolder(dataDir);
  if (folder.kind === 'existing') return { mode: 'saved', dataDir, createNew: false };
  if (folder.kind === 'missing') return { mode: 'setup', problem: 'missing', savedDir: dataDir };
  // A folder with no database is fine only straight after the user picked it
  // as empty. Not required to still be empty: Chromium writes its own files
  // into userData before the database opens, so a first boot that failed half
  // way leaves some behind. createNew is cleared once a boot succeeds.
  if (createNew) return { mode: 'saved', dataDir, createNew: true };
  return { mode: 'setup', problem: 'no-database', savedDir: dataDir };
}

module.exports = { DB_FILENAME, KEY_FILENAME, readLocation, writeLocation, classifyFolder, resolveStartup };
