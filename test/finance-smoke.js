// ─────────────────────────────────────────────────────────────────────────────
// Finance — headless data-layer smoke test (Phase 1: clients, contracts,
// contract versions, installments, the Setup-tab catalog).
//
// Boots the app's data layer (db.js) + finance-db.js DIRECTLY — no Electron, no
// IPC, no renderer. SAFETY: never touches production. Copies the (fixture,
// under run-all.js — see test-bootstrap.js) DB into a throwaway temp dir and
// runs everything there; the temp dir is deleted at the end regardless of
// outcome.
//
// Run:  node test/finance-smoke.js
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');
const financeDb = require('../finance-db');

const results = [];
function record(flow, pass, details) { results.push({ flow, pass, details }); }

// Guards against reading/copying the REAL production DB when this file is run
// directly (bypassing run-all.js) — see test-bootstrap.js.
require('./test-bootstrap');

const prodDir = path.join(os.homedir(), 'AppData', 'Roaming', 'timesheet');
const prodDb  = path.join(prodDir, 'cooperation-tools.db');
if (!fs.existsSync(prodDb)) {
  console.error('FATAL: production DB not found at ' + prodDb);
  process.exit(2);
}
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-smoke-'));
for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, 'cooperation-tools.db' + suffix));
}
console.log('Working copy: ' + path.join(workDir, 'cooperation-tools.db'));

