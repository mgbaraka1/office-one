// ─────────────────────────────────────────────────────────────────────────────
// Finance — standalone financial record-keeping data layer for Finance IT
// (clients, contracts with versions, change requests, invoices with payment
// tracking, minutes of meeting). Deliberately isolated from the rest of the
// app: its own tables (all `finance_` prefixed), its own catalog (`finance_lookups`
// — nothing to do with the shared `lookup_codes` table or db.js's
// `LOOKUP_CATEGORIES` gate), its own client roster (never the shared
// `COMPANY` lookup). See AGENTS.md's Finance section for the full rationale.
//
// Shares db.js's single SQLite connection (via db.getConnection()) so every
// Finance write lands in the same file, transaction, backup, and integrity
// check as the rest of the app's data — but owns 100% of its own SQL. This
// file is requireable under plain Node with no Electron, exactly like db.js.
//
// Every mutating function returns { ok, ...} rather than throwing (never a
// partial write on refusal) — the same convention the rest of the app uses
// for its own invariant-checked writes (e.g. projects:link-task).
// ─────────────────────────────────────────────────────────────────────────────

const appDb = require('./db');
const path = require('node:path');
const fs = require('node:fs');

function conn() { return appDb.getConnection(); }
function nowIso() { return new Date().toISOString(); }

// Reentrant is unnecessary here — Finance writes are never called from inside
// one of db.js's own tx() blocks (a separate migration/IPC call stack always
// owns the outermost transaction), so a plain BEGIN/COMMIT is safe.
function tx(fn) {
  const c = conn();
  c.exec('BEGIN');
  try { const result = fn(); c.exec('COMMIT'); return result; }
  catch (err) { c.exec('ROLLBACK'); throw err; }
}

// A create/update that violates a UNIQUE index (version label, installment
// sequence, etc.) is turned into a readable refusal instead of a raw SQLite
// error bubbling to the renderer.
function withUniqueGuard(fn, friendlyMsg) {
  try { return fn(); }
  catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) return { ok: false, error: friendlyMsg };
    throw err;
  }
}

// Same idea for finance_invoice_links' ON DELETE RESTRICT (installment_id/cr_id):
// a delete that reaches this point should already have been refused by the
// caller's own invariant-6 check (financeInstallmentInvoicedMinor/financeCrInvoicedMinor
// > 0), but this is the backstop for any case that check doesn't cover — e.g.
// a stale link left over from data written before that check existed — so the
// raw SQLite error still can't reach the renderer as an uncaught exception.
function withRestrictGuard(fn, friendlyMsg) {
  try { return fn(); }
  catch (err) {
    if (String(err?.message || '').includes('FOREIGN KEY constraint failed')) return { ok: false, error: friendlyMsg };
    throw err;
  }
}

// ── Finance's own catalog (finance_lookups) ────────────────────────────────────
// Five categories, each user_id-scoped — every account manages its own FINANCE
// IT setup independently, unlike the shared, global lookup_codes table.
// Codes are the immutable identity; label_en/label_ar are freely editable
// from the Setup tab (saveFinanceLookups). Seeded per-user by
// seedLookupsIfMissing(), called both by migration 054 (for every user that
// exists when it runs) and lazily here (for a user created afterwards).
const FINANCE_LOOKUP_SEED = {
  CONTRACT_STATUS: [
    ['DRAFT', 'Draft', 'مسودة'],
    ['ACTIVE', 'Active', 'نشط'],
    ['EXPIRED', 'Expired', 'منتهي'],
    ['TERMINATED', 'Terminated', 'مُنهى'],
  ],
  CR_STATUS: [
    ['DRAFT', 'Draft', 'مسودة'],
    ['SUBMITTED', 'Submitted', 'مُقدَّم'],
    ['APPROVED', 'Approved', 'مُعتمد'],
    ['REJECTED', 'Rejected', 'مرفوض'],
    ['DELIVERED', 'Delivered', 'تم التسليم'],
  ],
  INVOICE_STATUS: [
    ['DRAFT', 'Draft', 'مسودة'],
    ['ISSUED', 'Issued', 'صادرة'],
    ['PARTIALLY_PAID', 'Partially Paid', 'مدفوعة جزئياً'],
    ['PAID', 'Paid', 'مدفوعة'],
    ['CANCELLED', 'Cancelled', 'ملغاة'],
  ],
  CURRENCY: [
    ['SAR', 'Saudi Riyal', 'ريال سعودي'],
    ['USD', 'US Dollar', 'دولار أمريكي'],
    ['EUR', 'Euro', 'يورو'],
  ],
  PAYMENT_METHOD: [
    ['BANK_TRANSFER', 'Bank Transfer', 'تحويل بنكي'],
    ['CHEQUE', 'Cheque', 'شيك'],
    ['CASH', 'Cash', 'نقداً'],
  ],
};
const FINANCE_LOOKUP_CATEGORIES = Object.keys(FINANCE_LOOKUP_SEED);

