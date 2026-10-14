// Migration 074 — Offers & CRs carry the whole delivery flow, and project
// documents move into it.
//
//   1. PFM_STATUS grows four delivery statuses after Accepted:
//        Prepare → Ready → Sent → Accepted (= quote approval)
//          → UAT Approved → Production Approved → Invoiced → Invoice Paid
//      Rejected is the other way out of Sent and sorts last. Accepted stops
//      being final; Invoice Paid and Rejected are. The Accepted label is only
//      renamed while it still reads the seeded default.
//   2. pfm_items.project_id — an optional link to one project (ON DELETE SET
//      NULL), so a project page can list its Offers and CRs.
//   3. pfm_stage_files — files on a stage (the approval, the UAT sign-off, the
//      invoice…), keyed by (item, status) rather than by the pfm_stages row,
//      since an empty stage row is removed. Bytes live under
//      <userData>/project_finance/{itemId}/stages/{statusId}/.
//   4. Every project with documents gets one Offer linked to it: the
//      Quotation becomes version V1, each approval / invoice becomes its
//      stage's file, and the status is the furthest stage reached. The bytes
//      are COPIED; the originals under projects/{id}/documents/ stay on disk
//      as the recovery point. Only the moved project_documents rows are
//      deleted, which is why this migration is destructive (the runner takes
//      a full snapshot first). Step 4 needs the data folder, so it is skipped
//      when up() is called without one (tests calling up(db) directly).
//
// Additive for the schema: one ADD COLUMN, one new table, new triggers and
// indexes; no table is rebuilt, so every existing trigger and index stays.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DELIVERY = [
  ['UAT_APPROVED',        'UAT Approved',        'اعتماد UAT'],
  ['PRODUCTION_APPROVED', 'Production Approved', 'اعتماد الإنتاج'],
  ['INVOICED',            'Invoiced',            'إصدار الفاتورة'],
  ['PAID',                'Invoice Paid',        'سداد الفاتورة'],
];
const ORDER = ['PREPARE', 'READY', 'SENT', 'ACCEPTED', 'UAT_APPROVED', 'PRODUCTION_APPROVED', 'INVOICED', 'PAID', 'REJECTED'];
// Project document type → the stage it becomes. QUOTATION is the version.
const DOC_STAGE = {
  QUOTATION_APPROVAL: 'ACCEPTED',
  PRODUCTION_APPROVED: 'PRODUCTION_APPROVED',
  INVOICE: 'INVOICED',
  INVOICE_PAYMENT: 'PAID',
};

