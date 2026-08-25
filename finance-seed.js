'use strict';

// FROZEN COMPATIBILITY SHIM — do not extend, do not repoint at finance_*.
//
// This file exists for exactly one reason: `migrations/054_finance.js` does
//     const { seedLookupsIfMissing } = require('../finance-seed');
// and calls it to seed each user's catalog into the `finance_lookups` table that
// migration 054 has just created. Migrations are append-only and can never be
// edited, so that require and that table name are permanent.
//
// The live module is now `finance-db.js`, and migration 055 renames every
// finance_* table to finance_*. But 055 runs AFTER 054, so at the moment 054
// executes — on a fresh install, and on every Full Restore of a pre-055
// backup — the finance_* tables do not exist yet. If this file were deleted,
// or rewritten to insert into finance_lookups, migration 054 would throw and
// **every fresh install and restore would fail**.
//
// So this stays, pinned to the 054-era schema, holding a frozen copy of the
// seed data as it stood when 054 was written. Later edits to the catalog
// belong in finance-db.js's FINANCE_LOOKUP_SEED; divergence between the two is
// expected and harmless, because this copy only ever runs once per database,
// during 054, and 055 immediately renames the table it wrote into.
//
// It must stay listed in package.json -> build.files.

// Frozen at migration 054. Do not sync with finance-db.js.
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

// `c` is an explicit connection param (not a module-level conn()) so migration
// 054 can call this with the raw DatabaseSync it was handed, before db.js's
// getConnection() would necessarily reflect the same open connection during a
// fresh-install boot sequence. Signature must not change — 054 calls it as
// seedLookupsIfMissing(db, userId).
function seedLookupsIfMissing(c, userId) {
  const has = c.prepare('SELECT 1 FROM finance_lookups WHERE user_id = ? LIMIT 1').get(userId);
  if (has) return;
  const now = new Date().toISOString();
  const ins = c.prepare(
    `INSERT INTO finance_lookups(user_id, category, code, label_en, label_ar, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const [category, items] of Object.entries(FINANCE_LOOKUP_SEED)) {
    items.forEach(([code, labelEn, labelAr], i) => ins.run(userId, category, code, labelEn, labelAr, i, now, now));
  }
}

module.exports = { seedLookupsIfMissing };