// `c` is an explicit connection param (not the module's own conn()) so the
// migration can call this directly with the raw DatabaseSync it was handed,
// before db.js's own getConnection() would necessarily reflect the same open
// connection during a fresh-install boot sequence.
function seedLookupsIfMissing(c, userId) {
  const has = c.prepare('SELECT 1 FROM finance_lookups WHERE user_id = ? LIMIT 1').get(userId);
  if (has) return;
  const now = nowIso();
  const ins = c.prepare(
    `INSERT INTO finance_lookups(user_id, category, code, label_en, label_ar, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const [category, items] of Object.entries(FINANCE_LOOKUP_SEED)) {
    items.forEach(([code, labelEn, labelAr], i) => ins.run(userId, category, code, labelEn, labelAr, i, now, now));
  }
}

function finFmtMinor(m) { return ((Number(m) || 0) / 100).toFixed(2); }

function finSlugCode(s) {
  const normalized = String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return normalized.replace(/^_/, '').replace(/_$/, '') || 'NA';
}
function finUniqueCode(userId, category, base) {
  const exists = conn().prepare('SELECT 1 FROM finance_lookups WHERE user_id = ? AND category = ? AND code = ?');
  let code = base, i = 2;
  while (exists.get(userId, category, code)) code = base + '_' + (i++);
  return code;
}

// value may be a code (case-insensitive); '' / null / unknown -> null (unset).
// Deliberately does not filter by is_active — a soft-disabled code must
// remain resolvable so historical rows keep pointing at it correctly.
function finLkId(userId, category, code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  const row = conn().prepare('SELECT id FROM finance_lookups WHERE user_id = ? AND category = ? AND code = ?').get(userId, category, c);
  return row ? row.id : null;
}
function finLkFields(statusId) {
  if (statusId == null) return { status: '', statusLabelEn: '', statusLabelAr: '' };
  const r = conn().prepare('SELECT code, label_en, label_ar FROM finance_lookups WHERE id = ?').get(statusId);
  return r ? { status: r.code, statusLabelEn: r.label_en, statusLabelAr: r.label_ar } : { status: '', statusLabelEn: '', statusLabelAr: '' };
}
// Currency is stored as a plain code, not an FK id. Accepted from EITHER the
// app-wide CURRENCY catalog (which the dropdown now offers — plan §8) or
// Finance's own legacy CURRENCY list, so that:
//   - re-sourcing the dropdown needed no migration and no data change, and
//   - every code already stored by the old, Finance-only list stays valid.
// Validating against only one of the two would silently blank the currency on
// the next save of a record picked from the other. An unknown or blank code
// still resolves to '' (unset) rather than storing junk.
function resolveFinanceCurrency(userId, code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return '';
  const shared = conn().prepare(
    "SELECT 1 FROM lookup_codes WHERE category = 'CURRENCY' AND code = ? COLLATE NOCASE"
  ).get(c);
  if (shared) return c;
  const own = conn().prepare('SELECT 1 FROM finance_lookups WHERE user_id = ? AND category = ? AND code = ?').get(userId, 'CURRENCY', c);
  return own ? c : '';
}

function listFinanceLookups(userId) {
  seedLookupsIfMissing(conn(), userId);
  const rows = conn().prepare('SELECT * FROM finance_lookups WHERE user_id = ? ORDER BY category, sort_order, id').all(userId);
  const categories = {};
  for (const cat of FINANCE_LOOKUP_CATEGORIES) categories[cat] = [];
  for (const r of rows) {
    if (!categories[r.category]) categories[r.category] = [];
    categories[r.category].push({
      id: r.id, code: r.code, labelEn: r.label_en, labelAr: r.label_ar,
      sortOrder: r.sort_order, isActive: !!r.is_active,
    });
  }
  return { categories };
}

// Bulk save from the Setup tab: existing rows are relabeled/reordered/soft-
// disabled in place (code and category are never rewritten); rows with no id
// are new values, given a fresh, unique, slugified code. Mirrors db.js's
// saveLookups() shape and conventions.
function saveFinanceLookups(userId, data) {
  const skipped = [];
  if (!data?.categories) return { ok: true, skipped };
  tx(() => {
    const c = conn();
    const now = nowIso();
    const upd = c.prepare('UPDATE finance_lookups SET label_en = ?, label_ar = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ? AND user_id = ?');
    const ins = c.prepare('INSERT INTO finance_lookups(user_id, category, code, label_en, label_ar, sort_order, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const [cat, list] of Object.entries(data.categories)) {
      if (!FINANCE_LOOKUP_CATEGORIES.includes(cat) || !Array.isArray(list)) continue;
      list.forEach((item, i) => {
        const labelEn = String(item?.labelEn ?? '').trim();
        const labelAr = String(item?.labelAr ?? '').trim();
        if (!labelEn) { skipped.push({ category: cat, reason: 'blank-label', index: i }); return; }
        const itemId = (item?.id != null && Number.isFinite(Number(item.id))) ? Number(item.id) : null;
        const sort = Number.isInteger(item?.sortOrder) ? item.sortOrder : i;
        const active = item?.isActive === false ? 0 : 1;
        if (itemId != null) {
          const owned = c.prepare('SELECT 1 FROM finance_lookups WHERE id = ? AND user_id = ? AND category = ?').get(itemId, userId, cat);
          if (!owned) { skipped.push({ category: cat, reason: 'not-found', index: i }); return; }
          upd.run(labelEn, labelAr, sort, active, now, itemId, userId);
        } else {
          const code = finUniqueCode(userId, cat, finSlugCode(labelEn));
          ins.run(userId, cat, code, labelEn, labelAr, sort, active, now, now);
        }
      });
    }
  });
  return { ok: true, skipped };
}

// ── Clients ──────────────────────────────────────────────────────────────────
function ownsFinanceClient(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_clients WHERE id = ? AND user_id = ?').get(id, userId);
}

// contract_count / outstanding_minor are computed inline so the list-card grid
// gets both without a second round trip.
const FINANCE_CLIENT_SELECT = `
  c.*,
  co.code    AS company_code,
  co.name_en AS company_name_en,
  co.name_ar AS company_name_ar,
  (SELECT COUNT(*) FROM finance_contracts k WHERE k.client_id = c.id) AS contract_count,
  COALESCE((
    SELECT SUM(i.amount_minor + i.tax_minor - COALESCE(pay.paid, 0))
    FROM finance_invoices i
    LEFT JOIN (SELECT invoice_id, SUM(amount_minor) AS paid FROM finance_invoice_payments GROUP BY invoice_id) pay
      ON pay.invoice_id = i.id
    LEFT JOIN finance_lookups st ON st.id = i.status_id
    WHERE i.client_id = c.id AND (st.code IS NULL OR st.code != 'CANCELLED')
  ), 0) AS outstanding_minor
`;

// Identity comes from the linked COMPANY row (migration 056) — a Finance client
// IS a company now, and its name is edited in Settings -> Companies like every
// other client's. The local name/code columns survive as the pre-merge audit
// trail and as the fallback for a row that is somehow still unlinked, so a
// half-migrated database still renders something meaningful instead of blanks.
function financeClientToApi(r) {
  const linked = r.company_id != null && r.company_name_en != null;
  return {
    id: r.id,
    companyId: r.company_id ?? null,
    name: linked ? r.company_name_en : r.name,
    nameAr: (linked ? r.company_name_ar : r.name_ar) || '',
    code: (linked ? r.company_code : r.code) || '',
    contactName: r.contact_name || '', contactEmail: r.contact_email || '', contactPhone: r.contact_phone || '',
    address: r.address || '', taxNumber: r.tax_number || '', notes: r.notes || '',
    isActive: !!r.is_active, sortOrder: r.sort_order, createdAt: r.created_at, updatedAt: r.updated_at,
    contractCount: r.contract_count || 0, outstandingMinor: r.outstanding_minor || 0,
  };
}

function listFinanceClients(userId) {
  return conn().prepare(`SELECT ${FINANCE_CLIENT_SELECT} FROM finance_clients c LEFT JOIN lookup_codes co ON co.id = c.company_id AND co.category = 'COMPANY'
     WHERE c.user_id = ? ORDER BY c.sort_order, c.id`)
    .all(userId).map(financeClientToApi);
}
function getFinanceClient(userId, id) {
  const r = conn().prepare(`SELECT ${FINANCE_CLIENT_SELECT} FROM finance_clients c LEFT JOIN lookup_codes co ON co.id = c.company_id AND co.category = 'COMPANY'
     WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
  return r ? financeClientToApi(r) : null;
}
// A Finance client is now a *finance profile of a company* (migration 056), so
// creating one means picking a company from the shared roster rather than
// typing a name Finance alone would know about. `companyId` is required and
// must be a real, live COMPANY lookup the caller can see — a private lookup
// (migration 041) must not become visible through Finance.
//
// The local name/code columns are still written for a new row: they are the
// pre-merge audit trail's forward continuation and the fallback that keeps a
// row readable if its company is ever soft-disabled out from under it.
function companyForFinance(userId, companyId) {
  const id = Number(companyId);
  if (!Number.isInteger(id)) return null;
  const row = conn().prepare(
    "SELECT id, code, name_en, name_ar, is_active FROM lookup_codes WHERE id = ? AND category = 'COMPANY'"
  ).get(id);
  if (!row || !row.is_active) return null;
  return appDb.canAccessLookup(userId, id) ? row : null;
}

function createFinanceClient(userId, data) {
  const company = companyForFinance(userId, data?.companyId);
  if (!company) return { ok: false, error: 'Pick a client from the company list' };
  const existing = conn().prepare('SELECT id FROM finance_clients WHERE user_id = ? AND company_id = ?')
    .get(userId, company.id);
  if (existing) return { ok: false, error: 'That client is already in Finance' };

  const now = nowIso();
  const maxSort = conn().prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM finance_clients WHERE user_id = ?').get(userId).m;
  const id = Number(conn().prepare(
    `INSERT INTO finance_clients(user_id, company_id, name, name_ar, code, contact_name, contact_email, contact_phone, address, tax_number, notes, is_active, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`
  ).run(userId, company.id, company.name_en || '', company.name_ar || '', company.code || '',
        String(data?.contactName ?? '').trim(),
        String(data?.contactEmail ?? '').trim(), String(data?.contactPhone ?? '').trim(), String(data?.address ?? '').trim(),
        String(data?.taxNumber ?? '').trim(), String(data?.notes ?? '').trim(), maxSort + 1, now, now).lastInsertRowid);
  return { ok: true, client: getFinanceClient(userId, id) };
}

// Only the finance-owned fields are editable here. Name, Arabic name and code
// belong to the company and are edited in Settings -> Companies, so that a
// rename lands everywhere at once instead of Finance drifting from the roster.
function updateFinanceClient(userId, id, data) {
  if (!ownsFinanceClient(userId, id)) return { ok: false, error: 'Client not found' };
  conn().prepare(
    `UPDATE finance_clients SET contact_name = ?, contact_email = ?, contact_phone = ?,
       address = ?, tax_number = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(String(data?.contactName ?? '').trim(),
        String(data?.contactEmail ?? '').trim(), String(data?.contactPhone ?? '').trim(), String(data?.address ?? '').trim(),
        String(data?.taxNumber ?? '').trim(), String(data?.notes ?? '').trim(), nowIso(), id, userId);
  return { ok: true, client: getFinanceClient(userId, id) };
}

// Companies not yet in Finance — what the "add a client" picker offers. Excludes
// soft-disabled rows and anything this account cannot access.
function listFinanceCandidateCompanies(userId) {
  const taken = new Set(
    conn().prepare('SELECT company_id FROM finance_clients WHERE user_id = ? AND company_id IS NOT NULL')
      .all(userId).map(r => r.company_id)
  );
  return conn().prepare(
    `SELECT id, code, name_en, name_ar FROM lookup_codes
      WHERE category = 'COMPANY' AND is_active = 1 ORDER BY sort_order, id`
  ).all()
    .filter(r => !taken.has(r.id) && appDb.canAccessLookup(userId, r.id))
    .map(r => ({ id: r.id, code: r.code || '', name: r.name_en || '', nameAr: r.name_ar || '' }));
}
// Refuses while the client still owns any contract, change request, invoice,
// or meeting, rather than a cascading delete-with-undo across all of them —
// a much smaller, clearly reversible action for the common case (an empty/
// duplicate client). Change requests, invoices, and meetings all hang off
// client_id directly (not only through a contract — contract_id/cr_id are
// nullable on them) and all carry ON DELETE CASCADE, so checking only
// contractCount would let a client with e.g. a standalone invoice be
// silently cascade-deleted with no refusal and no undo path.
function deleteFinanceClient(userId, id) {
  if (!ownsFinanceClient(userId, id)) return { ok: false, error: 'Client not found' };
  const contractCount = conn().prepare('SELECT COUNT(*) AS n FROM finance_contracts WHERE client_id = ?').get(id).n;
  if (contractCount > 0) return { ok: false, error: 'Delete this client’s contracts first' };
  const crCount = conn().prepare('SELECT COUNT(*) AS n FROM finance_change_requests WHERE client_id = ?').get(id).n;
  if (crCount > 0) return { ok: false, error: 'Delete this client’s change requests first' };
  const invoiceCount = conn().prepare('SELECT COUNT(*) AS n FROM finance_invoices WHERE client_id = ?').get(id).n;
  if (invoiceCount > 0) return { ok: false, error: 'Delete this client’s invoices first' };
  const meetingCount = conn().prepare('SELECT COUNT(*) AS n FROM finance_meetings WHERE client_id = ?').get(id).n;
  if (meetingCount > 0) return { ok: false, error: 'Delete this client’s meetings first' };
  const snapshot = getFinanceClient(userId, id);
  purgeFinanceAttachmentsForEntities('client', [id]);
  conn().prepare('DELETE FROM finance_clients WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot };
}

// ── Contracts ────────────────────────────────────────────────────────────────
function ownsFinanceContract(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_contracts WHERE id = ? AND user_id = ?').get(id, userId);
}
function ownsFinanceVersion(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_contract_versions WHERE id = ? AND user_id = ?').get(id, userId);
}
function ownsFinanceInstallment(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_contract_installments WHERE id = ? AND user_id = ?').get(id, userId);
}

function listFinanceVersionsRaw(contractId) {
  return conn().prepare('SELECT * FROM finance_contract_versions WHERE contract_id = ? ORDER BY created_at, id').all(contractId);
}
function listFinanceInstallmentsRaw(contractId) {
  return conn().prepare('SELECT * FROM finance_contract_installments WHERE contract_id = ? ORDER BY seq, id').all(contractId);
}
// Excludes allocations on a CANCELLED invoice — mirrors FINANCE_CLIENT_SELECT's
// outstanding_minor exclusion below, so cancelling an invoice frees up the
// installment it had allocated (both for the "invoiced" status pill and for
// deleteFinanceInstallment's invariant-6 refusal check) rather than leaving it
// permanently stuck against a claim that will never be paid.
function financeInstallmentInvoicedMinor(installmentId) {
  const r = conn().prepare(
    `SELECT COALESCE(SUM(l.allocated_minor),0) AS n FROM finance_invoice_links l
       JOIN finance_invoices i ON i.id = l.invoice_id
       LEFT JOIN finance_lookups st ON st.id = i.status_id
      WHERE l.installment_id = ? AND (st.code IS NULL OR st.code != 'CANCELLED')`
  ).get(installmentId);
  return r ? r.n : 0;
}

function financeVersionToApi(r) {
  return {
    id: r.id, contractId: r.contract_id, versionLabel: r.version_label, valueMinor: r.value_minor,
    signedDate: r.signed_date || '', effectiveDate: r.effective_date || '', isFinal: !!r.is_final,
    notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function financeInstallmentToApi(r) {
  const invoiced = financeInstallmentInvoicedMinor(r.id);
  return {
    id: r.id, contractId: r.contract_id, seq: r.seq, title: r.title || '', milestone: r.milestone || '',
    dueDate: r.due_date || '', amountMinor: r.amount_minor, notes: r.notes || '',
    invoicedMinor: invoiced, outstandingMinor: Math.max(0, r.amount_minor - invoiced),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function financeContractToApi(r, includeChildren) {
  const api = {
    id: r.id, clientId: r.client_id, ref: r.ref || '', title: r.title, description: r.description || '',
    ...finLkFields(r.status_id),
    currencyCode: r.currency_code || '', startDate: r.start_date || '', endDate: r.end_date || '',
    notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (includeChildren) {
    api.versions = listFinanceVersionsRaw(r.id).map(financeVersionToApi);
    api.installments = listFinanceInstallmentsRaw(r.id).map(financeInstallmentToApi);
  }
  return api;
}

function listFinanceContracts(userId, clientId) {
  if (!ownsFinanceClient(userId, clientId)) return [];
  return conn().prepare('SELECT * FROM finance_contracts WHERE client_id = ? AND user_id = ? ORDER BY created_at, id')
    .all(clientId, userId).map(r => financeContractToApi(r, true));
}
function getFinanceContract(userId, id) {
  const r = conn().prepare('SELECT * FROM finance_contracts WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? financeContractToApi(r, true) : null;
}
function createFinanceContract(userId, clientId, data) {
  if (!ownsFinanceClient(userId, clientId)) return { ok: false, error: 'Client not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Contract title is required' };
  const now = nowIso();
  const id = Number(conn().prepare(
    `INSERT INTO finance_contracts(user_id, client_id, ref, title, description, status_id, currency_code, start_date, end_date, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(userId, clientId, String(data?.ref ?? '').trim(), title, String(data?.description ?? '').trim(),
        finLkId(userId, 'CONTRACT_STATUS', data?.status), resolveFinanceCurrency(userId, data?.currencyCode),
        data?.startDate || null, data?.endDate || null, String(data?.notes ?? '').trim(), now, now).lastInsertRowid);
  return { ok: true, contract: getFinanceContract(userId, id) };
}
function updateFinanceContract(userId, id, data) {
  if (!ownsFinanceContract(userId, id)) return { ok: false, error: 'Contract not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Contract title is required' };
  conn().prepare(
    `UPDATE finance_contracts SET ref = ?, title = ?, description = ?, status_id = ?, currency_code = ?,
       start_date = ?, end_date = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(String(data?.ref ?? '').trim(), title, String(data?.description ?? '').trim(),
        finLkId(userId, 'CONTRACT_STATUS', data?.status), resolveFinanceCurrency(userId, data?.currencyCode),
        data?.startDate || null, data?.endDate || null, String(data?.notes ?? '').trim(), nowIso(), id, userId);
  return { ok: true, contract: getFinanceContract(userId, id) };
}
// Cascades its versions/installments. Since Phase 2 added invoices,
// finance_invoice_links.installment_id is ON DELETE RESTRICT — cascading into an
// already-invoiced installment would otherwise throw a raw SQLite "FOREIGN
// KEY constraint failed" instead of the friendly refusal
// deleteFinanceInstallment gives for the same case, so that check is repeated
// here first. The snapshot returned carries the full nested
// versions[]/installments[] so the renderer can recreate them all on undo via
// the ordinary create-* calls — the same client-orchestrated undo convention
// company-documents.js already uses.
function deleteFinanceContract(userId, id) {
  if (!ownsFinanceContract(userId, id)) return { ok: false, error: 'Contract not found' };
  const installmentIds = listFinanceInstallmentsRaw(id).map(i => i.id);
  if (installmentIds.some(instId => financeInstallmentInvoicedMinor(instId) > 0)) {
    return { ok: false, error: 'This contract has an installment that has already been invoiced — delete that invoice allocation first' };
  }
  const snapshot = getFinanceContract(userId, id);
  const versionIds = listFinanceVersionsRaw(id).map(v => v.id);
  return withRestrictGuard(() => {
    purgeFinanceAttachmentsForEntities('contract_version', versionIds);
    conn().prepare('DELETE FROM finance_contracts WHERE id = ? AND user_id = ?').run(id, userId);
    return { ok: true, snapshot };
  }, 'This contract has an installment that has already been invoiced — delete that invoice allocation first');
}

// ── Contract Versions ────────────────────────────────────────────────────────
// Invariant 1 (exactly one final version per contract) is enforced by
// migration 054's partial UNIQUE index; these two functions keep writes to it
// ordered (clear the old final, then set the new one) so that index is never
// violated mid-transaction.
function createFinanceContractVersion(userId, contractId, data) {
  if (!ownsFinanceContract(userId, contractId)) return { ok: false, error: 'Contract not found' };
  const versionLabel = String(data?.versionLabel ?? '').trim();
  if (!versionLabel) return { ok: false, error: 'Version label is required' };
  const valueMinor = Math.max(0, Math.round(Number(data?.valueMinor) || 0));
  const now = nowIso();
  return withUniqueGuard(() => {
    tx(() => {
      if (data?.isFinal) {
        conn().prepare('UPDATE finance_contract_versions SET is_final = 0, updated_at = ? WHERE contract_id = ? AND is_final = 1')
          .run(now, contractId);
      }
      conn().prepare(
        `INSERT INTO finance_contract_versions(user_id, contract_id, version_label, value_minor, signed_date, effective_date, is_final, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(userId, contractId, versionLabel, valueMinor, data?.signedDate || null, data?.effectiveDate || null,
            data?.isFinal ? 1 : 0, String(data?.notes ?? '').trim(), now, now);
    });
    return { ok: true, contract: getFinanceContract(userId, contractId) };
  }, `Version ${versionLabel} already exists on this contract`);
}
// isFinal is deliberately not editable here — use setFinalFinanceContractVersion,
// a dedicated action, so a routine field edit can never accidentally clear or
// move the final flag.
function updateFinanceContractVersion(userId, id, data) {
  if (!ownsFinanceVersion(userId, id)) return { ok: false, error: 'Version not found' };
  const versionLabel = String(data?.versionLabel ?? '').trim();
  if (!versionLabel) return { ok: false, error: 'Version label is required' };
  const valueMinor = Math.max(0, Math.round(Number(data?.valueMinor) || 0));
  const row = conn().prepare('SELECT contract_id FROM finance_contract_versions WHERE id = ?').get(id);
  return withUniqueGuard(() => {
    conn().prepare(
      `UPDATE finance_contract_versions SET version_label = ?, value_minor = ?, signed_date = ?, effective_date = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(versionLabel, valueMinor, data?.signedDate || null, data?.effectiveDate || null, String(data?.notes ?? '').trim(), nowIso(), id, userId);
    return { ok: true, contract: getFinanceContract(userId, row.contract_id) };
  }, `Version ${versionLabel} already exists on this contract`);
}
function deleteFinanceContractVersion(userId, id) {
  if (!ownsFinanceVersion(userId, id)) return { ok: false, error: 'Version not found' };
  const row = conn().prepare('SELECT * FROM finance_contract_versions WHERE id = ?').get(id);
  purgeFinanceAttachmentsForEntities('contract_version', [id]);
  conn().prepare('DELETE FROM finance_contract_versions WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot: financeVersionToApi(row), contract: getFinanceContract(userId, row.contract_id) };
}
function setFinalFinanceContractVersion(userId, id) {
  if (!ownsFinanceVersion(userId, id)) return { ok: false, error: 'Version not found' };
  const row = conn().prepare('SELECT contract_id FROM finance_contract_versions WHERE id = ?').get(id);
  tx(() => {
    conn().prepare('UPDATE finance_contract_versions SET is_final = 0, updated_at = ? WHERE contract_id = ? AND is_final = 1 AND id != ?')
      .run(nowIso(), row.contract_id, id);
    conn().prepare('UPDATE finance_contract_versions SET is_final = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
  });
  return { ok: true, contract: getFinanceContract(userId, row.contract_id) };
}

// ── Contract Installments ────────────────────────────────────────────────────
function createFinanceInstallment(userId, contractId, data) {
  if (!ownsFinanceContract(userId, contractId)) return { ok: false, error: 'Contract not found' };
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  let seq = Number.isInteger(Number(data?.seq)) && Number(data.seq) > 0 ? Number(data.seq) : null;
  if (seq == null) {
    const max = conn().prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM finance_contract_installments WHERE contract_id = ?').get(contractId).m;
    seq = max + 1;
  }
  const now = nowIso();
  return withUniqueGuard(() => {
    conn().prepare(
      `INSERT INTO finance_contract_installments(user_id, contract_id, seq, title, milestone, due_date, amount_minor, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, contractId, seq, String(data?.title ?? '').trim(), String(data?.milestone ?? '').trim(),
          data?.dueDate || null, amountMinor, String(data?.notes ?? '').trim(), now, now);
    return { ok: true, contract: getFinanceContract(userId, contractId) };
  }, `Installment #${seq} already exists on this contract`);
}
function updateFinanceInstallment(userId, id, data) {
  if (!ownsFinanceInstallment(userId, id)) return { ok: false, error: 'Installment not found' };
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  const row = conn().prepare('SELECT contract_id FROM finance_contract_installments WHERE id = ?').get(id);
  const seq = Number.isInteger(Number(data?.seq)) && Number(data.seq) > 0 ? Number(data.seq) : null;
  if (seq == null) return { ok: false, error: 'A valid sequence number is required' };
  return withUniqueGuard(() => {
    conn().prepare(
      `UPDATE finance_contract_installments SET seq = ?, title = ?, milestone = ?, due_date = ?, amount_minor = ?, notes = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(seq, String(data?.title ?? '').trim(), String(data?.milestone ?? '').trim(), data?.dueDate || null,
          amountMinor, String(data?.notes ?? '').trim(), nowIso(), id, userId);
    return { ok: true, contract: getFinanceContract(userId, row.contract_id) };
  }, `Installment #${seq} already exists on this contract`);
}
// Invariant 6: refuses once this installment carries any invoice allocation.
function deleteFinanceInstallment(userId, id) {
  if (!ownsFinanceInstallment(userId, id)) return { ok: false, error: 'Installment not found' };
  if (financeInstallmentInvoicedMinor(id) > 0) return { ok: false, error: 'This installment has already been invoiced and cannot be deleted' };
  const row = conn().prepare('SELECT * FROM finance_contract_installments WHERE id = ?').get(id);
  return withRestrictGuard(() => {
    conn().prepare('DELETE FROM finance_contract_installments WHERE id = ? AND user_id = ?').run(id, userId);
    return { ok: true, snapshot: financeInstallmentToApi(row), contract: getFinanceContract(userId, row.contract_id) };
  }, 'This installment has already been invoiced and cannot be deleted');
}

// ── Change Requests ──────────────────────────────────────────────────────────
function ownsFinanceCr(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_change_requests WHERE id = ? AND user_id = ?').get(id, userId);
}
// Excludes allocations on a CANCELLED invoice — see financeInstallmentInvoicedMinor.
function financeCrInvoicedMinor(crId) {
  const r = conn().prepare(
    `SELECT COALESCE(SUM(l.allocated_minor),0) AS n FROM finance_invoice_links l
       JOIN finance_invoices i ON i.id = l.invoice_id
       LEFT JOIN finance_lookups st ON st.id = i.status_id
      WHERE l.cr_id = ? AND (st.code IS NULL OR st.code != 'CANCELLED')`
  ).get(crId);
  return r ? r.n : 0;
}
function financeCrToApi(r) {
  const invoiced = financeCrInvoicedMinor(r.id);
  return {
    id: r.id, clientId: r.client_id, contractId: r.contract_id, ref: r.ref || '', title: r.title,
    description: r.description || '', ...finLkFields(r.status_id), amountMinor: r.amount_minor,
    currencyCode: r.currency_code || '', requestedDate: r.requested_date || '', approvedDate: r.approved_date || '',
    notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
    invoicedMinor: invoiced, outstandingMinor: Math.max(0, r.amount_minor - invoiced),
  };
}
function listFinanceChangeRequests(userId, clientId) {
  if (!ownsFinanceClient(userId, clientId)) return [];
  return conn().prepare('SELECT * FROM finance_change_requests WHERE client_id = ? AND user_id = ? ORDER BY created_at, id')
    .all(clientId, userId).map(financeCrToApi);
}
function getFinanceChangeRequest(userId, id) {
  const r = conn().prepare('SELECT * FROM finance_change_requests WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? financeCrToApi(r) : null;
}
function createFinanceChangeRequest(userId, clientId, data) {
  if (!ownsFinanceClient(userId, clientId)) return { ok: false, error: 'Client not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Change request title is required' };
  let contractId = data?.contractId != null ? Number(data.contractId) : null;
  if (contractId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_contracts WHERE id = ? AND client_id = ? AND user_id = ?').get(contractId, clientId, userId);
    if (!owned) return { ok: false, error: 'Contract not found for this client' };
  }
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  const now = nowIso();
  return withUniqueGuard(() => {
    const id = Number(conn().prepare(
      `INSERT INTO finance_change_requests(user_id, client_id, contract_id, ref, title, description, status_id, amount_minor, currency_code, requested_date, approved_date, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, clientId, contractId, String(data?.ref ?? '').trim(), title, String(data?.description ?? '').trim(),
          finLkId(userId, 'CR_STATUS', data?.status), amountMinor, resolveFinanceCurrency(userId, data?.currencyCode),
          data?.requestedDate || null, data?.approvedDate || null, String(data?.notes ?? '').trim(), now, now).lastInsertRowid);
    return { ok: true, cr: getFinanceChangeRequest(userId, id) };
  }, `Reference ${String(data?.ref ?? '').trim()} is already in use`);
}
function updateFinanceChangeRequest(userId, id, data) {
  if (!ownsFinanceCr(userId, id)) return { ok: false, error: 'Change request not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Change request title is required' };
  const row = conn().prepare('SELECT client_id FROM finance_change_requests WHERE id = ?').get(id);
  let contractId = data?.contractId != null ? Number(data.contractId) : null;
  if (contractId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_contracts WHERE id = ? AND client_id = ? AND user_id = ?').get(contractId, row.client_id, userId);
    if (!owned) return { ok: false, error: 'Contract not found for this client' };
  }
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  return withUniqueGuard(() => {
    conn().prepare(
      `UPDATE finance_change_requests SET contract_id = ?, ref = ?, title = ?, description = ?, status_id = ?, amount_minor = ?,
         currency_code = ?, requested_date = ?, approved_date = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(contractId, String(data?.ref ?? '').trim(), title, String(data?.description ?? '').trim(),
          finLkId(userId, 'CR_STATUS', data?.status), amountMinor, resolveFinanceCurrency(userId, data?.currencyCode),
          data?.requestedDate || null, data?.approvedDate || null, String(data?.notes ?? '').trim(), nowIso(), id, userId);
    return { ok: true, cr: getFinanceChangeRequest(userId, id) };
  }, `Reference ${String(data?.ref ?? '').trim()} is already in use`);
}
// Invariant 6: refuses once this change request carries any invoice allocation.
function deleteFinanceChangeRequest(userId, id) {
  if (!ownsFinanceCr(userId, id)) return { ok: false, error: 'Change request not found' };
  if (financeCrInvoicedMinor(id) > 0) return { ok: false, error: 'This change request has already been invoiced and cannot be deleted' };
  const row = conn().prepare('SELECT * FROM finance_change_requests WHERE id = ?').get(id);
  return withRestrictGuard(() => {
    purgeFinanceAttachmentsForEntities('cr', [id]);
    conn().prepare('DELETE FROM finance_change_requests WHERE id = ? AND user_id = ?').run(id, userId);
    return { ok: true, snapshot: financeCrToApi(row) };
  }, 'This change request has already been invoiced and cannot be deleted');
}

// ── Invoices ─────────────────────────────────────────────────────────────────
function ownsFinanceInvoice(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_invoices WHERE id = ? AND user_id = ?').get(id, userId);
}
function financeInvoicePaidMinor(invoiceId) {
  const r = conn().prepare('SELECT COALESCE(SUM(amount_minor),0) AS n FROM finance_invoice_payments WHERE invoice_id = ?').get(invoiceId);
  return r ? r.n : 0;
}
function financeInvoiceLinkToApi(r) {
  return {
    id: r.id, invoiceId: r.invoice_id, installmentId: r.installment_id, crId: r.cr_id,
    allocatedMinor: r.allocated_minor, createdAt: r.created_at,
  };
}
function financePaymentToApi(r) {
  const m = finLkFields(r.method_id);
  return {
    id: r.id, invoiceId: r.invoice_id, paidDate: r.paid_date || '', amountMinor: r.amount_minor,
    method: m.status, methodLabelEn: m.statusLabelEn, methodLabelAr: m.statusLabelAr,
    reference: r.reference || '', notes: r.notes || '', createdAt: r.created_at,
  };
}
function financeInvoiceToApi(r, includeChildren) {
  const paid = financeInvoicePaidMinor(r.id);
  const totalMinor = r.amount_minor + r.tax_minor;
  const api = {
    id: r.id, clientId: r.client_id, number: r.number, issueDate: r.issue_date || '', dueDate: r.due_date || '',
    amountMinor: r.amount_minor, taxMinor: r.tax_minor, totalMinor,
    currencyCode: r.currency_code || '', ...finLkFields(r.status_id),
    notes: r.notes || '', createdAt: r.created_at, updatedAt: r.updated_at,
    paidMinor: paid, outstandingMinor: Math.max(0, totalMinor - paid),
  };
  if (includeChildren) {
    api.links = conn().prepare('SELECT * FROM finance_invoice_links WHERE invoice_id = ? ORDER BY id').all(r.id).map(financeInvoiceLinkToApi);
    api.payments = conn().prepare('SELECT * FROM finance_invoice_payments WHERE invoice_id = ? ORDER BY paid_date, id').all(r.id).map(financePaymentToApi);
  }
  return api;
}
function listFinanceInvoices(userId, clientId) {
  if (!ownsFinanceClient(userId, clientId)) return [];
  return conn().prepare('SELECT * FROM finance_invoices WHERE client_id = ? AND user_id = ? ORDER BY created_at, id')
    .all(clientId, userId).map(r => financeInvoiceToApi(r, true));
}
function getFinanceInvoice(userId, id) {
  const r = conn().prepare('SELECT * FROM finance_invoices WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? financeInvoiceToApi(r, true) : null;
}
function createFinanceInvoice(userId, clientId, data) {
  if (!ownsFinanceClient(userId, clientId)) return { ok: false, error: 'Client not found' };
  const number = String(data?.number ?? '').trim();
  if (!number) return { ok: false, error: 'Invoice number is required' };
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  const taxMinor = Math.max(0, Math.round(Number(data?.taxMinor) || 0));
  const now = nowIso();
  return withUniqueGuard(() => {
    const id = Number(conn().prepare(
      `INSERT INTO finance_invoices(user_id, client_id, number, issue_date, due_date, amount_minor, tax_minor, currency_code, status_id, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, clientId, number, data?.issueDate || null, data?.dueDate || null, amountMinor, taxMinor,
          resolveFinanceCurrency(userId, data?.currencyCode), finLkId(userId, 'INVOICE_STATUS', data?.status),
          String(data?.notes ?? '').trim(), now, now).lastInsertRowid);
    return { ok: true, invoice: getFinanceInvoice(userId, id) };
  }, `Invoice number ${number} already exists`);
}
function updateFinanceInvoice(userId, id, data) {
  if (!ownsFinanceInvoice(userId, id)) return { ok: false, error: 'Invoice not found' };
  const number = String(data?.number ?? '').trim();
  if (!number) return { ok: false, error: 'Invoice number is required' };
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  const taxMinor = Math.max(0, Math.round(Number(data?.taxMinor) || 0));
  const statusId = finLkId(userId, 'INVOICE_STATUS', data?.status);
  const statusCode = statusId != null ? finLkFields(statusId).status : '';
  return withUniqueGuard(() => {
    tx(() => {
      conn().prepare(
        `UPDATE finance_invoices SET number = ?, issue_date = ?, due_date = ?, amount_minor = ?, tax_minor = ?, currency_code = ?,
           status_id = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
      ).run(number, data?.issueDate || null, data?.dueDate || null, amountMinor, taxMinor,
            resolveFinanceCurrency(userId, data?.currencyCode), statusId,
            String(data?.notes ?? '').trim(), nowIso(), id, userId);
      // Cancelling releases whatever this invoice had allocated to
      // installments/CRs. finance_invoice_links carries ON DELETE RESTRICT on
      // both installment_id and cr_id, so leaving those rows in place after
      // cancelling would still block deleting the installment/CR/contract
      // with a raw SQLite FK error even though the invoice will never be
      // paid — mirrors deleteFinanceInvoice's own unconditional link cascade.
      if (statusCode === 'CANCELLED') {
        conn().prepare('DELETE FROM finance_invoice_links WHERE invoice_id = ?').run(id);
      }
    });
    return { ok: true, invoice: getFinanceInvoice(userId, id) };
  }, `Invoice number ${number} already exists`);
}
// Cascades its links and payments (both ON DELETE CASCADE at the schema
// level) — deleting an invoice frees up whatever installments/CRs it had
// allocated against, which is the intended effect (e.g. undoing a mis-issued
// invoice). The undo snapshot carries links[]/payments[] so the
// client-orchestrated restore can recreate everything exactly, the same
// convention as deleteFinanceContract's cascaded versions/installments.
function deleteFinanceInvoice(userId, id) {
  if (!ownsFinanceInvoice(userId, id)) return { ok: false, error: 'Invoice not found' };
  const snapshot = getFinanceInvoice(userId, id);
  purgeFinanceAttachmentsForEntities('invoice', [id]);
  conn().prepare('DELETE FROM finance_invoices WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot };
}

// ── Invoice Links (installment / change-request allocations) ────────────────
// Invariant 2 (link exclusivity — exactly one of installment_id/cr_id) is
// enforced by migration 054's CHECK constraint; the app-level check here
// exists only to return a friendly error instead of a raw SQLite one.
// Invariant 3 (currency agreement) and invariant 4 (no over-allocation) are
// enforced here, before the row is written.
function createFinanceInvoiceLink(userId, invoiceId, data) {
  if (!ownsFinanceInvoice(userId, invoiceId)) return { ok: false, error: 'Invoice not found' };
  const invoice = conn().prepare('SELECT * FROM finance_invoices WHERE id = ?').get(invoiceId);
  const installmentId = data?.installmentId != null ? Number(data.installmentId) : null;
  const crId = data?.crId != null ? Number(data.crId) : null;
  if ((installmentId != null) === (crId != null)) {
    return { ok: false, error: 'Link exactly one installment or change request' };
  }
  const allocatedMinor = Math.max(0, Math.round(Number(data?.allocatedMinor) || 0));
  if (allocatedMinor <= 0) return { ok: false, error: 'Allocated amount must be greater than zero' };

  let target, targetLabel, currentAllocated;
  if (installmentId != null) {
    target = conn().prepare(
      `SELECT i.*, k.client_id AS client_id, k.currency_code AS target_currency FROM finance_contract_installments i
         JOIN finance_contracts k ON k.id = i.contract_id WHERE i.id = ? AND i.user_id = ?`
    ).get(installmentId, userId);
    if (!target || target.client_id !== invoice.client_id) return { ok: false, error: 'Installment not found for this client' };
    targetLabel = 'installment';
    currentAllocated = financeInstallmentInvoicedMinor(installmentId);
  } else {
    target = conn().prepare('SELECT * FROM finance_change_requests WHERE id = ? AND user_id = ?').get(crId, userId);
    if (target) target.target_currency = target.currency_code;
    if (!target || target.client_id !== invoice.client_id) return { ok: false, error: 'Change request not found for this client' };
    targetLabel = 'change request';
    currentAllocated = financeCrInvoicedMinor(crId);
  }
  if (invoice.currency_code && target.target_currency && invoice.currency_code !== target.target_currency) {
    return { ok: false, error: `Invoice and ${targetLabel} currencies do not match` };
  }
  if (currentAllocated + allocatedMinor > target.amount_minor) {
    return { ok: false, error: `This would over-allocate the ${targetLabel} (only ${finFmtMinor(Math.max(0, target.amount_minor - currentAllocated))} remaining)` };
  }

  const now = nowIso();
  return withUniqueGuard(() => {
    conn().prepare(
      `INSERT INTO finance_invoice_links(user_id, invoice_id, installment_id, cr_id, allocated_minor, created_at)
       VALUES (?,?,?,?,?,?)`
    ).run(userId, invoiceId, installmentId, crId, allocatedMinor, now);
    return { ok: true, invoice: getFinanceInvoice(userId, invoiceId) };
  }, `This invoice is already linked to that ${targetLabel}`);
}
function deleteFinanceInvoiceLink(userId, id) {
  const row = conn().prepare(
    'SELECT l.* FROM finance_invoice_links l JOIN finance_invoices i ON i.id = l.invoice_id WHERE l.id = ? AND i.user_id = ?'
  ).get(id, userId);
  if (!row) return { ok: false, error: 'Link not found' };
  conn().prepare('DELETE FROM finance_invoice_links WHERE id = ?').run(id);
  return { ok: true, invoice: getFinanceInvoice(userId, row.invoice_id), snapshot: financeInvoiceLinkToApi(row) };
}

// ── Invoice Payments ──────────────────────────────────────────────────────────
// Invariant 5: no over-payment — a payment can never push the invoice's total
// paid past amount_minor + tax_minor.
function createFinancePayment(userId, invoiceId, data) {
  if (!ownsFinanceInvoice(userId, invoiceId)) return { ok: false, error: 'Invoice not found' };
  const invoice = conn().prepare('SELECT * FROM finance_invoices WHERE id = ?').get(invoiceId);
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  if (amountMinor <= 0) return { ok: false, error: 'Payment amount must be greater than zero' };
  const paidSoFar = financeInvoicePaidMinor(invoiceId);
  const total = invoice.amount_minor + invoice.tax_minor;
  if (paidSoFar + amountMinor > total) {
    return { ok: false, error: `This would over-pay the invoice (only ${finFmtMinor(Math.max(0, total - paidSoFar))} remaining)` };
  }
  const now = nowIso();
  conn().prepare(
    `INSERT INTO finance_invoice_payments(user_id, invoice_id, paid_date, amount_minor, method_id, reference, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(userId, invoiceId, data?.paidDate || null, amountMinor, finLkId(userId, 'PAYMENT_METHOD', data?.method),
        String(data?.reference ?? '').trim(), String(data?.notes ?? '').trim(), now);
  return { ok: true, invoice: getFinanceInvoice(userId, invoiceId) };
}
function updateFinancePayment(userId, id, data) {
  const row = conn().prepare(
    'SELECT p.* FROM finance_invoice_payments p JOIN finance_invoices i ON i.id = p.invoice_id WHERE p.id = ? AND i.user_id = ?'
  ).get(id, userId);
  if (!row) return { ok: false, error: 'Payment not found' };
  const invoice = conn().prepare('SELECT * FROM finance_invoices WHERE id = ?').get(row.invoice_id);
  const amountMinor = Math.max(0, Math.round(Number(data?.amountMinor) || 0));
  if (amountMinor <= 0) return { ok: false, error: 'Payment amount must be greater than zero' };
  const paidSoFarExcl = financeInvoicePaidMinor(row.invoice_id) - row.amount_minor;
  const total = invoice.amount_minor + invoice.tax_minor;
  if (paidSoFarExcl + amountMinor > total) {
    return { ok: false, error: `This would over-pay the invoice (only ${finFmtMinor(Math.max(0, total - paidSoFarExcl))} remaining)` };
  }
  conn().prepare(
    `UPDATE finance_invoice_payments SET paid_date = ?, amount_minor = ?, method_id = ?, reference = ?, notes = ? WHERE id = ? AND user_id = ?`
  ).run(data?.paidDate || null, amountMinor, finLkId(userId, 'PAYMENT_METHOD', data?.method),
        String(data?.reference ?? '').trim(), String(data?.notes ?? '').trim(), id, userId);
  return { ok: true, invoice: getFinanceInvoice(userId, row.invoice_id) };
}
function deleteFinancePayment(userId, id) {
  const row = conn().prepare(
    'SELECT p.* FROM finance_invoice_payments p JOIN finance_invoices i ON i.id = p.invoice_id WHERE p.id = ? AND i.user_id = ?'
  ).get(id, userId);
  if (!row) return { ok: false, error: 'Payment not found' };
  conn().prepare('DELETE FROM finance_invoice_payments WHERE id = ?').run(id);
  return { ok: true, invoice: getFinanceInvoice(userId, row.invoice_id), snapshot: financePaymentToApi(row) };
}

// ── Attachments (contract versions, CRs, invoices, meetings, clients) ───────
// Files live at <userData>/finance/{entityType}/{entityId}/{timestamp}.{ext}.
// Unlike company_documents/project_documents (one file per slot, REPLACE
// semantics), finance_attachments is ADD-only — every upload is a new row, so an
// entity can carry any number of files. Installments are deliberately not an
// attachable entity type (they have no independent lifecycle worth attaching
// evidence to; their parent contract version is the natural place for that).
//
// financeDataRoot() derives the userData folder from the open connection's own
// PRAGMA database_list rather than requiring a 5th db.js export — the file
// path SQLite reports is always <userData>/cooperation-tools.db, so its
// dirname is exactly what resolveStoredPath's root would have been.
function financeDataRoot() {
  const row = conn().prepare('PRAGMA database_list').get();
  return path.dirname(row.file);
}
function finResolveInside(root, ...parts) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...parts.map(p => String(p ?? '')));
  const rel = path.relative(base, candidate);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw new Error('Resolved path is outside the allowed data directory');
  }
  return candidate;
}
function finResolveStoredPath(relativePath) {
  if (!relativePath || path.isAbsolute(String(relativePath))) throw new Error('Invalid stored file path');
  return finResolveInside(financeDataRoot(), relativePath);
}
function finAttachmentEntityDir(entityType, entityId) {
  return path.join('finance', entityType, String(entityId));
}

const FINANCE_DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const FINANCE_DOC_EXTENSIONS = Object.keys(FINANCE_DOC_TYPES);
const FINANCE_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function finFileExt(p) { return path.extname(String(p || '')).replace(/^\./, '').toLowerCase(); }

// Duplicated (not imported) from db.js's uploadHeaderMatches — small, stable,
// and Finance's isolation mandate keeps every byte of its own logic local.
function finUploadHeaderMatches(srcPath, ext) {
  const fd = fs.openSync(srcPath, 'r');
  try {
    const b = Buffer.alloc(16);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    const h = b.subarray(0, n);
    const starts = (...bytes) => bytes.every((v, i) => h[i] === v);
    if (ext === 'pdf') return h.subarray(0, 5).toString('ascii') === '%PDF-';
    if (ext === 'doc') return starts(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1);
    if (ext === 'docx') return starts(0x50, 0x4B, 0x03, 0x04) || starts(0x50, 0x4B, 0x05, 0x06);
    if (ext === 'png') return starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
    if (ext === 'jpg' || ext === 'jpeg') return starts(0xFF, 0xD8, 0xFF);
    if (ext === 'gif') return ['GIF87a', 'GIF89a'].includes(h.subarray(0, 6).toString('ascii'));
    if (ext === 'webp') return h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP';
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

const FINANCE_ATTACHMENT_ENTITY_TABLES = {
  contract_version: 'finance_contract_versions',
  cr: 'finance_change_requests',
  invoice: 'finance_invoices',
  meeting: 'finance_meetings',
  client: 'finance_clients',
};
function ownsFinanceAttachmentEntity(userId, entityType, entityId) {
  const table = FINANCE_ATTACHMENT_ENTITY_TABLES[entityType];
  if (!table) return false;
  return !!conn().prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(entityId, userId);
}
function ownsFinanceAttachment(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_attachments WHERE id = ? AND user_id = ?').get(id, userId);
}
function financeAttachmentToApi(r) {
  return {
    id: r.id, entityType: r.entity_type, entityId: r.entity_id, filePath: r.file_path,
    originalName: r.original_name, fileSize: r.file_size, mimeType: r.mime_type, uploadedAt: r.uploaded_at,
  };
}
function listFinanceAttachments(userId, entityType, entityId) {
  if (!ownsFinanceAttachmentEntity(userId, entityType, entityId)) return [];
  return conn().prepare('SELECT * FROM finance_attachments WHERE user_id = ? AND entity_type = ? AND entity_id = ? ORDER BY created_at, id')
    .all(userId, entityType, entityId).map(financeAttachmentToApi);
}
function createFinanceAttachment(userId, entityType, entityId, srcPath) {
  if (!ownsFinanceAttachmentEntity(userId, entityType, entityId)) return { ok: false, error: 'Not found' };
  const ext = finFileExt(srcPath);
  if (!FINANCE_DOC_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `Unsupported file type (.${ext || '?'}). Allowed: ${FINANCE_DOC_EXTENSIONS.join(', ')}` };
  }
  let size;
  try { size = fs.statSync(srcPath).size; }
  catch { return { ok: false, error: 'Could not read the selected file' }; }
  if (size <= 0 || size > FINANCE_MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'File must be between 1 byte and 100 MB' };
  }
  try {
    if (!finUploadHeaderMatches(srcPath, ext)) return { ok: false, error: 'The file contents do not match its extension' };
  } catch { return { ok: false, error: 'Could not validate the selected file' }; }

  const relPath = path.join(finAttachmentEntityDir(entityType, entityId), `${Date.now()}.${ext}`);
  const absPath = finResolveStoredPath(relPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.copyFileSync(srcPath, absPath);
  } catch (err) {
    return { ok: false, error: 'Could not save the file: ' + String(err?.message || err) };
  }
  const now = nowIso();
  try {
    const id = Number(conn().prepare(
      `INSERT INTO finance_attachments(user_id, entity_type, entity_id, file_path, original_name, file_size, mime_type, uploaded_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(userId, entityType, entityId, relPath, path.basename(srcPath), size, FINANCE_DOC_TYPES[ext], now, now).lastInsertRowid);
    return { ok: true, attachment: financeAttachmentToApi(conn().prepare('SELECT * FROM finance_attachments WHERE id = ?').get(id)) };
  } catch (err) {
    try { fs.rmSync(absPath, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: 'Could not record the file: ' + String(err?.message || err) };
  }
}
function resolveFinanceAttachment(userId, id) {
  if (!ownsFinanceAttachment(userId, id)) return { ok: false, error: 'Attachment not found' };
  const row = conn().prepare('SELECT * FROM finance_attachments WHERE id = ?').get(id);
  let absPath;
  try { absPath = finResolveStoredPath(row.file_path); }
  catch { return { ok: false, error: 'Invalid stored file path' }; }
  return { ok: true, absPath, originalName: row.original_name, mimeType: row.mime_type, exists: fs.existsSync(absPath) };
}
// The file itself is left on disk for the 5s undo window — restoreFinanceAttachment
// re-inserts the row against the same file, purgeFinanceAttachmentFile removes it
// once the window lapses with no restore, mirroring company_documents' flow.
function deleteFinanceAttachment(userId, id) {
  if (!ownsFinanceAttachment(userId, id)) return { ok: false, error: 'Attachment not found' };
  const row = conn().prepare('SELECT * FROM finance_attachments WHERE id = ?').get(id);
  conn().prepare('DELETE FROM finance_attachments WHERE id = ?').run(id);
  return { ok: true, snapshot: financeAttachmentToApi(row) };
}
function restoreFinanceAttachment(userId, snapshot) {
  if (!snapshot || !ownsFinanceAttachmentEntity(userId, snapshot.entityType, snapshot.entityId)) {
    return { ok: false, error: 'Not found' };
  }
  let absPath;
  try { absPath = finResolveStoredPath(snapshot.filePath); }
  catch { return { ok: false, error: 'Invalid stored file path' }; }
  if (!fs.existsSync(absPath)) return { ok: false, error: 'The file is no longer available to restore' };
  const now = nowIso();
  const id = Number(conn().prepare(
    `INSERT INTO finance_attachments(user_id, entity_type, entity_id, file_path, original_name, file_size, mime_type, uploaded_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(userId, snapshot.entityType, snapshot.entityId, snapshot.filePath, snapshot.originalName,
        snapshot.fileSize, snapshot.mimeType, snapshot.uploadedAt, now).lastInsertRowid);
  return { ok: true, attachment: financeAttachmentToApi(conn().prepare('SELECT * FROM finance_attachments WHERE id = ?').get(id)) };
}
// Called when a delete's 5s undo window lapses with no restore. Mirrors
// db.js's purgeUnreferencedProjectDocumentFile/purgeUnreferencedCompanyDocumentFile/
// purgeKnowledgeAttachment: ownership is checked against the still-live owning
// entity (the attachment row is already gone, but its entity isn't), and the
// resolved path is confined to that entity's own attachment folder — not just
// somewhere under userData — so a wrong/forged relPath can never reach a file
// outside finance/{entityType}/{entityId}/, including the live DB file.
function purgeFinanceAttachmentFile(userId, entityType, entityId, relPath) {
  if (!ownsFinanceAttachmentEntity(userId, entityType, entityId) || !relPath) return;
  const stillReferenced = conn().prepare(
    'SELECT 1 FROM finance_attachments WHERE entity_type = ? AND entity_id = ? AND file_path = ?'
  ).get(entityType, entityId, relPath);
  if (stillReferenced) return;
  try {
    const absPath = finResolveStoredPath(relPath);
    finResolveInside(path.join(financeDataRoot(), finAttachmentEntityDir(entityType, entityId)), absPath);
    fs.rmSync(absPath, { force: true });
  } catch { /* best effort */ }
}
// Used by hard entity deletes (contract version/CR/invoice/meeting/client) —
// a deliberate scope limit: attachments are purged immediately and are NOT
// covered by that entity's own 5s undo (restoring a deleted contract version
// restores its fields, not files that were already removed from disk).
function purgeFinanceAttachmentsForEntities(entityType, entityIds) {
  if (!entityIds || !entityIds.length) return;
  const rows = conn().prepare(
    `SELECT * FROM finance_attachments WHERE entity_type = ? AND entity_id IN (${entityIds.map(() => '?').join(',')})`
  ).all(entityType, ...entityIds);
  for (const row of rows) {
    try { fs.rmSync(finResolveStoredPath(row.file_path), { force: true }); } catch { /* best effort */ }
  }
  conn().prepare(
    `DELETE FROM finance_attachments WHERE entity_type = ? AND entity_id IN (${entityIds.map(() => '?').join(',')})`
  ).run(entityType, ...entityIds);
}

// ── Minutes of Meeting ───────────────────────────────────────────────────────
function ownsFinanceMeeting(userId, id) {
  return !!conn().prepare('SELECT 1 FROM finance_meetings WHERE id = ? AND user_id = ?').get(id, userId);
}
function ownsFinanceMeetingAction(userId, id) {
  return !!conn().prepare(
    'SELECT 1 FROM finance_meeting_actions a JOIN finance_meetings m ON m.id = a.meeting_id WHERE a.id = ? AND a.user_id = ? AND m.user_id = ?'
  ).get(id, userId, userId);
}
function financeMeetingActionToApi(r) {
  return {
    id: r.id, meetingId: r.meeting_id, description: r.description, owner: r.owner || '',
    dueDate: r.due_date || '', status: r.status, sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function financeMeetingToApi(r, includeChildren) {
  const api = {
    id: r.id, clientId: r.client_id, contractId: r.contract_id, crId: r.cr_id, title: r.title,
    meetingDate: r.meeting_date || '', location: r.location || '', attendees: r.attendees || '',
    agenda: r.agenda || '', content: r.content || '', contentFormat: r.content_format || 'html',
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (includeChildren) {
    api.actions = conn().prepare('SELECT * FROM finance_meeting_actions WHERE meeting_id = ? ORDER BY sort_order, id')
      .all(r.id).map(financeMeetingActionToApi);
  }
  return api;
}
function listFinanceMeetings(userId, clientId) {
  if (!ownsFinanceClient(userId, clientId)) return [];
  return conn().prepare('SELECT * FROM finance_meetings WHERE client_id = ? AND user_id = ? ORDER BY meeting_date, id')
    .all(clientId, userId).map(r => financeMeetingToApi(r, true));
}
function getFinanceMeeting(userId, id) {
  const r = conn().prepare('SELECT * FROM finance_meetings WHERE id = ? AND user_id = ?').get(id, userId);
  return r ? financeMeetingToApi(r, true) : null;
}
function createFinanceMeeting(userId, clientId, data) {
  if (!ownsFinanceClient(userId, clientId)) return { ok: false, error: 'Client not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Meeting title is required' };
  let contractId = data?.contractId != null ? Number(data.contractId) : null;
  if (contractId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_contracts WHERE id = ? AND client_id = ? AND user_id = ?').get(contractId, clientId, userId);
    if (!owned) return { ok: false, error: 'Contract not found for this client' };
  }
  let crId = data?.crId != null ? Number(data.crId) : null;
  if (crId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_change_requests WHERE id = ? AND client_id = ? AND user_id = ?').get(crId, clientId, userId);
    if (!owned) return { ok: false, error: 'Change request not found for this client' };
  }
  const now = nowIso();
  const id = Number(conn().prepare(
    `INSERT INTO finance_meetings(user_id, client_id, contract_id, cr_id, title, meeting_date, location, attendees, agenda, content, content_format, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(userId, clientId, contractId, crId, title, data?.meetingDate || null, String(data?.location ?? '').trim(),
        String(data?.attendees ?? '').trim(), String(data?.agenda ?? '').trim(), String(data?.content ?? ''),
        'html', now, now).lastInsertRowid);
  return { ok: true, meeting: getFinanceMeeting(userId, id) };
}
function updateFinanceMeeting(userId, id, data) {
  if (!ownsFinanceMeeting(userId, id)) return { ok: false, error: 'Meeting not found' };
  const title = String(data?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Meeting title is required' };
  const row = conn().prepare('SELECT client_id FROM finance_meetings WHERE id = ?').get(id);
  let contractId = data?.contractId != null ? Number(data.contractId) : null;
  if (contractId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_contracts WHERE id = ? AND client_id = ? AND user_id = ?').get(contractId, row.client_id, userId);
    if (!owned) return { ok: false, error: 'Contract not found for this client' };
  }
  let crId = data?.crId != null ? Number(data.crId) : null;
  if (crId != null) {
    const owned = conn().prepare('SELECT 1 FROM finance_change_requests WHERE id = ? AND client_id = ? AND user_id = ?').get(crId, row.client_id, userId);
    if (!owned) return { ok: false, error: 'Change request not found for this client' };
  }
  conn().prepare(
    `UPDATE finance_meetings SET contract_id = ?, cr_id = ?, title = ?, meeting_date = ?, location = ?, attendees = ?,
       agenda = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(contractId, crId, title, data?.meetingDate || null, String(data?.location ?? '').trim(),
        String(data?.attendees ?? '').trim(), String(data?.agenda ?? '').trim(), String(data?.content ?? ''),
        nowIso(), id, userId);
  return { ok: true, meeting: getFinanceMeeting(userId, id) };
}
// Cascades its action items (ON DELETE CASCADE) and purges attachments
// immediately (see purgeFinanceAttachmentsForEntities's doc comment). The
// snapshot carries actions[] so a client-orchestrated undo can recreate them.
function deleteFinanceMeeting(userId, id) {
  if (!ownsFinanceMeeting(userId, id)) return { ok: false, error: 'Meeting not found' };
  const snapshot = getFinanceMeeting(userId, id);
  purgeFinanceAttachmentsForEntities('meeting', [id]);
  conn().prepare('DELETE FROM finance_meetings WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot };
}

function createFinanceMeetingAction(userId, meetingId, data) {
  if (!ownsFinanceMeeting(userId, meetingId)) return { ok: false, error: 'Meeting not found' };
  const description = String(data?.description ?? '').trim();
  if (!description) return { ok: false, error: 'Action item description is required' };
  const now = nowIso();
  const maxSort = conn().prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM finance_meeting_actions WHERE meeting_id = ?').get(meetingId).m;
  conn().prepare(
    `INSERT INTO finance_meeting_actions(user_id, meeting_id, description, owner, due_date, status, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,'OPEN',?,?,?)`
  ).run(userId, meetingId, description, String(data?.owner ?? '').trim(), data?.dueDate || null, maxSort + 1, now, now);
  return { ok: true, meeting: getFinanceMeeting(userId, meetingId) };
}
function updateFinanceMeetingAction(userId, id, data) {
  if (!ownsFinanceMeetingAction(userId, id)) return { ok: false, error: 'Action item not found' };
  const description = String(data?.description ?? '').trim();
  if (!description) return { ok: false, error: 'Action item description is required' };
  const row = conn().prepare('SELECT meeting_id FROM finance_meeting_actions WHERE id = ?').get(id);
  conn().prepare(
    `UPDATE finance_meeting_actions SET description = ?, owner = ?, due_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).run(description, String(data?.owner ?? '').trim(), data?.dueDate || null, nowIso(), id, userId);
  return { ok: true, meeting: getFinanceMeeting(userId, row.meeting_id) };
}
// Dedicated action (not a field on updateFinanceMeetingAction) so a routine edit
// can never accidentally flip status — mirrors setFinalFinanceContractVersion.
function toggleFinanceMeetingActionStatus(userId, id) {
  if (!ownsFinanceMeetingAction(userId, id)) return { ok: false, error: 'Action item not found' };
  const row = conn().prepare('SELECT * FROM finance_meeting_actions WHERE id = ?').get(id);
  const next = row.status === 'DONE' ? 'OPEN' : 'DONE';
  conn().prepare('UPDATE finance_meeting_actions SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), id);
  return { ok: true, meeting: getFinanceMeeting(userId, row.meeting_id) };
}
function deleteFinanceMeetingAction(userId, id) {
  if (!ownsFinanceMeetingAction(userId, id)) return { ok: false, error: 'Action item not found' };
  const row = conn().prepare('SELECT * FROM finance_meeting_actions WHERE id = ?').get(id);
  conn().prepare('DELETE FROM finance_meeting_actions WHERE id = ? AND user_id = ?').run(id, userId);
  return { ok: true, snapshot: financeMeetingActionToApi(row), meeting: getFinanceMeeting(userId, row.meeting_id) };
}

// ── Summary (per-client Overview tab) ────────────────────────────────────────
function getFinanceClientSummary(userId, clientId) {
  if (!ownsFinanceClient(userId, clientId)) return null;
  const c = conn();
  const contractCount = c.prepare('SELECT COUNT(*) AS n FROM finance_contracts WHERE client_id = ?').get(clientId).n;
  const activeContractCount = c.prepare(
    `SELECT COUNT(*) AS n FROM finance_contracts k
       LEFT JOIN finance_lookups st ON st.id = k.status_id
      WHERE k.client_id = ? AND st.code = 'ACTIVE'`
  ).get(clientId).n;
  const finalContractValueMinor = c.prepare(
    `SELECT COALESCE(SUM(v.value_minor), 0) AS n FROM finance_contract_versions v
       JOIN finance_contracts k ON k.id = v.contract_id
      WHERE k.client_id = ? AND v.is_final = 1`
  ).get(clientId).n;
  // Excludes CANCELLED invoices, matching FINANCE_CLIENT_SELECT's outstanding_minor
  // subquery above — otherwise a cancelled invoice would count as outstanding
  // receivable here while the clients-grid card (which uses that subquery)
  // shows it as settled, the two views silently disagreeing.
  const invoicedMinor = c.prepare(
    `SELECT COALESCE(SUM(i.amount_minor + i.tax_minor), 0) AS n FROM finance_invoices i
       LEFT JOIN finance_lookups st ON st.id = i.status_id
      WHERE i.client_id = ? AND (st.code IS NULL OR st.code != 'CANCELLED')`
  ).get(clientId).n;
  const paidMinor = c.prepare(
    `SELECT COALESCE(SUM(p.amount_minor), 0) AS n FROM finance_invoice_payments p
       JOIN finance_invoices i ON i.id = p.invoice_id
      WHERE i.client_id = ?`
  ).get(clientId).n;
  const changeRequestCount = c.prepare('SELECT COUNT(*) AS n FROM finance_change_requests WHERE client_id = ?').get(clientId).n;
  return {
    contractCount, activeContractCount, finalContractValueMinor,
    invoicedMinor, paidMinor, outstandingMinor: Math.max(0, invoicedMinor - paidMinor),
    changeRequestCount,
  };
}

// ── Cross-module feeds (Attention Center / Recent Activity) ─────────────────
// The rest of the app's date-urgent sources live in db.js's getAttentionItems(),
// but Finance owns 100% of its own SQL, so it contributes its rows from here and
// main.js concatenates the two. Merging in main.js rather than calling this from
// db.js also avoids a circular require — finance-db.js already requires db.js
// for the shared connection.
//
// Returns raw dates plus a deep-link target, matching getAttentionItems()'s
// contract exactly: the renderer already owns daysUntil()/renewClass()/
// renewLabel() and applies the same day-math to these rows.
function getFinanceAttentionItems(userId) {
  const items = [];

  // Unpaid/partly-paid invoices only. A settled or cancelled invoice is not
  // something to act on, and would otherwise sit in the Attention list forever.
  const invoices = conn().prepare(
    `SELECT i.id, i.number, i.due_date, i.client_id, i.amount_minor, i.tax_minor,
            COALESCE(p.paid, 0) AS paid, st.code AS status_code
       FROM finance_invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount_minor) AS paid FROM finance_invoice_payments GROUP BY invoice_id) p
         ON p.invoice_id = i.id
       LEFT JOIN finance_lookups st ON st.id = i.status_id
      WHERE i.user_id = ? AND i.due_date IS NOT NULL AND i.due_date != ''`
  ).all(userId);
  for (const r of invoices) {
    if (r.status_code === 'CANCELLED' || r.status_code === 'PAID') continue;
    if (r.amount_minor + r.tax_minor - r.paid <= 0) continue;
    items.push({
      type: 'financeInvoice', id: r.id, title: r.number || 'Invoice',
      date: r.due_date, module: 'finance', clientId: r.client_id,
    });
  }

  const installments = conn().prepare(
    `SELECT n.id, n.title, n.seq, n.due_date, k.client_id,
            n.amount_minor, COALESCE(l.allocated, 0) AS allocated
       FROM finance_contract_installments n
       JOIN finance_contracts k ON k.id = n.contract_id
       LEFT JOIN (
         SELECT il.installment_id, SUM(il.allocated_minor) AS allocated
           FROM finance_invoice_links il
           JOIN finance_invoices iv ON iv.id = il.invoice_id
           LEFT JOIN finance_lookups s ON s.id = iv.status_id
          WHERE il.installment_id IS NOT NULL AND (s.code IS NULL OR s.code != 'CANCELLED')
          GROUP BY il.installment_id
       ) l ON l.installment_id = n.id
      WHERE n.user_id = ? AND n.due_date IS NOT NULL AND n.due_date != ''`
  ).all(userId);
  for (const r of installments) {
    // Fully invoiced already — the invoice's own due date takes over from here.
    if (r.allocated >= r.amount_minor) continue;
    items.push({
      type: 'financeInstallment', id: r.id,
      title: r.title || `Installment ${r.seq}`,
      date: r.due_date, module: 'finance', clientId: r.client_id,
    });
  }

  const contracts = conn().prepare(
    `SELECT k.id, k.title, k.end_date, k.client_id, st.code AS status_code
       FROM finance_contracts k
       LEFT JOIN finance_lookups st ON st.id = k.status_id
      WHERE k.user_id = ? AND k.end_date IS NOT NULL AND k.end_date != ''`
  ).all(userId);
  for (const r of contracts) {
    if (r.status_code === 'TERMINATED' || r.status_code === 'EXPIRED') continue;
    items.push({
      type: 'financeContract', id: r.id, title: r.title || 'Contract',
      date: r.end_date, module: 'finance', clientId: r.client_id,
    });
  }

  return items;
}

// Finance's slice of the Overview activity stream. Same row shape as db.js's
// getRecentActivity(); main.js merges and re-sorts. Amounts are deliberately
// left out — this is a "what changed" feed, not a financial report.
function getFinanceRecentActivity(userId, requestedLimit = 16) {
  const limit = Math.max(1, Math.min(50, Number(requestedLimit) || 16));
  return conn().prepare(
    `SELECT kind, entityId, parentId, title, detail, changedAt, module FROM (
       SELECT 'finance-contract' AS kind, k.id AS entityId, k.client_id AS parentId,
              k.title AS title, 'Contract updated' AS detail, k.updated_at AS changedAt,
              'finance' AS module
         FROM finance_contracts k WHERE k.user_id = ?
       UNION ALL
       SELECT 'finance-invoice', i.id, i.client_id, i.number, 'Invoice updated', i.updated_at, 'finance'
         FROM finance_invoices i WHERE i.user_id = ?
       UNION ALL
       SELECT 'finance-cr', c.id, c.client_id, c.title, 'Change request updated', c.updated_at, 'finance'
         FROM finance_change_requests c WHERE c.user_id = ?
       UNION ALL
       SELECT 'finance-meeting', m.id, m.client_id, m.title, 'Meeting updated', m.updated_at, 'finance'
         FROM finance_meetings m WHERE m.user_id = ?
     ) ORDER BY changedAt DESC LIMIT ?`
  ).all(userId, userId, userId, userId, limit).map(row => ({
    kind: row.kind,
    id: row.entityId,
    parentId: row.parentId ?? null,
    title: row.title || '',
    detail: row.detail || '',
    changedAt: row.changedAt || '',
    module: row.module,
  }));
}

// Whole-account financial position for the Overview page — one aggregate read
// across every client, rather than the Overview fanning out per client.
// Cancelled invoices are excluded everywhere: they are not money owed.
function getFinanceOverview(userId) {
  const totals = conn().prepare(
    `SELECT
       COALESCE(SUM(i.amount_minor + i.tax_minor), 0) AS invoiced,
       COALESCE(SUM(COALESCE(p.paid, 0)), 0) AS paid
     FROM finance_invoices i
     LEFT JOIN (SELECT invoice_id, SUM(amount_minor) AS paid FROM finance_invoice_payments GROUP BY invoice_id) p
       ON p.invoice_id = i.id
     LEFT JOIN finance_lookups st ON st.id = i.status_id
     WHERE i.user_id = ? AND (st.code IS NULL OR st.code != 'CANCELLED')`
  ).get(userId);

  // "Overdue" is due-date-based, not status-based: an invoice whose status was
  // never advanced past ISSUED is still overdue if its date has passed.
  const today = new Date().toISOString().slice(0, 10);
  const overdue = conn().prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT i.id, i.amount_minor + i.tax_minor - COALESCE(p.paid, 0) AS outstanding
         FROM finance_invoices i
         LEFT JOIN (SELECT invoice_id, SUM(amount_minor) AS paid FROM finance_invoice_payments GROUP BY invoice_id) p
           ON p.invoice_id = i.id
         LEFT JOIN finance_lookups st ON st.id = i.status_id
        WHERE i.user_id = ? AND (st.code IS NULL OR st.code != 'CANCELLED')
          AND i.due_date IS NOT NULL AND i.due_date != '' AND i.due_date < ?
     ) WHERE outstanding > 0`
  ).get(userId, today).n;

  const clientCount = conn().prepare('SELECT COUNT(*) AS n FROM finance_clients WHERE user_id = ?').get(userId).n;
  const activeContracts = conn().prepare(
    `SELECT COUNT(*) AS n FROM finance_contracts k
       LEFT JOIN finance_lookups st ON st.id = k.status_id
      WHERE k.user_id = ? AND (st.code IS NULL OR st.code NOT IN ('TERMINATED', 'EXPIRED'))`
  ).get(userId).n;

  const invoiced = totals.invoiced || 0;
  const paid = totals.paid || 0;
  return {
    clientCount, activeContracts,
    invoicedMinor: invoiced, paidMinor: paid,
    outstandingMinor: Math.max(0, invoiced - paid),
    overdueInvoiceCount: overdue,
  };
}

module.exports = {
  FINANCE_LOOKUP_CATEGORIES, FINANCE_LOOKUP_SEED, seedLookupsIfMissing,
  getFinanceAttentionItems, getFinanceRecentActivity, getFinanceOverview,
  listFinanceLookups, saveFinanceLookups,
  listFinanceClients, getFinanceClient, createFinanceClient, updateFinanceClient, deleteFinanceClient,
  listFinanceCandidateCompanies,
  listFinanceContracts, getFinanceContract, createFinanceContract, updateFinanceContract, deleteFinanceContract,
  createFinanceContractVersion, updateFinanceContractVersion, deleteFinanceContractVersion, setFinalFinanceContractVersion,
  createFinanceInstallment, updateFinanceInstallment, deleteFinanceInstallment,
  listFinanceChangeRequests, getFinanceChangeRequest, createFinanceChangeRequest, updateFinanceChangeRequest, deleteFinanceChangeRequest,
  listFinanceInvoices, getFinanceInvoice, createFinanceInvoice, updateFinanceInvoice, deleteFinanceInvoice,
  createFinanceInvoiceLink, deleteFinanceInvoiceLink,
  createFinancePayment, updateFinancePayment, deleteFinancePayment,
  FINANCE_DOC_EXTENSIONS,
  listFinanceAttachments, createFinanceAttachment, resolveFinanceAttachment,
  deleteFinanceAttachment, restoreFinanceAttachment, purgeFinanceAttachmentFile,
  listFinanceMeetings, getFinanceMeeting, createFinanceMeeting, updateFinanceMeeting, deleteFinanceMeeting,
  createFinanceMeetingAction, updateFinanceMeetingAction, toggleFinanceMeetingActionStatus, deleteFinanceMeetingAction,
  getFinanceClientSummary,
};
