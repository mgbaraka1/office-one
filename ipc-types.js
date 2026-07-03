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
 * One timesheet row (a work session) as seen by the renderer (legacy field names
 * kept for the UI). Backed by a `work_logs` row joined to its parent `tasks` row —
 * see db.js logToRow.
 * @typedef {Object} DayEntryRow
 * @property {number} [eid]      Stable work_log id (absent on a not-yet-saved row).
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
 * work sessions (work_logs, via their task) reference it (for the current user).
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

// ─────────────────────────────────────────────────────────────────────────────
// v2 two-level model: Task (date-independent) + WorkLog (its dated sessions).
// Added for the tasks:* / worklogs:* channels. The legacy DayEntryRow/BacklogTask
// shapes above stay intact — the renderer still uses them until the Phase C rework.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A standalone, date-INDEPENDENT unit of work (the `tasks` table). Category fields
 * round-trip like everywhere else: company/system/natural as display LABELs,
 * status as a stable ENTRY_STATUS code. `workLogs` is present only on `tasks:get`.
 * @typedef {Object} Task
 * @property {number} id
 * @property {string} name
 * @property {'IN_PROGRESS'|'DONE'|string} status  ENTRY_STATUS lookup code.
 * @property {string} company
 * @property {string} system
 * @property {string} natural       Activity type (label).
 * @property {string} source
 * @property {string[]} tags
 * @property {number|null} projectId Linked Project id, or null when unlinked.
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {number} logCount       Number of work logs on this task.
 * @property {number} totalMinutes   Sum of the task's logged minutes.
 * @property {string|null} firstDate Earliest work-log date (null if none).
 * @property {string|null} lastDate  Latest work-log date (null if none).
 * @property {WorkLog[]} [workLogs]  The task's ordered work logs (tasks:get only).
 */

/**
 * One dated work session on a task (the `work_logs` table). `time` is a TIME_TYPE
 * lookup code (per-session, e.g. Work Time / Over Time).
 * @typedef {Object} WorkLog
 * @property {number} id
 * @property {number} taskId
 * @property {string} date          YYYY-MM-DD.
 * @property {string} description    What was done this session.
 * @property {number|''} minutes     Duration, or '' when unset.
 * @property {string} time           TIME_TYPE lookup code ('' when unset).
 * @property {number} sortOrder
 */

/**
 * A work log flattened with its parent task's context — the `worklogs:byDate`
 * ("day view") row shape.
 * @typedef {WorkLog & {
 *   taskName: string, status: string, company: string, system: string,
 *   natural: string, projectId: number|null
 * }} WorkLogOnDate
 */

/**
 * Result of a work-log mutation (`worklogs:add|update|delete`). Carries the
 * refreshed parent task so the caller can re-render.
 * @typedef {Object} WorkLogMutationResult
 * @property {boolean} ok
 * @property {number} [id]        The new work-log id (add only).
 * @property {Task|null} [task]   The refreshed parent task on success.
 * @property {string} [error]     Failure reason (e.g. task not found).
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
 * @property {number} taskCount            Number of tasks linked to the project.
 */

/**
 * A project in full — profile + its linked TASKS + document statuses (`projects:get`).
 * As of Phase C4 `tasks` is a flat `Task[]`, each Task carrying its nested
 * `workLogs`; zero-log tasks (Not-Yet items linked to the project) are included.
 * The old {entries, backlog} tasks shape was retired.
 * @typedef {Object} Project
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {ProjectCompany[]} companies  Linked client companies (COMPANY lookups).
 * @property {ProjectSystem[]} systems     Linked systems (SYSTEM lookups, many-to-many).
 * @property {string} status               A PROJECT_STATUS lookup code (e.g. 'ACTIVE').
 * @property {string} createdAt
 * @property {Task[]} tasks                Linked tasks, each with nested `workLogs`.
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
 * `projects:linkable-tasks` returns a flat `Task[]` — every task not linked to any
 * project (with-sessions and zero-log alike), each with its rollups. (The old
 * {entries, backlog} LinkableTasks shape was retired in Phase C4.)
 */

/**
 * Metadata for a Company Document's uploaded file (bytes live on disk under
 * userData; only this metadata is in SQLite). null when no file has been
 * uploaded. Shape mirrors ProjectDocumentFile.
 * @typedef {Object} CompanyDocumentFile
 * @property {string} path         Path RELATIVE to userData (e.g. 'company_documents/12/1719750000000.pdf').
 * @property {string} originalName The user's original filename, for display/download.
 * @property {number} size         File size in bytes.
 * @property {string} mimeType     MIME type resolved from the extension.
 * @property {string} uploadedAt   ISO timestamp of the upload.
 * @property {boolean} exists      Whether the file is actually present on disk right now.
 */

/**
 * A Company Document card (`companydocs:*`). Unlike ProjectDocument (a fixed
 * catalog slot per project), each row IS the user-created entity — deleting it
 * deletes the card, not just its file.
 * @typedef {Object} CompanyDocument
 * @property {number} id
 * @property {string} name         User-entered title (e.g. 'VAT Certificate').
 * @property {string} category     A COMPANY_DOCUMENT_CATEGORY lookup code, or '' if unset.
 * @property {string} renewalDate  YYYY-MM-DD, or '' if not tracked.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {CompanyDocumentFile|null} file  Uploaded-file metadata, or null when none.
 */

/**
 * Write shape for `companydocs:create` / `companydocs:update`.
 * @typedef {Object} CompanyDocumentInput
 * @property {string} name
 * @property {string} [category]     A COMPANY_DOCUMENT_CATEGORY lookup code; unknown/empty → unset.
 * @property {string} [renewalDate]  YYYY-MM-DD, or omitted/empty to clear.
 * @property {string} [notes]
 */

/**
 * Result of a Company Document file mutation (upload / replace / remove / restore).
 * @typedef {Object} CompanyDocFileResult
 * @property {boolean} ok
 * @property {CompanyDocument} [document]  The refreshed card on success.
 * @property {string} [error]              Failure reason (e.g. unsupported type).
 * @property {boolean} [canceled]          True when the user dismissed the file dialog.
 */

/**
 * One VPN connection recorded against a client (`clients:vpn-*`).
 * @typedef {Object} ClientVpnConnection
 * @property {number} id
 * @property {number} companyId      The COMPANY lookup_codes id this belongs to.
 * @property {string} connectionName
 * @property {string} vpnType        Free text (e.g. 'WireGuard', 'IPSec') — not lookup-driven.
 * @property {string} endpoint       Free text host/IP.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One server recorded against a client (`clients:server-*`).
 * @typedef {Object} ClientServer
 * @property {number} id
 * @property {number} companyId  The COMPANY lookup_codes id this belongs to.
 * @property {string} serverName
 * @property {string} host       Free text IP/hostname.
 * @property {string} environment 'PRODUCTION' | 'TEST' (hardcoded, not lookup-driven).
 * @property {string} os         Free text (e.g. 'Ubuntu 22.04').
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One client on the Clients list page — a COMPANY lookup row + its record
 * counts. There is no standalone clients table; the roster IS the active
 * COMPANY lookup catalog.
 * @typedef {Object} ClientListItem
 * @property {number} id          The COMPANY lookup_codes id.
 * @property {string} label
 * @property {number} vpnCount
 * @property {number} serverCount
 */

/**
 * A client in full (`clients:get`): its label + ordered VPN connections and servers.
 * @typedef {Object} Client
 * @property {number} id     The COMPANY lookup_codes id.
 * @property {string} label
 * @property {ClientVpnConnection[]} vpnConnections
 * @property {ClientServer[]} servers
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
