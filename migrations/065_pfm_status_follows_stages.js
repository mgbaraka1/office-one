// Migration 065 — repair Offers / CRs whose status lags behind their stages.
//
// Before this release, giving a later stage a date from the stage editor
// recorded it but left the status where it was (e.g. "Ready" dated, status
// still "Prepare"). savePfmStage now moves the status forward; this brings
// existing rows in line: each item's status becomes its furthest dated stage
// in PFM_STATUS order, when that is later than the current one. Never moves a
// status back. Each move is written to pfm_history like a normal change.
//
// A plain UPDATE of pfm_items.status_id — no rebuild, so its indexes and the
// workspace_search triggers (063) stay as they are.
module.exports = {
  version: 65,
  name: 'pfm_status_follows_stages',
  destructive: false,
  up(db) {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pfm_stages'"
    ).get();
    if (!table) return;

    const lagging = db.prepare(`
      SELECT i.id, i.user_id, i.status_id AS old_id, cur.label AS old_label,
             s.status_id AS new_id, nxt.label AS new_label
        FROM pfm_items i
        JOIN lookup_codes cur ON cur.id = i.status_id
        JOIN pfm_stages s     ON s.item_id = i.id AND s.done_on IS NOT NULL
        JOIN lookup_codes nxt ON nxt.id = s.status_id
       WHERE nxt.sort_order > cur.sort_order
         AND NOT EXISTS (
           SELECT 1 FROM pfm_stages s2 JOIN lookup_codes l2 ON l2.id = s2.status_id
            WHERE s2.item_id = i.id AND s2.done_on IS NOT NULL
              AND (l2.sort_order > nxt.sort_order OR (l2.sort_order = nxt.sort_order AND l2.id > nxt.id)))
    `).all();
    if (!lagging.length) return;

    const now = new Date().toISOString();
    const move = db.prepare('UPDATE pfm_items SET status_id = ? WHERE id = ?');
    const log = db.prepare(
      `INSERT INTO pfm_history(item_id, record_type, record_id, field, old_value, new_value, user_id, changed_at)
       VALUES (?, 'item', ?, 'Status', ?, ?, ?, ?)`
    );
    for (const r of lagging) {
      move.run(r.new_id, r.id);
      log.run(r.id, r.id, r.old_label || '', r.new_label || '', r.user_id, now);
    }
  },
};
