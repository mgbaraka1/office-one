// ─────────────────────────────────────────────────────────────────────────────
// IPC request/response type definitions (JSDoc / TypeScript-style).
//
// This file is documentation-only — it contains no runtime code. It defines the
// shapes that cross the renderer ↔ main IPC boundary so editors can type-check
// `window.api.*` calls (see preload.js) and so the data contracts are written
// down in one place. Channel names use a `domain:action` convention; the
// `window.api` façade method that calls each channel is noted in preload.js.
//
// Ownership note: every data request is scoped, in the main process, to the
// authenticated user's id taken from the session (auth.requireUserId()). No
// `userId` is ever accepted from the renderer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One timesheet entry as seen by the renderer (legacy field names kept for the
 * UI). Stored normalized in `day_entries` — see db.js entryToRow/rowToEntry.
 * @typedef {Object} DayEntryRow
 * @property {number} [eid]      Stable DB entry id (absent on a not-yet-saved row).
 * @property {string} company
 * @property {string} system
 * @property {string} natural    Activity type (stored as `activity_type`).
 * @property {string} time       Time type, e.g. "Work Time" (stored as `time_type`).
 * @property {string} description
 * @property {string} source
 * @property {'Done'|'In Progress'} status
 * @property {number|''} minutes  Logged minutes, or '' when unset.
 * @property {string[]} tags
 */

/**
 * One company/system as listed on its page: the display label plus how many
 * day_entries reference it (for the current user).
 * @typedef {Object} CategoryValue
 * @property {string} name
 * @property {number} count
 */

/**
 * A day_entry as shown on the read-only Companies/Systems pages — a DayEntryRow
 * plus the date of the day it belongs to (entries span many days there).
 * @typedef {DayEntryRow & { date: string }} CategoryEntry
 */

/**
 * A day's payload. `name` is the employee name for that day.
 * @typedef {Object} DayData
 * @property {string} name
 * @property {DayEntryRow[]} rows
 */

/**
 * One day within a range query.
 * @typedef {Object} DayInRange
 * @property {string} date  YYYY-MM-DD
 * @property {string} name
 * @property {DayEntryRow[]} rows
 */

/**
 * Result of a day save — the canonical entry id for each input row, in order,
 * so the renderer can adopt ids of freshly-inserted rows.
 * @typedef {Object} SaveDayResult
 * @property {Array<number|null>} eids
 */

/**
 * @typedef {Object} Subscription
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {string} currency
 * @property {'Monthly'|'Yearly'|'Custom'} billingCycle
 * @property {string|null} endDate
 * @property {string|null} renewalDate
 */

/**
 * @typedef {Object} SubscriptionsPayload
 * @property {Subscription[]} subscriptions
 * @property {string} defaultCurrency
 */

/**
 * @typedef {Object} BacklogTask
 * @property {string} id
 * @property {string} company
 * @property {string} system
 * @property {string} natural
 * @property {string} time
 * @property {string} description
 * @property {string} source
 * @property {string[]} tags
 */

/**
 * @typedef {Object} BacklogPayload
 * @property {BacklogTask[]} backlog
 */

/**
 * One option in the normalized lookup catalog (a row of `lookup_codes`).
 * @typedef {Object} LookupOption
 * @property {number} id
 * @property {string} code      Stable uppercase identifier (e.g. 'OVERTIME').
 * @property {string} label     Human-readable display name (e.g. 'Over Time').
 * @property {number} sortOrder Dropdown ordering.
 * @property {boolean} isActive Soft-disable flag.
 */

/**
 * The full lookup catalog returned by `lookups:get`. `categories` is keyed by the
 * category discriminator (COMPANY, SYSTEM, ACTIVITY_TYPE, TIME_TYPE, ENTRY_STATUS,
 * CURRENCY, BILLING_CYCLE), each an ordered list of options (incl. inactive).
 * @typedef {Object} Lookups
 * @property {Object<string, LookupOption[]>} categories
 * @property {string} [defaultName]
 */

/**
 * Analytics rollups computed in SQL. The by-* maps are { key: minutes }.
 * @typedef {Object} AnalyticsSummary
 * @property {number} totalMin
 * @property {number} recordCount
 * @property {number} doneCount
 * @property {number} activeDays
 * @property {Object<string,number>} byCompany
 * @property {Object<string,number>} bySystem
 * @property {Object<string,number>} byNatural
 * @property {Object<string,number>} byType
 * @property {Object<string,number>} dayMin     date → total minutes
 * @property {Object<string,number>} dayOtMin   date → over-time minutes
 */

/**
 * @typedef {Object} OverviewStats
 * @property {number} todayMin
 * @property {number} todayRecs
 * @property {number} monthMin
 * @property {number} daysLogged
 */

/**
 * @typedef {Object} AuthStatus
 * @property {boolean} hasUsers       Whether an active account exists.
 * @property {boolean} authenticated  Whether this session is logged in.
 * @property {string|null} username
 */

/**
 * @typedef {Object} AuthUser
 * @property {number} id
 * @property {string} username
 */

/**
 * @typedef {Object} AuthResult
 * @property {boolean} ok
 * @property {string} [error]      Present when ok is false.
 * @property {AuthUser} [user]     Present when ok is true.
 */

/**
 * @typedef {Object} FileResult
 * @property {boolean} ok
 * @property {string} [path]
 * @property {string} [error]
 */

module.exports = {};   // documentation-only module