module.exports = {
  version: 74,
  name: 'pfm_delivery_flow',
  destructive: true,
  up(db, ctx = {}) {
    const now = new Date().toISOString();
    const statusId = code => db.prepare(
      "SELECT id FROM lookup_codes WHERE category = 'PFM_STATUS' AND code = ?"
    ).get(code)?.id ?? null;

    // ── 1. Statuses ──────────────────────────────────────────────────────
    // Only a catalog that has the seeded flow is extended; one curated into
    // something else is left alone.
    if (statusId('ACCEPTED') != null && statusId('REJECTED') != null) {
      const insert = db.prepare(
        `INSERT INTO lookup_codes(category, code, label, name_en, name_ar, sort_order, is_active, created_at)
         VALUES('PFM_STATUS', ?, ?, ?, ?, 0, 1, ?)`
      );
      DELIVERY.forEach(([code, en, ar]) => { if (statusId(code) == null) insert.run(code, en, en, ar, now); });
      const setOrder = db.prepare("UPDATE lookup_codes SET sort_order = ? WHERE category = 'PFM_STATUS' AND code = ?");
      ORDER.forEach((code, i) => setOrder.run(i, code));
      // Any status added in Settings keeps its relative order, after the flow.
      db.prepare(
        `SELECT id FROM lookup_codes WHERE category = 'PFM_STATUS' AND code NOT IN (${ORDER.map(() => '?').join(',')})
          ORDER BY sort_order, id`
      ).all(...ORDER).forEach((r, i) => db.prepare('UPDATE lookup_codes SET sort_order = ? WHERE id = ?').run(ORDER.length + i, r.id));
      db.prepare(
        `UPDATE lookup_codes SET label = CASE WHEN label = 'Accepted' THEN 'Accepted (Quote Approval)' ELSE label END,
                name_en = CASE WHEN name_en = 'Accepted' THEN 'Accepted (Quote Approval)' ELSE name_en END,
                name_ar = CASE WHEN name_ar = 'مقبول' THEN 'مقبول (اعتماد العرض)' ELSE name_ar END
          WHERE category = 'PFM_STATUS' AND code = 'ACCEPTED'`
      ).run();
    }

    // ── 2. Project link ──────────────────────────────────────────────────
    const hasProject = db.prepare('PRAGMA table_info(pfm_items)').all().some(c => c.name === 'project_id');
    if (!hasProject) {
      db.exec('ALTER TABLE pfm_items ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_pfm_items_project ON pfm_items(project_id)');

    // ── 3. Stage files ───────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS pfm_stage_files (
        id            INTEGER PRIMARY KEY,
        item_id       INTEGER NOT NULL REFERENCES pfm_items(id) ON DELETE CASCADE,
        status_id     INTEGER NOT NULL REFERENCES lookup_codes(id),
        file_path     TEXT    NOT NULL,
        original_name TEXT    NOT NULL DEFAULT '',
        file_size     INTEGER NOT NULL DEFAULT 0,
        mime_type     TEXT    NOT NULL DEFAULT '',
        sort_order    INTEGER NOT NULL DEFAULT 0,
        uploaded_by   INTEGER REFERENCES users(id),
        uploaded_at   TEXT    NOT NULL,
        deleted_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pfm_stage_files_item ON pfm_stage_files(item_id, status_id);
    `);
    for (const operation of ['INSERT', 'UPDATE']) {
      const suffix = operation.toLowerCase();
      const updateOf = operation === 'UPDATE' ? ' OF status_id' : '';
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_pfm_stage_files_status_id_${suffix}_category
        BEFORE ${operation}${updateOf} ON pfm_stage_files
        WHEN NEW.status_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM lookup_codes WHERE id = NEW.status_id AND category = 'PFM_STATUS')
        BEGIN
          SELECT RAISE(ABORT, 'pfm_stage_files.status_id has the wrong lookup category');
        END;
      `);
    }

    // ── 4. Move project documents ────────────────────────────────────────
    if (ctx.userDataDir) moveProjectDocuments(db, ctx.userDataDir, statusId, now);

    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('foreign_key_check failed: ' + JSON.stringify(violations));
  },
};

