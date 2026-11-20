'use strict';

// ── Workflows — every lifecycle rule in the app, written down once ──
//
// Some records move through statuses, and what you may do to one depends on
// where it is. Before this file those rules lived as scattered
// `status === 'DRAFT'` checks: once in db.js (which refuses the move) and again
// in the renderer (which decides which buttons to show), with nothing keeping
// the two in step. Now both read this table, so a rule changes in one place
// and the UI can never offer a move the data layer refuses.
//
// This is the ONE renderer file that also runs in the main process. It is a
// classic script like the rest of renderer/ (index.html loads it before
// core.js, so `WORKFLOWS` is a page global), and db.js `require`s it — hence
// the guarded `module.exports` at the bottom. Keep it pure data plus tiny pure
// helpers: no DOM, no Node, no i18n, no imports.
//
// test/workflows-smoke.js keeps this honest: it checks the statuses against
// the database CHECK constraint and fails if a raw status comparison for one
// of these machines creeps back into db.js or the renderer.
//
// Not here, on purpose (they are not state machines — see ARCHITECTURE.md §4.4):
//   * Task status (ENTRY_STATUS) and project status (PROJECT_STATUS): editable
//     catalogs where any value may follow any other.
//   * Renewal "expired / soon / ok" on subscriptions and documents: worked out
//     from a date each time, never stored.
//   * Active/inactive flags and soft delete (`deleted_at` = the undo window).

const WORKFLOWS = (() => {
  const freeze = o => {
    Object.values(o).forEach(v => { if (v && typeof v === 'object') freeze(v); });
    return Object.freeze(o);
  };

  // Outsource statement (migration 066). One per resource per period.
  //
  //   DRAFT ──issue──▶ ISSUED ──markPaid──▶ PAID
  //     │                │  ◀──markUnpaid──┘
  //     └────cancel──────┴──▶ CANCELLED
  //
  // A draft is a live preview; issuing snapshots the lines and locks the
  // entries; cancelling frees them. A paid statement must be marked unpaid
  // before it can be cancelled, so recorded money is never silently undone.
  const OUTS_STATEMENT = {
    initial: 'DRAFT',
    states: ['DRAFT', 'ISSUED', 'PAID', 'CANCELLED'],
    transitions: {
      issue:      { from: ['DRAFT'],           to: 'ISSUED' },
      markPaid:   { from: ['ISSUED'],          to: 'PAID' },
      markUnpaid: { from: ['PAID'],            to: 'ISSUED' },
      cancel:     { from: ['DRAFT', 'ISSUED'], to: 'CANCELLED' },
    },
    // What a status allows besides moving. Read with `can()`, like a move.
    rules: {
      editPeriod:  ['DRAFT'],              // the period is fixed once issued
      delete:      ['DRAFT', 'CANCELLED'], // never one that billed anything
      livePreview: ['DRAFT'],              // totals come from today's entries and rates
      showEntries: ['DRAFT', 'ISSUED', 'PAID'], // cancelled keeps only its line snapshot
      billed:      ['ISSUED', 'PAID'],     // its entries are locked; blocks deleting the resource
      unpaid:      ['ISSUED'],             // counts towards what is owed
    },
  };

  // Offer / CR (Project & Finance, migrations 062 + 074). The ORDER of the
  // stages is the PFM_STATUS catalog's sort_order, which Settings can change,
  // so it is not written here — only the codes the rules hinge on. A new item
  // starts at the catalog's first stage:
  //
  //   Prepare → Ready → Sent → Accepted → UAT → Production → Invoiced → Paid
  //                       └──▶ Rejected
  //
  // `decision` and every stage after it count as decided (Rejected sorts last,
  // so it is decided too). Rejected is only reachable while undecided, and a
  // rejected item records no delivery stage until moved back to Sent.
  const PFM_ITEM = {
    decision: 'ACCEPTED',
    rejected: 'REJECTED',
    final: ['PAID', 'REJECTED'],
  };

  // Knowledge Hub item. Not enforced by db.js — the editor may set any of the
  // three directly — but these are the one-click moves the item menu offers.
  const KNOWLEDGE_ITEM = {
    initial: 'DRAFT', // what db.js stores when no valid status is given
    states: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
    transitions: {
      markReady: { from: ['DRAFT'],              to: 'PUBLISHED' },
      archive:   { from: ['DRAFT', 'PUBLISHED'], to: 'ARCHIVED' },
      restore:   { from: ['ARCHIVED'],           to: 'PUBLISHED' },
    },
    rules: {
      hidden: ['ARCHIVED'], // left out of lists, counts and maps unless asked for
    },
  };

  // May a record at `status` take `action` (a transition or a rule)?
  // An unknown action is a programming error, so it throws instead of quietly
  // answering "no" and hiding a button forever.
  function can(machine, status, action) {
    const list = machine.transitions?.[action]?.from ?? machine.rules?.[action];
    if (!list) throw new Error(`Unknown workflow action: ${action}`);
    return list.includes(status);
  }
  // The status a transition lands on.
  function target(machine, action) {
    const t = machine.transitions?.[action];
    if (!t) throw new Error(`Unknown workflow transition: ${action}`);
    return t.to;
  }
  // Statuses allowed by `action`, as a SQL list — `('ISSUED', 'PAID')`. The
  // values are the constants above, never user input, so inlining is safe.
  function sqlList(machine, action) {
    const list = machine.transitions?.[action]?.from ?? machine.rules?.[action];
    if (!list) throw new Error(`Unknown workflow action: ${action}`);
    return `(${list.map(s => `'${s}'`).join(', ')})`;
  }

  return freeze({ OUTS_STATEMENT, PFM_ITEM, KNOWLEDGE_ITEM, can, target, sqlList });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WORKFLOWS;