let exitCode = 0;
try {
  // ── Baseline row counts on tables Finance must never touch ─────────────────
  const rawBefore = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countBefore = (t) => rawBefore.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const before = {
    projects: countBefore('projects'), tasks: countBefore('tasks'),
    work_logs: countBefore('work_logs'), lookup_codes: countBefore('lookup_codes'),
  };
  rawBefore.close();

  // ── Gate 1 — migration 054 applies cleanly ──────────────────────────────────
  db.openConnection(workDir);
  db.applyMigrations();
  record('Gate 1: migration 054 applies cleanly', true, 'no throw');

  // ── Gate 2 — idempotent re-run ───────────────────────────────────────────────
  db.applyMigrations();
  record('Gate 2: re-applying migrations is a no-op', true, 'no throw, no duplicate rows');

  // ── Gate 3 — existing tables/rows unaffected, LOOKUP_CATEGORIES unchanged ───
  const rawAfter = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'));
  const countAfter = (t) => rawAfter.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const after = {
    projects: countAfter('projects'), tasks: countAfter('tasks'),
    work_logs: countAfter('work_logs'), lookup_codes: countAfter('lookup_codes'),
  };
  rawAfter.close();
  const gate3Pass = after.projects === before.projects && after.tasks === before.tasks
    && after.work_logs === before.work_logs && after.lookup_codes === before.lookup_codes;
  record('Gate 3: pre-existing tables unaffected', gate3Pass,
    `projects ${before.projects}->${after.projects}, tasks ${before.tasks}->${after.tasks}, ` +
    `work_logs ${before.work_logs}->${after.work_logs}, lookup_codes ${before.lookup_codes}->${after.lookup_codes}`);

  const EXPECTED_LOOKUP_CATEGORIES = [
    'COMPANY', 'SYSTEM', 'ACTIVITY_TYPE', 'TIME_TYPE', 'ENTRY_STATUS', 'CURRENCY', 'BILLING_CYCLE',
    'PROJECT_STATUS', 'PROJECT_DOCUMENT', 'COMPANY_DOCUMENT_CATEGORY', 'KNOWLEDGE_TYPE', 'DEPARTMENT',
    'TASK_SOURCE_TYPE', 'SERVER_ROLE',
  ];
  const categoriesMatch = JSON.stringify(db.LOOKUP_CATEGORIES) === JSON.stringify(EXPECTED_LOOKUP_CATEGORIES);
  record('Gate 4: db.js LOOKUP_CATEGORIES is unchanged (isolation gate)', categoriesMatch,
    db.LOOKUP_CATEGORIES.join(','));
  const noFinanceInShared = !db.LOOKUP_CATEGORIES.some(c => c.startsWith('CONTRACT_') || c.startsWith('CR_') || c === 'INVOICE_STATUS' || c === 'PAYMENT_METHOD');
  record('Gate 5: no Finance category leaked into the shared lookup_codes catalog', noFinanceInShared, '');

  const userRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  if (!userRow) throw new Error('no active user in the copied DB');
  const userId = userRow.id;
  console.log('Using userId=' + userId + '\n');

  // ── Lookups: seeded, bilingual, active ───────────────────────────────────────
  const lookups = financeDb.listFinanceLookups(userId);
  const seedOk = financeDb.FINANCE_LOOKUP_CATEGORIES.every(cat => {
    const list = lookups.categories[cat] || [];
    return list.length === financeDb.FINANCE_LOOKUP_SEED[cat].length
      && list.every(o => o.isActive && o.labelEn && o.labelAr);
  });
  record('Lookups: all five categories seeded, active, bilingual', seedOk, JSON.stringify(Object.keys(lookups.categories)));

  // Lazy per-user seeding: a second (freshly created) user gets seeded on first read.
  const secondUserId = db.createUser('finance-fixture-second', 'x', false);
  const lookups2 = financeDb.listFinanceLookups(secondUserId);
  record('Lookups: lazily seeded for a user created after the migration ran',
    (lookups2.categories.CURRENCY || []).length === financeDb.FINANCE_LOOKUP_SEED.CURRENCY.length, '');

  // Setup tab: add a value, relabel an existing one, soft-disable another; codes stay immutable.
  const beforeSave = financeDb.listFinanceLookups(userId).categories.PAYMENT_METHOD;
  const cashRow = beforeSave.find(o => o.code === 'CASH');
  const saveRes = financeDb.saveFinanceLookups(userId, { categories: { PAYMENT_METHOD: [
    ...beforeSave.map(o => o.id === cashRow.id ? { ...o, labelEn: 'Cash Payment', isActive: false } : o),
    { labelEn: 'Wire Transfer', labelAr: 'حوالة' },
  ] } });
  const afterSave = financeDb.listFinanceLookups(userId).categories.PAYMENT_METHOD;
  const relabeled = afterSave.find(o => o.id === cashRow.id);
  const added = afterSave.find(o => o.labelEn === 'Wire Transfer');
  record('Setup: relabel + soft-disable an existing code, add a new one, codes stable', saveRes.ok
    && relabeled.labelEn === 'Cash Payment' && relabeled.isActive === false && relabeled.code === 'CASH'
    && added && /^[A-Z0-9_]+$/.test(added.code), JSON.stringify({ relabeled, added }));

  // ── Clients: now a finance profile of a shared COMPANY (migration 056) ──────
  // Helper: adds a company to the shared roster and returns its lookup id, so
  // each gate below can claim its own company rather than fighting over one.
  let companySeq = 0;
  function newCompany(nameEn, code) {
    companySeq += 1;
    const c = code || ('FINTEST' + companySeq);
    db.saveLookups(userId, { categories: { COMPANY: [
      ...db.getLookupsByCategory('COMPANY', true).map(r => ({ ...r })),
      { code: c, label: nameEn, nameEn, nameAr: '', isActive: true },
    ] } });
    return db.getLookupsByCategory('COMPANY', true).find(r => r.code === c).id;
  }

  const acmeCompanyId = newCompany('Acme Corp', 'ACME');
  const clientRes = financeDb.createFinanceClient(userId, { companyId: acmeCompanyId, contactEmail: 'ap@acme.test' });
  record('Client: created by picking a company from the shared roster',
    clientRes.ok && clientRes.client.name === 'Acme Corp' && clientRes.client.companyId === acmeCompanyId
      && clientRes.client.contractCount === 0, JSON.stringify(clientRes));
  const clientId = clientRes.client.id;

  const dupCompany = financeDb.createFinanceClient(userId, { companyId: acmeCompanyId });
  record('Client: the same company cannot be added to Finance twice',
    dupCompany.ok === false, JSON.stringify(dupCompany));

  const noCompany = financeDb.createFinanceClient(userId, { contactEmail: 'x@y.test' });
  record('Client: a create without a company is refused', noCompany.ok === false, JSON.stringify(noCompany));

  const bogusCompany = financeDb.createFinanceClient(userId, { companyId: 99999 });
  record('Client: a create against an unknown company id is refused',
    bogusCompany.ok === false, JSON.stringify(bogusCompany));

  const candidates = financeDb.listFinanceCandidateCompanies(userId);
  record('Client: the picker excludes companies already in Finance',
    !candidates.some(c => c.id === acmeCompanyId) && candidates.length > 0, 'count=' + candidates.length);

  const listedClients = financeDb.listFinanceClients(userId);
  record('Client: list includes the created client', listedClients.some(c => c.id === clientId), 'count=' + listedClients.length);

  // Identity now comes from the company, so renaming there must show up here.
  db.saveLookups(userId, { categories: { COMPANY: db.getLookupsByCategory('COMPANY', true)
    .map(r => (r.id === acmeCompanyId ? { ...r, nameEn: 'Acme Corporation', label: 'Acme Corporation' } : { ...r })) } });
  record('Client: a rename in the shared catalog flows through to Finance',
    financeDb.getFinanceClient(userId, clientId).name === 'Acme Corporation',
    financeDb.getFinanceClient(userId, clientId).name);

  const updRes = financeDb.updateFinanceClient(userId, clientId, { contactEmail: 'billing@acme.test', taxNumber: '300123' });
  record('Client: update edits only the finance-owned fields',
    updRes.ok && updRes.client.contactEmail === 'billing@acme.test' && updRes.client.taxNumber === '300123'
      && updRes.client.name === 'Acme Corporation', JSON.stringify(updRes));

  const otherUserRow = new DatabaseSync(path.join(workDir, 'cooperation-tools.db'))
    .prepare('SELECT id FROM users WHERE id != ? LIMIT 1').get(userId);
  if (otherUserRow) {
    const stolenRead = financeDb.getFinanceClient(otherUserRow.id, clientId);
    const stolenWrite = financeDb.updateFinanceClient(otherUserRow.id, clientId, { name: 'stolen' });
    record('Client: ownership gating on read + write', stolenRead === null && stolenWrite.ok === false,
      JSON.stringify({ stolenRead, stolenWrite }));
  }

  // ── Contracts + Versions + Installments ─────────────────────────────────────
  const contractRes = financeDb.createFinanceContract(userId, clientId, {
    title: 'Support Agreement 2026', ref: 'FINANCE-C-001', status: 'ACTIVE', currencyCode: 'sar',
    startDate: '2026-01-01', endDate: '2026-12-31',
  });
  record('Contract: create resolves status code + currency', contractRes.ok
    && contractRes.contract.status === 'ACTIVE' && contractRes.contract.currencyCode === 'SAR'
    && Array.isArray(contractRes.contract.versions) && Array.isArray(contractRes.contract.installments),
    JSON.stringify(contractRes.contract));
  const contractId = contractRes.contract.id;

  const badCurrency = financeDb.createFinanceContract(userId, clientId, { title: 'Bad currency test', currencyCode: 'XXX' });
  record('Contract: unknown currency coerced to empty (not stored as junk)', badCurrency.ok && badCurrency.contract.currencyCode === '',
    'currencyCode=' + badCurrency.contract.currencyCode);
  financeDb.deleteFinanceContract(userId, badCurrency.contract.id);

  const v1 = financeDb.createFinanceContractVersion(userId, contractId, { versionLabel: 'v1.0', valueMinor: 10_000_00, isFinal: true });
  const v2 = financeDb.createFinanceContractVersion(userId, contractId, { versionLabel: 'v1.1', valueMinor: 12_000_00, isFinal: true });
  const v3 = financeDb.createFinanceContractVersion(userId, contractId, { versionLabel: 'v1.2', valueMinor: 15_000_00 });
  const finalsAfterCreate = financeDb.getFinanceContract(userId, contractId).versions.filter(v => v.isFinal);
  record('Version: creating a second isFinal version clears the first (exactly one final)',
    v1.ok && v2.ok && v3.ok && finalsAfterCreate.length === 1 && finalsAfterCreate[0].versionLabel === 'v1.1',
    JSON.stringify(finalsAfterCreate));

  const v3Id = financeDb.getFinanceContract(userId, contractId).versions.find(v => v.versionLabel === 'v1.2').id;
  financeDb.setFinalFinanceContractVersion(userId, v3Id);
  financeDb.setFinalFinanceContractVersion(userId, v3Id); // repeat call — must stay idempotent, still exactly one final
  const finalsAfterRepeat = financeDb.getFinanceContract(userId, contractId).versions.filter(v => v.isFinal);
  record('Version: repeated setFinal calls leave exactly one final version', finalsAfterRepeat.length === 1
    && finalsAfterRepeat[0].id === v3Id, JSON.stringify(finalsAfterRepeat));

  const dupLabel = financeDb.createFinanceContractVersion(userId, contractId, { versionLabel: 'v1.2', valueMinor: 1 });
  record('Version: duplicate version label on the same contract is rejected', dupLabel.ok === false, JSON.stringify(dupLabel));

  const inst1 = financeDb.createFinanceInstallment(userId, contractId, { title: 'Kickoff', amountMinor: 5_000_00, dueDate: '2026-02-01' });
  const inst2 = financeDb.createFinanceInstallment(userId, contractId, { title: 'Milestone 2', amountMinor: 5_000_00, dueDate: '2026-06-01' });
  record('Installment: auto-sequenced (1, then 2)', inst1.ok && inst2.ok
    && financeDb.getFinanceContract(userId, contractId).installments.map(i => i.seq).join(',') === '1,2',
    JSON.stringify(financeDb.getFinanceContract(userId, contractId).installments.map(i => i.seq)));

  const inst1Id = financeDb.getFinanceContract(userId, contractId).installments[0].id;
  const dupSeq = financeDb.createFinanceInstallment(userId, contractId, { seq: 1, title: 'Collides', amountMinor: 1 });
  record('Installment: duplicate seq on the same contract is rejected', dupSeq.ok === false, JSON.stringify(dupSeq));

  // ── Change Requests ──────────────────────────────────────────────────────────
  const crRes = financeDb.createFinanceChangeRequest(userId, clientId, {
    title: 'Add reporting module', ref: 'CR-001', status: 'APPROVED', amountMinor: 3_000_00, currencyCode: 'sar', contractId,
  });
  record('CR: create resolves status + currency + contract link', crRes.ok
    && crRes.cr.status === 'APPROVED' && crRes.cr.currencyCode === 'SAR' && crRes.cr.contractId === contractId,
    JSON.stringify(crRes));
  const crId = crRes.cr.id;

  const crForeignContract = financeDb.createFinanceChangeRequest(userId, clientId, { title: 'x', contractId: 999999 });
  record('CR: rejects a contract id that does not belong to this client', crForeignContract.ok === false, JSON.stringify(crForeignContract));

  const dupRef = financeDb.createFinanceChangeRequest(userId, clientId, { title: 'Dup ref', ref: 'CR-001' });
  record('CR: duplicate ref for the same user is rejected', dupRef.ok === false, JSON.stringify(dupRef));

  const listedCrs = financeDb.listFinanceChangeRequests(userId, clientId);
  record('CR: list includes the created CR', listedCrs.some(c => c.id === crId), 'count=' + listedCrs.length);

  // ── Invoices + Links (invariants 2-4) ────────────────────────────────────────
  const invRes = financeDb.createFinanceInvoice(userId, clientId, { number: 'INV-0001', amountMinor: 8_000_00, taxMinor: 0, currencyCode: 'sar', status: 'ISSUED' });
  record('Invoice: create resolves status + currency', invRes.ok && invRes.invoice.status === 'ISSUED' && invRes.invoice.currencyCode === 'SAR',
    JSON.stringify(invRes));
  const invoiceId = invRes.invoice.id;

  const dupNumber = financeDb.createFinanceInvoice(userId, clientId, { number: 'INV-0001', amountMinor: 1 });
  record('Invoice: duplicate number for the same user is rejected', dupNumber.ok === false, JSON.stringify(dupNumber));

  const usdInvoice = financeDb.createFinanceInvoice(userId, clientId, { number: 'INV-USD-1', amountMinor: 100_00, currencyCode: 'usd' });
  const currencyMismatch = financeDb.createFinanceInvoiceLink(userId, usdInvoice.invoice.id, { installmentId: inst1Id, allocatedMinor: 100 });
  record('Link: currency mismatch between invoice and installment/contract is rejected', currencyMismatch.ok === false, JSON.stringify(currencyMismatch));
  financeDb.deleteFinanceInvoice(userId, usdInvoice.invoice.id);

  const overAlloc = financeDb.createFinanceInvoiceLink(userId, invoiceId, { installmentId: inst1Id, allocatedMinor: 999_999_00 });
  record('Link: over-allocating an installment beyond its amount is rejected', overAlloc.ok === false, JSON.stringify(overAlloc));

  const linkOk = financeDb.createFinanceInvoiceLink(userId, invoiceId, { installmentId: inst1Id, allocatedMinor: 5_000_00 });
  record('Link: full allocation of an installment succeeds', linkOk.ok === true
    && financeDb.getFinanceContract(userId, contractId).installments.find(i => i.id === inst1Id).outstandingMinor === 0,
    JSON.stringify(linkOk));

  const dupLink = financeDb.createFinanceInvoiceLink(userId, invoiceId, { installmentId: inst1Id, allocatedMinor: 1 });
  record('Link: a second link from the same invoice to the same installment is rejected', dupLink.ok === false, JSON.stringify(dupLink));

  const exclusivity = financeDb.createFinanceInvoiceLink(userId, invoiceId, {});
  record('Link: neither installment nor CR specified is rejected', exclusivity.ok === false, JSON.stringify(exclusivity));

  const bothSpecified = financeDb.createFinanceInvoiceLink(userId, invoiceId, { installmentId: inst1Id, crId, allocatedMinor: 1 });
  record('Link: both installment and CR specified is rejected', bothSpecified.ok === false, JSON.stringify(bothSpecified));

  // Invariant 6: an invoiced installment cannot be deleted, and the row is untouched.
  const refusedInstDelete = financeDb.deleteFinanceInstallment(userId, inst1Id);
  record('Installment: delete refused once invoiced, row untouched', refusedInstDelete.ok === false
    && financeDb.getFinanceContract(userId, contractId).installments.some(i => i.id === inst1Id), JSON.stringify(refusedInstDelete));

  const crOverAlloc = financeDb.createFinanceInvoiceLink(userId, invoiceId, { crId, allocatedMinor: 999_999_00 });
  record('Link: over-allocating a CR beyond its amount is rejected', crOverAlloc.ok === false, JSON.stringify(crOverAlloc));
  const crLinkOk = financeDb.createFinanceInvoiceLink(userId, invoiceId, { crId, allocatedMinor: 3_000_00 });
  record('Link: full allocation of a CR succeeds', crLinkOk.ok === true, JSON.stringify(crLinkOk));
  const refusedCrDelete = financeDb.deleteFinanceChangeRequest(userId, crId);
  record('CR: delete refused once invoiced', refusedCrDelete.ok === false, JSON.stringify(refusedCrDelete));

  // ── Payments (invariant 5) ───────────────────────────────────────────────────
  const invoiceTotal = invRes.invoice.totalMinor; // 8_000_00
  const payTooMuch = financeDb.createFinancePayment(userId, invoiceId, { amountMinor: invoiceTotal + 1, method: 'BANK_TRANSFER' });
  record('Payment: over-paying the invoice is rejected', payTooMuch.ok === false, JSON.stringify(payTooMuch));

  const partialPay = financeDb.createFinancePayment(userId, invoiceId, { amountMinor: 5_000_00, method: 'bank_transfer', paidDate: '2026-03-01' });
  record('Payment: partial payment recorded, resolves method', partialPay.ok === true
    && partialPay.invoice.paidMinor === 5_000_00 && partialPay.invoice.outstandingMinor === 3_000_00,
    JSON.stringify(partialPay));

  const remainderTooMuch = financeDb.createFinancePayment(userId, invoiceId, { amountMinor: 3_000_01 });
  record('Payment: a second payment that would exceed the remaining balance is rejected', remainderTooMuch.ok === false, JSON.stringify(remainderTooMuch));

  const paymentIdsBeforeFinal = new Set(partialPay.invoice.payments.map(p => p.id));
  const finalPay = financeDb.createFinancePayment(userId, invoiceId, { amountMinor: 3_000_00 });
  record('Payment: final payment brings outstanding to zero', finalPay.ok === true && finalPay.invoice.outstandingMinor === 0, JSON.stringify(finalPay));

  // payments[] is ordered by paid_date (nulls first) then id, NOT insertion
  // order — find the newly-created row by set difference rather than assuming
  // it's last in the array.
  const paymentId = finalPay.invoice.payments.find(p => !paymentIdsBeforeFinal.has(p.id)).id;
  const payUpdateOverpay = financeDb.updateFinancePayment(userId, paymentId, { amountMinor: 3_000_01 });
  record('Payment: editing a payment to exceed the invoice total is rejected', payUpdateOverpay.ok === false, JSON.stringify(payUpdateOverpay));

  const payDelete = financeDb.deleteFinancePayment(userId, paymentId);
  record('Payment: delete removes it and frees up the balance', payDelete.ok === true && payDelete.invoice.outstandingMinor === 3_000_00, JSON.stringify(payDelete));

  // ── Invoice delete cascades links + payments, freeing the installment/CR ────
  const invoiceDelete = financeDb.deleteFinanceInvoice(userId, invoiceId);
  record('Invoice: delete cascades its links and payments', invoiceDelete.ok === true
    && invoiceDelete.snapshot.links.length === 2 && invoiceDelete.snapshot.payments.length === 1,
    JSON.stringify(invoiceDelete.snapshot));

  const instFreedNow = financeDb.getFinanceContract(userId, contractId).installments.find(i => i.id === inst1Id);
  record('Installment: outstanding restored after the invoice that allocated it is deleted', instFreedNow.invoicedMinor === 0, JSON.stringify(instFreedNow));

  const crDeleteAllowedNow = financeDb.deleteFinanceChangeRequest(userId, crId);
  record('CR: delete allowed once its invoice allocation is gone', crDeleteAllowedNow.ok === true, JSON.stringify(crDeleteAllowedNow));

  const allowedDelete = financeDb.deleteFinanceInstallment(userId, inst1Id);
  record('Installment: delete allowed once the allocation is gone', allowedDelete.ok === true, JSON.stringify(allowedDelete));

  // ── Client delete refusal while it still owns a contract ────────────────────
  const clientDeleteRefused = financeDb.deleteFinanceClient(userId, clientId);
  record('Client: delete refused while it still owns a contract', clientDeleteRefused.ok === false, JSON.stringify(clientDeleteRefused));

  const someVersionId = financeDb.getFinanceContract(userId, contractId).versions[0].id;
  financeDb.deleteFinanceContractVersion(userId, someVersionId);
  const remainingVersionsBeforeDelete = financeDb.getFinanceContract(userId, contractId).versions.length;
  financeDb.deleteFinanceContract(userId, contractId);
  const contractGone = financeDb.getFinanceContract(userId, contractId) === null;
  record('Contract: delete cascades its versions/installments', contractGone, 'remainingVersionsBeforeDelete=' + remainingVersionsBeforeDelete);

  const clientDeleteAllowed = financeDb.deleteFinanceClient(userId, clientId);
  record('Client: delete allowed once contract-free', clientDeleteAllowed.ok === true, JSON.stringify(clientDeleteAllowed));

  // ── Phase 3: Attachments ─────────────────────────────────────────────────────
  const p3Client = financeDb.createFinanceClient(userId, { companyId: newCompany('Phase 3 Client') }).client;
  const p3ContractRes = financeDb.createFinanceContract(userId, p3Client.id, { title: 'Phase 3 Contract', status: 'ACTIVE' });
  const p3VersionRes = financeDb.createFinanceContractVersion(userId, p3ContractRes.contract.id, { versionLabel: 'v1.0', valueMinor: 1_000_00, isFinal: true });
  const p3VersionId = p3VersionRes.contract.versions[0].id;

  const uploadsDir = path.join(workDir, 'uploads-src');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  const goodPngPath = path.join(uploadsDir, 'evidence.png');
  fs.writeFileSync(goodPngPath, pngHeader);
  const spoofedPngPath = path.join(uploadsDir, 'spoofed.png');
  fs.writeFileSync(spoofedPngPath, Buffer.from('not actually a png'));
  const unsupportedPath = path.join(uploadsDir, 'evil.exe');
  fs.writeFileSync(unsupportedPath, Buffer.from('MZ'));

  const unsupportedExt = financeDb.createFinanceAttachment(userId, 'contract_version', p3VersionId, unsupportedPath);
  record('Attachment: unsupported extension rejected', unsupportedExt.ok === false, JSON.stringify(unsupportedExt));

  const spoofedContent = financeDb.createFinanceAttachment(userId, 'contract_version', p3VersionId, spoofedPngPath);
  record('Attachment: content that does not match its extension is rejected', spoofedContent.ok === false, JSON.stringify(spoofedContent));

  const foreignEntity = financeDb.createFinanceAttachment(userId, 'contract_version', 999999, goodPngPath);
  record('Attachment: unowned/unknown entity is rejected', foreignEntity.ok === false, JSON.stringify(foreignEntity));

  const attachRes = financeDb.createFinanceAttachment(userId, 'contract_version', p3VersionId, goodPngPath);
  record('Attachment: valid upload succeeds and copies the file', attachRes.ok === true
    && fs.existsSync(financeDb.resolveFinanceAttachment(userId, attachRes.attachment.id).absPath),
    JSON.stringify(attachRes));
  const attachmentId = attachRes.attachment.id;

  const listedAttachments = financeDb.listFinanceAttachments(userId, 'contract_version', p3VersionId);
  record('Attachment: list returns it for the owning entity', listedAttachments.some(a => a.id === attachmentId), 'count=' + listedAttachments.length);

  if (otherUserRow) {
    const stolenList = financeDb.listFinanceAttachments(otherUserRow.id, 'contract_version', p3VersionId);
    const stolenResolve = financeDb.resolveFinanceAttachment(otherUserRow.id, attachmentId);
    record('Attachment: ownership gating on list + resolve', stolenList.length === 0 && stolenResolve.ok === false,
      JSON.stringify({ stolenList, stolenResolve }));
  }

  const resolved = financeDb.resolveFinanceAttachment(userId, attachmentId);
  record('Attachment: resolve returns the file on disk', resolved.ok === true && resolved.exists === true, JSON.stringify(resolved));

  const attachDelete = financeDb.deleteFinanceAttachment(userId, attachmentId);
  const fileStillOnDiskAfterDelete = fs.existsSync(resolved.absPath);
  record('Attachment: delete removes the row but leaves the file for the undo window', attachDelete.ok === true
    && fileStillOnDiskAfterDelete && financeDb.listFinanceAttachments(userId, 'contract_version', p3VersionId).length === 0,
    JSON.stringify({ attachDelete, fileStillOnDiskAfterDelete }));

  const restoreRes = financeDb.restoreFinanceAttachment(userId, attachDelete.snapshot);
  record('Attachment: restore re-creates the row against the same file', restoreRes.ok === true
    && financeDb.listFinanceAttachments(userId, 'contract_version', p3VersionId).length === 1,
    JSON.stringify(restoreRes));

  const attachDelete2 = financeDb.deleteFinanceAttachment(userId, restoreRes.attachment.id);
  const purgeSnap = attachDelete2.snapshot;
  if (otherUserRow) {
    financeDb.purgeFinanceAttachmentFile(otherUserRow.id, purgeSnap.entityType, purgeSnap.entityId, purgeSnap.filePath);
    record('Attachment: purge is ownership-gated — a non-owning user cannot purge the file',
      fs.existsSync(resolved.absPath), 'absPath=' + resolved.absPath);
  }
  financeDb.purgeFinanceAttachmentFile(userId, purgeSnap.entityType, purgeSnap.entityId, purgeSnap.filePath);
  record('Attachment: purge removes the file once the undo window lapses with no restore',
    !fs.existsSync(resolved.absPath), 'absPath=' + resolved.absPath);

  // purgeFinanceAttachmentsForEntities: deleting the owning contract version purges
  // any remaining attachments immediately (not covered by the version's own undo).
  const attachForPurge = financeDb.createFinanceAttachment(userId, 'contract_version', p3VersionId, goodPngPath);
  const purgeAbsPath = financeDb.resolveFinanceAttachment(userId, attachForPurge.attachment.id).absPath;
  financeDb.deleteFinanceContractVersion(userId, p3VersionId);
  record('Attachment: deleting the owning contract version purges its attachments immediately',
    !fs.existsSync(purgeAbsPath) && financeDb.listFinanceAttachments(userId, 'contract_version', p3VersionId).length === 0,
    'purgeAbsPath=' + purgeAbsPath);

  // ── Phase 3: Minutes of Meeting ──────────────────────────────────────────────
  const meetingForeignContract = financeDb.createFinanceMeeting(userId, p3Client.id, { title: 'x', contractId: 999999 });
  record('Meeting: rejects a contract id that does not belong to this client', meetingForeignContract.ok === false, JSON.stringify(meetingForeignContract));

  const meetingRes = financeDb.createFinanceMeeting(userId, p3Client.id, {
    title: 'Kickoff meeting', meetingDate: '2026-08-01', location: 'HQ',
    attendees: 'Alice, Bob', agenda: 'Scope review', content: '<p>Discussed <strong>scope</strong>.</p>',
    contractId: p3ContractRes.contract.id,
  });
  record('Meeting: create resolves contract link and stores content', meetingRes.ok === true
    && meetingRes.meeting.contractId === p3ContractRes.contract.id && meetingRes.meeting.content.includes('scope'),
    JSON.stringify(meetingRes));
  const meetingId = meetingRes.meeting.id;

  const meetingNoTitle = financeDb.createFinanceMeeting(userId, p3Client.id, { title: '' });
  record('Meeting: blank title is rejected', meetingNoTitle.ok === false, JSON.stringify(meetingNoTitle));

  const listedMeetings = financeDb.listFinanceMeetings(userId, p3Client.id);
  record('Meeting: list includes the created meeting', listedMeetings.some(m => m.id === meetingId), 'count=' + listedMeetings.length);

  const meetingUpdRes = financeDb.updateFinanceMeeting(userId, meetingId, { title: 'Kickoff meeting (revised)', content: '<p>updated</p>' });
  record('Meeting: update in place', meetingUpdRes.ok === true && meetingUpdRes.meeting.title === 'Kickoff meeting (revised)', JSON.stringify(meetingUpdRes));

  if (otherUserRow) {
    const stolenMeeting = financeDb.getFinanceMeeting(otherUserRow.id, meetingId);
    record('Meeting: ownership gating on read', stolenMeeting === null, JSON.stringify(stolenMeeting));
  }

  const actionNoDesc = financeDb.createFinanceMeetingAction(userId, meetingId, { description: '' });
  record('Action item: blank description is rejected', actionNoDesc.ok === false, JSON.stringify(actionNoDesc));

  const action1 = financeDb.createFinanceMeetingAction(userId, meetingId, { description: 'Send proposal', owner: 'Alice', dueDate: '2026-08-10' });
  const action2 = financeDb.createFinanceMeetingAction(userId, meetingId, { description: 'Schedule follow-up', owner: 'Bob' });
  record('Action item: created and attached to the meeting', action1.ok && action2.ok
    && action2.meeting.actions.length === 2, JSON.stringify(action2.meeting.actions));
  const action1Id = action2.meeting.actions.find(a => a.description === 'Send proposal').id;

  const toggled = financeDb.toggleFinanceMeetingActionStatus(userId, action1Id);
  const toggledBack = financeDb.toggleFinanceMeetingActionStatus(userId, action1Id);
  record('Action item: status toggles OPEN <-> DONE', toggled.ok
    && toggled.meeting.actions.find(a => a.id === action1Id).status === 'DONE'
    && toggledBack.meeting.actions.find(a => a.id === action1Id).status === 'OPEN',
    JSON.stringify({ toggled: toggled.meeting.actions, toggledBack: toggledBack.meeting.actions }));

  const action2Id = action2.meeting.actions.find(a => a.description === 'Schedule follow-up').id;
  const actionDelete = financeDb.deleteFinanceMeetingAction(userId, action2Id);
  record('Action item: delete removes it from the meeting', actionDelete.ok === true
    && actionDelete.meeting.actions.length === 1, JSON.stringify(actionDelete));

  const meetingDelete = financeDb.deleteFinanceMeeting(userId, meetingId);
  record('Meeting: delete cascades its action items', meetingDelete.ok === true
    && meetingDelete.snapshot.actions.length === 1 && financeDb.getFinanceMeeting(userId, meetingId) === null,
    JSON.stringify(meetingDelete.snapshot));

  // ── Phase 3: deleteFinanceClient's CR/invoice/meeting refusal checks ───────────
  // A client can carry change requests, invoices, and meetings directly (all
  // three have a nullable contract_id/cr_id), so a client-delete guard that
  // only checked contractCount would let ON DELETE CASCADE silently wipe them.
  const p3bClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Cascade Guard Client') }).client;

  const p3bCr = financeDb.createFinanceChangeRequest(userId, p3bClient.id, { title: 'Standalone CR', amountMinor: 100_00 });
  const crRefusal = financeDb.deleteFinanceClient(userId, p3bClient.id);
  record('Client: delete refused while it still owns a standalone change request', crRefusal.ok === false, JSON.stringify(crRefusal));
  financeDb.deleteFinanceChangeRequest(userId, p3bCr.cr.id);

  const p3bInvoice = financeDb.createFinanceInvoice(userId, p3bClient.id, { number: 'INV-P3B-1', amountMinor: 100_00 });
  const invoiceRefusal = financeDb.deleteFinanceClient(userId, p3bClient.id);
  record('Client: delete refused while it still owns a standalone invoice', invoiceRefusal.ok === false, JSON.stringify(invoiceRefusal));
  financeDb.deleteFinanceInvoice(userId, p3bInvoice.invoice.id);

  const p3bMeeting = financeDb.createFinanceMeeting(userId, p3bClient.id, { title: 'Standalone meeting' });
  const meetingRefusal = financeDb.deleteFinanceClient(userId, p3bClient.id);
  record('Client: delete refused while it still owns a standalone meeting', meetingRefusal.ok === false, JSON.stringify(meetingRefusal));
  financeDb.deleteFinanceMeeting(userId, p3bMeeting.meeting.id);

  const p3bDeleteAllowed = financeDb.deleteFinanceClient(userId, p3bClient.id);
  record('Client: delete allowed once CRs/invoices/meetings are gone too', p3bDeleteAllowed.ok === true, JSON.stringify(p3bDeleteAllowed));

  // ── Cancelling an invoice releases its allocations (not just hides them) ────
  // finance_invoice_links has ON DELETE RESTRICT on installment_id/cr_id, so a
  // cancelled invoice that still held a link would otherwise permanently block
  // deleting the installment/contract with a raw SQLite FK error — updateFinanceInvoice
  // must actually drop the link rows on cancel, not just exclude them from sums.
  const cxClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Cancel Test Client') }).client;
  const cxContract = financeDb.createFinanceContract(userId, cxClient.id, { title: 'Cancel Test Contract', status: 'ACTIVE' }).contract;
  financeDb.createFinanceInstallment(userId, cxContract.id, { title: 'Only', amountMinor: 1_000_00 });
  const cxInstId = financeDb.getFinanceContract(userId, cxContract.id).installments[0].id;
  const cxInv = financeDb.createFinanceInvoice(userId, cxClient.id, { number: 'INV-CX-1', amountMinor: 1_000_00, status: 'ISSUED' }).invoice;
  financeDb.createFinanceInvoiceLink(userId, cxInv.id, { installmentId: cxInstId, allocatedMinor: 1_000_00 });

  const cxBlockedInstDelete = financeDb.deleteFinanceInstallment(userId, cxInstId);
  record('Installment: delete refused while allocated to a live (non-cancelled) invoice', cxBlockedInstDelete.ok === false, JSON.stringify(cxBlockedInstDelete));

  const cxBlockedContractDelete = financeDb.deleteFinanceContract(userId, cxContract.id);
  record('Contract: delete refused (friendly, not a raw FK throw) while an installment is invoiced', cxBlockedContractDelete.ok === false, JSON.stringify(cxBlockedContractDelete));

  const cxCancelRes = financeDb.updateFinanceInvoice(userId, cxInv.id, { number: 'INV-CX-1', amountMinor: 1_000_00, status: 'CANCELLED' });
  record('Invoice: cancelling clears its allocation links', cxCancelRes.ok === true && cxCancelRes.invoice.links.length === 0, JSON.stringify(cxCancelRes.invoice));

  const cxInstAfterCancel = financeDb.getFinanceContract(userId, cxContract.id).installments.find(i => i.id === cxInstId);
  record('Installment: a cancelled invoice no longer counts toward invoiced/outstanding',
    cxInstAfterCancel.invoicedMinor === 0 && cxInstAfterCancel.outstandingMinor === 1_000_00, JSON.stringify(cxInstAfterCancel));

  const cxSummary = financeDb.getFinanceClientSummary(userId, cxClient.id);
  record('Summary: a cancelled invoice is excluded from invoicedMinor', cxSummary.invoicedMinor === 0, JSON.stringify(cxSummary));

  const cxAllowedInstDelete = financeDb.deleteFinanceInstallment(userId, cxInstId);
  record('Installment: delete allowed once its only invoice was cancelled', cxAllowedInstDelete.ok === true, JSON.stringify(cxAllowedInstDelete));

  const cxAllowedContractDelete = financeDb.deleteFinanceContract(userId, cxContract.id);
  record('Contract: delete allowed once its installments are invoice-free', cxAllowedContractDelete.ok === true, JSON.stringify(cxAllowedContractDelete));

  financeDb.deleteFinanceInvoice(userId, cxInv.id);
  financeDb.deleteFinanceClient(userId, cxClient.id);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summaryClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Summary Test Client') }).client;
  financeDb.createFinanceContract(userId, summaryClient.id, { title: 'C1', status: 'ACTIVE' });
  const summary = financeDb.getFinanceClientSummary(userId, summaryClient.id);
  record('Summary: contract counts computed for a client', summary.contractCount === 1 && summary.activeContractCount === 1
    && summary.invoicedMinor === 0 && summary.outstandingMinor === 0, JSON.stringify(summary));


  // ── Cross-module feeds (Attention Center / Recent Activity) ───────────────
  // These are what put Finance on the Overview page. The filtering rules carry
  // the risk: an item that should have dropped out sits in the Attention list
  // forever, and one that should appear never does.
  const feedClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Feed Client', 'FEED') }).client;
  const feedContract = financeDb.createFinanceContract(userId, feedClient.id, {
    title: 'Feed Contract', status: 'ACTIVE', endDate: '2026-12-31',
  }).contract;

  const attentionOf = (type) => financeDb.getFinanceAttentionItems(userId).filter(a => a.type === type);

  record('Attention: an active contract with an end date is surfaced',
    attentionOf('financeContract').some(a => a.id === feedContract.id && a.date === '2026-12-31'),
    JSON.stringify(attentionOf('financeContract')));

  financeDb.updateFinanceContract(userId, feedContract.id, {
    title: 'Feed Contract', status: 'TERMINATED', endDate: '2026-12-31',
  });
  record('Attention: a TERMINATED contract drops out',
    !attentionOf('financeContract').some(a => a.id === feedContract.id));

  const noDate = financeDb.createFinanceContract(userId, feedClient.id, { title: 'No End Date', status: 'ACTIVE' }).contract;
  record('Attention: a contract with no end date is never surfaced',
    !attentionOf('financeContract').some(a => a.id === noDate.id));

  const feedInvoice = financeDb.createFinanceInvoice(userId, feedClient.id, {
    number: 'INV-FEED-1', dueDate: '2026-11-30', amountMinor: 50000, status: 'ISSUED',
  }).invoice;
  record('Attention: an unpaid issued invoice is surfaced with its due date',
    attentionOf('financeInvoice').some(a => a.id === feedInvoice.id && a.date === '2026-11-30'),
    JSON.stringify(attentionOf('financeInvoice')));

  // Both ids, deliberately: `clientId` is Finance's own row, `companyId` is the
  // client page the Overview deep-links to now that Finance renders there.
  record('Attention: rows carry both the Finance clientId and the owning companyId',
    attentionOf('financeInvoice').every(a => a.clientId === feedClient.id && a.module === 'finance'
      && a.companyId === feedClient.companyId));

  financeDb.createFinancePayment(userId, feedInvoice.id, { amountMinor: 50000, paidDate: '2026-11-01' });
  record('Attention: a fully paid invoice drops out even while its status says ISSUED',
    !attentionOf('financeInvoice').some(a => a.id === feedInvoice.id));

  const cancelled = financeDb.createFinanceInvoice(userId, feedClient.id, {
    number: 'INV-FEED-2', dueDate: '2026-11-30', amountMinor: 9900, status: 'CANCELLED',
  }).invoice;
  record('Attention: a cancelled invoice is never surfaced',
    !attentionOf('financeInvoice').some(a => a.id === cancelled.id));

  const otherUserAttention = financeDb.getFinanceAttentionItems(secondUserId);
  record('Attention: never leaks across accounts',
    !otherUserAttention.some(a => a.clientId === feedClient.id), JSON.stringify(otherUserAttention));

  const activity = financeDb.getFinanceRecentActivity(userId, 20);
  record('Activity: contracts and invoices appear with a finance module target',
    activity.some(a => a.kind === 'finance-contract' && a.id === feedContract.id)
      && activity.some(a => a.kind === 'finance-invoice' && a.id === feedInvoice.id)
      && activity.every(a => a.module === 'finance'),
    JSON.stringify(activity.slice(0, 4)));
  record('Activity: newest first and obeys its limit',
    financeDb.getFinanceRecentActivity(userId, 2).length <= 2
      && activity.every((a, i) => i === 0 || activity[i - 1].changedAt >= a.changedAt));
  record('Activity: never leaks across accounts',
    !financeDb.getFinanceRecentActivity(secondUserId, 20).some(a => a.parentId === feedClient.id));


  // ── Shared company profile (migration 056) ────────────────────────────────
  // Global, not per-user, and writable by any authenticated account — so the
  // gates that matter are: it is genuinely shared, and every write is
  // attributable, since attribution is what replaces permission here.
  const profileCompanyId = newCompany('Profile Co', 'PROFCO');
  record('Profile: a company with no profile reads back blank, not null',
    JSON.stringify(db.getCompanyProfile(profileCompanyId)) ===
      JSON.stringify({ contactName: '', contactEmail: '', contactPhone: '', address: '', taxNumber: '', notes: '', updatedAt: '' }),
    JSON.stringify(db.getCompanyProfile(profileCompanyId)));

  const savedProfile = db.saveCompanyProfile(userId, profileCompanyId, {
    contactName: 'Dana', contactEmail: 'ap@profco.test', taxNumber: '310999', address: 'Riyadh',
  });
  record('Profile: saved and read back', savedProfile.ok
    && db.getCompanyProfile(profileCompanyId).taxNumber === '310999'
    && db.getCompanyProfile(profileCompanyId).contactName === 'Dana', JSON.stringify(savedProfile));

  record('Profile: another account sees the same shared values',
    db.getCompanyProfile(profileCompanyId).taxNumber === '310999');

  const secondSave = db.saveCompanyProfile(secondUserId, profileCompanyId, {
    contactName: 'Dana', contactEmail: 'ap@profco.test', taxNumber: '310111', address: 'Riyadh',
  });
  record('Profile: a second account may edit it (no admin concept)', secondSave.ok
    && db.getCompanyProfile(profileCompanyId).taxNumber === '310111', JSON.stringify(secondSave));

  const history = db.getCompanyProfileHistory(profileCompanyId);
  record('Profile: every change is attributed to the account that made it',
    history.some(h => h.fieldName === 'Tax Number' && h.oldValue === '310999'
      && h.newValue === '310111' && !!h.changedBy),
    JSON.stringify(history.slice(0, 3)));
  record('Profile: history spans accounts rather than being user-scoped',
    new Set(history.map(h => h.changedBy)).size >= 2,
    JSON.stringify([...new Set(history.map(h => h.changedBy))]));
  // Address was set once (blank -> 'Riyadh') and passed through unchanged on the
  // second save, so exactly one row — a second would mean history records writes
  // rather than changes.
  record('Profile: an unchanged field writes no second history row',
    history.filter(h => h.fieldName === 'Address').length === 1,
    JSON.stringify(history.map(h => h.fieldName)));
  record('Profile: an unknown company is refused',
    db.saveCompanyProfile(userId, 999999, { taxNumber: 'x' }).ok === false);


  // ── Currency now comes from the shared catalog (plan §8) ──────────────────
  // No migration was involved: currency_code is a string, so the only thing
  // that had to change was which list is accepted. Validating against one
  // catalog only would silently blank a currency picked from the other.
  const curClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Currency Co') }).client;
  const sharedCurrency = (db.getLookupsByCategory('CURRENCY', false)[0] || {}).code;
  const sharedContract = financeDb.createFinanceContract(userId, curClient.id, {
    title: 'Shared currency', currencyCode: sharedCurrency,
  });
  record('Currency: a code from the app-wide CURRENCY catalog is accepted',
    !!sharedCurrency && sharedContract.ok && sharedContract.contract.currencyCode === sharedCurrency,
    JSON.stringify({ sharedCurrency, stored: sharedContract.contract?.currencyCode }));

  const ownContract = financeDb.createFinanceContract(userId, curClient.id, {
    title: 'Legacy finance currency', currencyCode: 'SAR',
  });
  record("Currency: a code from Finance's own legacy list still works",
    ownContract.ok && ownContract.contract.currencyCode === 'SAR', JSON.stringify(ownContract.contract?.currencyCode));

  const junkContract = financeDb.createFinanceContract(userId, curClient.id, {
    title: 'Junk currency', currencyCode: 'NOTACURRENCY',
  });
  record('Currency: an unknown code still resolves to unset rather than storing junk',
    junkContract.ok && junkContract.contract.currencyCode === '', JSON.stringify(junkContract.contract?.currencyCode));


  // ── Overview aggregate (plan §8) ──────────────────────────────────────────
  const ovClient = financeDb.createFinanceClient(userId, { companyId: newCompany('Overview Co') }).client;
  financeDb.createFinanceContract(userId, ovClient.id, { title: 'Live', status: 'ACTIVE' });
  const ovPaid = financeDb.createFinanceInvoice(userId, ovClient.id, {
    number: 'OV-PAID', amountMinor: 10000, dueDate: '2020-01-01', status: 'ISSUED',
  }).invoice;
  financeDb.createFinancePayment(userId, ovPaid.id, { amountMinor: 10000, paidDate: '2020-01-02' });
  financeDb.createFinanceInvoice(userId, ovClient.id, {
    number: 'OV-OVERDUE', amountMinor: 40000, dueDate: '2020-01-01', status: 'ISSUED',
  });
  financeDb.createFinanceInvoice(userId, ovClient.id, {
    number: 'OV-CANCELLED', amountMinor: 99900, dueDate: '2020-01-01', status: 'CANCELLED',
  });

  const ov = financeDb.getFinanceOverview(userId);
  record('Overview: a cancelled invoice counts toward neither invoiced nor outstanding',
    ov.invoicedMinor >= 50000 && !String(ov.invoicedMinor).includes('999'), JSON.stringify(ov));
  record('Overview: outstanding is invoiced minus paid',
    ov.outstandingMinor === Math.max(0, ov.invoicedMinor - ov.paidMinor), JSON.stringify(ov));
  // Overdue is due-date-based, not status-based: OV-PAID is past its due date
  // but settled, and OV-CANCELLED is past its due date but void — neither counts.
  record('Overview: overdue counts only past-due invoices that still owe money',
    ov.overdueInvoiceCount === 1, JSON.stringify(ov));
  record('Overview: never leaks across accounts',
    financeDb.getFinanceOverview(secondUserId).invoicedMinor === 0,
    JSON.stringify(financeDb.getFinanceOverview(secondUserId)));

} catch (err) {
  exitCode = 1;
  console.error('FATAL:', err);
} finally {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('\n── Results ──');
for (const r of results) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.flow + (r.details ? '  (' + r.details + ')' : ''));
  if (!r.pass) exitCode = 1;
}
console.log('\n' + (exitCode === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'));
process.exit(exitCode);
