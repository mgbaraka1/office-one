'use strict';

// ── Settings catalog registry — single source of truth ──
// Before this registry existed, the set of
// catalog tabs was hand-maintained independently in FIVE places (db.js's
// LOOKUP_CATEGORIES, core.js's LK_CAT/LK_VALUE/SETTINGS_TABS, index.html's
// tab buttons + panels, and shell.js's PAL_SETTINGS_TABS) and had already
// drifted: CURRENCY/BILLING_CYCLE had no editor at all, and the command
// palette could not reach the Maintenance tab. This file collapses the
// renderer-side lists (LK_CAT, LK_VALUE, SETTINGS_TABS, the merge-eligible
// set, and the palette's catalog entries) into one array so they cannot
// drift from each other again. It cannot see db.js from this process, so
// test/settings-registry-smoke.js is the CI guard that keeps this array in
// sync with db.js's LOOKUP_CATEGORIES/LOOKUP_MERGE_TARGETS, and with the
// hand-authored tab buttons/panels in index.html.
//
// `mergeable: true` mirrors db.js's LOOKUP_MERGE_TARGETS — only categories
// migration 003 could have seeded with genuine free-text duplicates.
//
// `settingsTab: false` means "this category has no Settings panel — it is
// managed elsewhere". The entry still has to exist here: LK_CAT/LK_VALUE map
// the ui key to its category for every populateSelect() call in the app, and
// LOOKUP_MERGE_CATEGORIES derives the Maintenance duplicate-merge list from
// this same array. Only SETTINGS_TABS and the command palette filter it out.
const SETTINGS_CATALOG_TABS = [
  // Clients are created, renamed, archived and reordered on the Clients page —
  // the roster IS this catalog, so it is managed where clients live rather than
  // in a second editor here. Duplicate merging still runs from Maintenance.
  { key: 'companies', category: 'COMPANY', valueField: 'code', label: 'Companies', icon: 'building-2', editor: 'external', settingsTab: false, mergeable: true },
  { key: 'systems', category: 'SYSTEM', valueField: 'label', label: 'Systems', icon: 'folder', editor: 'lookup', mergeable: true },
  { key: 'natural', category: 'ACTIVITY_TYPE', valueField: 'label', label: 'Natural', icon: 'tag', editor: 'lookup', mergeable: true },
  { key: 'timeType', category: 'TIME_TYPE', valueField: 'code', label: 'Time Type', icon: 'alarm-clock', editor: 'lookup' },
  { key: 'status', category: 'ENTRY_STATUS', valueField: 'code', label: 'Status', icon: 'flag', editor: 'lookup' },
  { key: 'currency', category: 'CURRENCY', valueField: 'code', label: 'Currency', icon: 'credit-card', editor: 'lookup' },
  { key: 'billingCycle', category: 'BILLING_CYCLE', valueField: 'code', label: 'Billing Cycle', icon: 'calendar-clock', editor: 'lookup' },
  { key: 'projectStatus', category: 'PROJECT_STATUS', valueField: 'code', label: 'Project Status', icon: 'clipboard-list', editor: 'lookup' },
  { key: 'projectDocument', category: 'PROJECT_DOCUMENT', valueField: 'code', label: 'Project Documents', icon: 'file-text', editor: 'lookup' },
  { key: 'companyDocCategory', category: 'COMPANY_DOCUMENT_CATEGORY', valueField: 'code', label: 'Company Doc Categories', icon: 'calendar-check', editor: 'lookup' },
  { key: 'knowledgeType', category: 'KNOWLEDGE_TYPE', valueField: 'code', label: 'Knowledge Types', icon: 'book-open', editor: 'lookup' },
  { key: 'department', category: 'DEPARTMENT', valueField: 'label', label: 'Department', icon: 'building', editor: 'lookup' },
  { key: 'taskSourceType', category: 'TASK_SOURCE_TYPE', valueField: 'code', label: 'Task Source Types', icon: 'external-link', editor: 'lookup' },
  { key: 'serverRole', category: 'SERVER_ROLE', valueField: 'code', label: 'Server Roles', icon: 'server', editor: 'lookup' },

  // Finance's statuses and payment methods. Migration 060 folded them out of
  // Finance's own catalog table into lookup_codes, so they are ordinary catalog
  // categories now — but they keep their dedicated editor in Settings → Finance
  // rather than gaining four more shared tabs, which is what settingsTab: false
  // means here (the same shape COMPANY uses for the Clients page).
  { key: 'contractStatus', category: 'CONTRACT_STATUS', valueField: 'code', label: 'Contract Status', icon: 'file-text', editor: 'external', settingsTab: false },
  { key: 'crStatus', category: 'CR_STATUS', valueField: 'code', label: 'Change Request Status', icon: 'clipboard-list', editor: 'external', settingsTab: false },
  { key: 'invoiceStatus', category: 'INVOICE_STATUS', valueField: 'code', label: 'Invoice Status', icon: 'credit-card', editor: 'external', settingsTab: false },
  { key: 'paymentMethod', category: 'PAYMENT_METHOD', valueField: 'code', label: 'Payment Method', icon: 'credit-card', editor: 'external', settingsTab: false },
];
