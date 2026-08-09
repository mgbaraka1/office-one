'use strict';

// ── Settings catalog registry — single source of truth ──
// SETTINGS_REFACTOR_PLAN.md §1b (S1): before this file existed, the set of
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
const SETTINGS_CATALOG_TABS = [
  { key: 'companies', category: 'COMPANY', valueField: 'code', label: 'Companies', icon: 'building-2', editor: 'company', mergeable: true },
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
];