function moveProjectDocuments(db, root, statusId, now) {
  const docs = db.prepare(
    `SELECT pd.*, p.user_id, p.name AS project_name FROM project_documents pd
       JOIN projects p ON p.id = pd.project_id
      WHERE pd.is_available = 1 OR pd.file_path IS NOT NULL
      ORDER BY pd.project_id, pd.id`
  ).all();
  const byProject = new Map();
  docs.forEach(d => {
    if (d.document_type !== 'QUOTATION' && !DOC_STAGE[d.document_type]) return; // a custom type stays put
    if (!byProject.has(d.project_id)) byProject.set(d.project_id, []);
    byProject.get(d.project_id).push(d);
  });
  if (!byProject.size) return;

  const order = new Map(db.prepare("SELECT id, sort_order FROM lookup_codes WHERE category = 'PFM_STATUS'").all()
    .map(r => [r.id, r.sort_order]));
  const companyOf = db.prepare(
    `SELECT MIN(pc.company_id) AS id FROM project_companies pc
       JOIN lookup_codes l ON l.id = pc.company_id AND l.category = 'COMPANY'
      WHERE pc.project_id = ?`
  );
  const refTaken = db.prepare('SELECT 1 FROM pfm_items WHERE user_id = ? AND reference_key = ?');
  const insItem = db.prepare(
    `INSERT INTO pfm_items(user_id, kind, reference, reference_key, title, company_id, status_id, project_id,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, 'OFFER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insStage = db.prepare(
    `INSERT INTO pfm_stages(item_id, status_id, member_name, done_on, note, updated_at) VALUES (?, ?, '', ?, '', ?)
     ON CONFLICT(item_id, status_id) DO UPDATE SET done_on = excluded.done_on`
  );
  const insVersion = db.prepare(
    `INSERT INTO pfm_versions(item_id, version_label, version_key, version_date, sort_order, created_by, created_at, updated_at)
     VALUES (?, 'V1', 'v1', ?, 0, ?, ?, ?)`
  );
  const insVersionFile = db.prepare(
    `INSERT INTO pfm_version_files(version_id, file_path, original_name, file_size, mime_type, sort_order, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const insStageFile = db.prepare(
    `INSERT INTO pfm_stage_files(item_id, status_id, file_path, original_name, file_size, mime_type, sort_order, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const history = db.prepare(
    `INSERT INTO pfm_history(item_id, record_type, record_id, field, old_value, new_value, user_id, changed_at)
     VALUES (?, ?, ?, ?, '', ?, ?, ?)`
  );
  const dropDoc = db.prepare('DELETE FROM project_documents WHERE id = ?');
  const projectsRoot = path.resolve(root, 'projects');
  const dateOf = d => String(d.uploaded_at || now).slice(0, 10);

  // Copies one stored project file into `relDir`; returns its new relative
  // path, or null when the original is missing or sits outside projects/.
  const copy = (d, relDir) => {
    if (!d.file_path) return null;
    const src = path.resolve(root, d.file_path);
    if (!src.startsWith(projectsRoot + path.sep) || !fs.existsSync(src)) return null;
    const ext = path.extname(src).slice(1).toLowerCase();
    const rel = path.join(relDir, `${Date.now()}-${crypto.randomInt(1e9)}.${ext}`);
    fs.mkdirSync(path.join(root, relDir), { recursive: true });
    fs.copyFileSync(src, path.join(root, rel));
    return rel;
  };

  for (const [projectId, list] of byProject) {
    const companyId = companyOf.get(projectId)?.id;
    if (companyId == null) continue; // no client to file it under: leave the documents on the project
    const { user_id: userId, project_name: title } = list[0];

    let reference = `PRJ-${projectId}`;
    for (let n = 2; refTaken.get(userId, reference.toLowerCase()); n++) reference = `PRJ-${projectId}-${n}`;

    const quote = list.find(d => d.document_type === 'QUOTATION');
    const stages = list.filter(d => DOC_STAGE[d.document_type])
      .map(d => ({ doc: d, statusId: statusId(DOC_STAGE[d.document_type]) }))
      .filter(s => s.statusId != null);
    const reached = [...(quote ? [{ statusId: statusId('SENT') }] : []), ...stages]
      .filter(s => s.statusId != null)
      .sort((a, b) => (order.get(b.statusId) ?? 0) - (order.get(a.statusId) ?? 0))[0];
    const status = reached?.statusId ?? statusId('PREPARE');
    if (status == null) continue;

    const itemId = Number(insItem.run(userId, reference, reference.toLowerCase(), title, companyId, status, projectId,
      userId, userId, now, now).lastInsertRowid);
    history.run(itemId, 'item', itemId, 'Created', `OFFER ${reference}`, userId, now);
    history.run(itemId, 'item', itemId, 'Moved from project documents', title, userId, now);

    if (quote) {
      insStage.run(itemId, statusId('SENT'), dateOf(quote), now);
      const versionId = Number(insVersion.run(itemId, dateOf(quote), userId, now, now).lastInsertRowid);
      const rel = copy(quote, path.join('project_finance', String(itemId), String(versionId)));
      if (rel) {
        const fileId = Number(insVersionFile.run(versionId, rel, quote.original_name || path.basename(rel),
          quote.file_size || 0, quote.mime_type || '', userId, quote.uploaded_at || now).lastInsertRowid);
        history.run(itemId, 'file', fileId, 'File Added', `V1: ${quote.original_name || ''}`, userId, now);
      }
      dropDoc.run(quote.id);
    }
    for (const s of stages) {
      insStage.run(itemId, s.statusId, dateOf(s.doc), now);
      const rel = copy(s.doc, path.join('project_finance', String(itemId), 'stages', String(s.statusId)));
      if (rel) {
        const fileId = Number(insStageFile.run(itemId, s.statusId, rel, s.doc.original_name || path.basename(rel),
          s.doc.file_size || 0, s.doc.mime_type || '', userId, s.doc.uploaded_at || now).lastInsertRowid);
        history.run(itemId, 'file', fileId, 'File Added', `${DOC_STAGE[s.doc.document_type]}: ${s.doc.original_name || ''}`, userId, now);
      }
      dropDoc.run(s.doc.id);
    }
  }
}
