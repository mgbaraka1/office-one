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
 * @property {number|null} [projectId]  Linked Project id, or null when unlinked.
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
 * @property {number|null} [projectId]  Linked Project id, or null when unlinked.
 */

/**
 * @typedef {Object} BacklogPayload
 * @property {BacklogTask[]} backlog
 */

/**
 * A timesheet entry linked to a project — a DayEntryRow plus its day's date and a
 * `kind` discriminator. (Backlog tasks linked to a project use BacklogTask + kind.)
 * @typedef {DayEntryRow & { kind: 'entry', date: string }} ProjectEntryTask
 */

/**
 * Metadata for a document's uploaded file (the bytes live on disk under userData;
 * only this metadata is in SQLite). null when no file has been uploaded.
 * @typedef {Object} ProjectDocumentFile
 * @property {string} path         Path RELATIVE to userData (e.g. 'projects/12/documents/INVOICE-1719750000000.pdf').
 * @property {string} originalName The user's original filename, for display/download.
 * @property {number} size         File size in bytes.
 * @property {string} mimeType     MIME type resolved from the extension.
 * @property {string} uploadedAt   ISO timestamp of the upload.
 * @property {boolean} exists      Whether the file is actually present on disk right now.
 */

/**
 * One of a project's tracked documents, derived from the PROJECT_DOCUMENT lookup
 * category (configurable in Settings → Project Documents).
 * @typedef {Object} ProjectDocument
 * @property {string} documentType  The stable PROJECT_DOCUMENT lookup code (used to persist).
 * @property {string} label         The document's display label.
 * @property {boolean} isAvailable  True iff a file has been uploaded for this slot.
 * @property {ProjectDocumentFile|null} file  Uploaded-file metadata, or null when none.
 */

/**
 * Result of a document file mutation (upload / replace / remove / restore).
 * @typedef {Object} DocFileResult
 * @property {boolean} ok
 * @property {Project} [project]   The refreshed project on success.
 * @property {string} [error]      Failure reason (e.g. unsupported type).
 * @property {boolean} [canceled]  True when the user dismissed the file dialog.
 */

/**
 * A company linked to a project — one COMPANY lookup row.
 * @typedef {Object} ProjectCompany
 * @property {number} id      The COMPANY lookup_codes id.
 * @property {string} label   The company's display label.
 */

/**
 * A system linked to a project — one SYSTEM lookup row (via project_systems).
 * @typedef {Object} ProjectSystem
 * @property {number} id      The SYSTEM lookup_codes id.
 * @property {string} label   The system's display label.
 */

/**
 * A project as listed on the Projects page (profile + a linked-task count).
 * @typedef {Object} ProjectListItem
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {ProjectCompany[]} companies  Linked client companies (COMPANY lookups).
 * @property {ProjectSystem[]} systems     Linked systems (SYSTEM lookups, many-to-many).
 * @property {string} status               A PROJECT_STATUS lookup code (e.g. 'ACTIVE').
 * @property {string} createdAt
 * @property {number} taskCount            Linked timesheet entries + backlog tasks.
 */

/**
 * A project in full — profile + linked tasks + document statuses (`projects:get`).
 * @typedef {Object} Project
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {ProjectCompany[]} companies  Linked client companies (COMPANY lookups).
 * @property {ProjectSystem[]} systems     Linked systems (SYSTEM lookups, many-to-many).
 * @property {string} status               A PROJECT_STATUS lookup code (e.g. 'ACTIVE').
 * @property {string} createdAt
 * @property {{ entries: ProjectEntryTask[], backlog: Array<BacklogTask & {kind:'backlog'}> }} tasks
 * @property {ProjectDocument[]} documents
 */

/**
 * Write shape for `projects:create` / `projects:update`.
 * @typedef {Object} ProjectInput
 * @property {string} name
 * @property {string} description
 * @property {number[]} companyIds   COMPANY lookup ids to link (replaces existing).
 * @property {number[]} systemIds    SYSTEM lookup ids to link (replaces existing).
 * @property {string} status         A PROJECT_STATUS lookup code.
 */

/**
 * Unlinked tasks available to attach to a project (`projects:linkable-tasks`).
 * @typedef {Object} LinkableTasks
 * @property {ProjectEntryTask[]} entries
 * @property {Array<BacklogTask & {kind:'backlog'}>} backlog
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

/**
 * Result of zipping the project files tree (projects:backup).
 * @typedef {Object} ProjectsBackupResult
 * @property {boolean} ok
 * @property {string} [path]        Saved .zip path on success.
 * @property {number} [fileCount]   Number of files archived (0 = nothing to back up yet).
 * @property {number} [byteCount]   Total uncompressed bytes archived.
 * @property {string} [error]       Failure reason (cancel returns { ok:false } with no error).
 */

module.exports = {};   // documentation-only module
