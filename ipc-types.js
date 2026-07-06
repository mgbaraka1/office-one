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
 * see db.js dayEntryRowToApi.
 * @typedef {Object} DayEntryRow
 * @property {number} [eid]      Stable work_log id (absent on a not-yet-saved row).
 * @property {string} company
 * @property {string} system
 * @property {string} natural    Activity type (stored as `activity_type`).
 * @property {string} time       Time type, e.g. "Work Time" (stored as `time_type`).
 * @property {string} description
 * @property {string} source        Legacy free-text source (kept for backward compat; superseded by the structured Task Sources fields below for any task edited since migration 033).
 * @property {'Done'|'In Progress'} status
 * @property {number|''} minutes  Logged minutes, or '' when unset.
 * @property {number|null} [projectId]  Linked Project id, or null when unlinked.
 * @property {number} sourceCount      Number of structured task_sources entries on this row's task (migration 033).
 * @property {string} firstSourceRef   The first (by sort_order) entry's ref, or '' if sourceCount is 0.
 * @property {string} firstSourceUrl   The first entry's url, or ''.
 * @property {string} firstSourceType  The first entry's TASK_SOURCE_TYPE code, or ''.
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
 * One day within a range query.
 * @typedef {Object} DayInRange
 * @property {string} date  YYYY-MM-DD
 * @property {string} name
 * @property {DayEntryRow[]} rows
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

// ─────────────────────────────────────────────────────────────────────────────
// Two-level model: Task (date-independent) + WorkLog (its dated sessions) — the
// current primary shape for the tasks:* / worklogs:* channels. DayEntryRow above
// stays intact too: it's still the row shape for the read-only Companies/Systems
// pages and days:range, just backed by a work_logs+tasks join now (see db.js
// dayEntryRowToApi) rather than the old day_entries table.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A standalone, date-INDEPENDENT unit of work (the `tasks` table). Category fields
 * round-trip like everywhere else: company/system as display LABELs, status as a
 * stable ENTRY_STATUS code. `workLogs` is present only on `tasks:get`. Activity
 * type ("Natural") lives on each `WorkLog`, not here — the same task can span a
 * meeting session, a task session, a ticket session, etc.
 * @typedef {Object} Task
 * @property {number} id
 * @property {string} name
 * @property {'IN_PROGRESS'|'DONE'|string} status  ENTRY_STATUS lookup code.
 * @property {string} company
 * @property {string} system
 * @property {string} department    DEPARTMENT lookup label, or '' when unset (Internal Tasks).
 * @property {string} source        Legacy free-text source column — kept for backward compat, no longer written to by the UI (superseded by the structured `sources` list below, migration 033). A task edited before migration 033 that was never re-saved may still have a non-empty value here with an empty `sources` list.
 * @property {number|null} projectId Linked Project id, or null when unlinked.
 * @property {number|null} departmentId Linked DEPARTMENT lookup id, or null when unlinked.
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {number} logCount       Number of work logs on this task.
 * @property {number} totalMinutes   Sum of the task's logged minutes.
 * @property {string|null} firstDate Earliest work-log date (null if none).
 * @property {string|null} lastDate  Latest work-log date (null if none).
 * @property {WorkLog[]} [workLogs]  The task's ordered work logs (tasks:get and tasks:list only — absent from tasks:index, Milestone 7's lightweight payload for the palette/pickers/All Tasks, none of which read sessions).
 * @property {number} sourceCount       Number of structured task_sources entries (migration 033) — present on every Task shape (tasks:get/list/index all compute it cheaply via a correlated subquery).
 * @property {string} [firstSourceRef]  The first entry's ref — present on tasks:list/tasks:index rows only (tasks:get instead carries the full `sources` array below).
 * @property {string} [firstSourceUrl]  The first entry's url — same availability as firstSourceRef.
 * @property {string} [firstSourceType] The first entry's TASK_SOURCE_TYPE code — same availability as firstSourceRef.
 * @property {TaskSource[]} [sources]   The task's full ordered list of source entries — tasks:get only.
 */

/**
 * One structured source entry on a task (the `task_sources` table, migration
 * 033) — a task can carry any number, e.g. several Jira tickets and several
 * email threads. `type` round-trips as its TASK_SOURCE_TYPE lookup CODE (the
 * renderer branches on it to pick which fields to show/edit — the same
 * "logic field" convention `time`/`status` already follow), not its label.
 * @typedef {Object} TaskSource
 * @property {number} id
 * @property {number} taskId
 * @property {string} type   TASK_SOURCE_TYPE lookup code (JIRA/EMAIL/TEAMS_CHAT/MEETING/PHONE_CALL/OTHER), or '' when unset.
 * @property {string} ref    The type's primary identifying value (ticket key / email subject / channel-or-person / meeting title / caller name / free text for Other).
 * @property {string} url    Optional link (Jira URL, Teams message link). '' when unset.
 * @property {Object} meta   Optional per-type extras (e.g. {sender, date} for Email), parsed from JSON. {} when unset.
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One dated work session on a task (the `work_logs` table). `time` is a TIME_TYPE
 * lookup code (per-session, e.g. Work Time / Over Time); `natural` is the
 * ACTIVITY_TYPE lookup label (per-session — the same task's sessions can differ).
 * @typedef {Object} WorkLog
 * @property {number} id
 * @property {number} taskId
 * @property {string} date          YYYY-MM-DD.
 * @property {string} description    What was done this session.
 * @property {number|''} minutes     Duration, or '' when unset.
 * @property {string} time           TIME_TYPE lookup code ('' when unset).
 * @property {string} natural        ACTIVITY_TYPE lookup label ('' when unset).
 * @property {number} sortOrder
 */

/**
 * A work log flattened with its parent task's context — the `worklogs:byDate`
 * ("day view") row shape.
 * @typedef {WorkLog & {
 *   taskName: string, status: string, company: string, system: string,
 *   projectId: number|null
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
 * Result of `worklogs:move` (reassigning a work log to a different task).
 * Carries both ends of the move so the caller can refresh whichever it's
 * showing (the task the session left, and the one it landed on).
 * @typedef {Object} WorkLogMoveResult
 * @property {boolean} ok
 * @property {Task|null} [fromTask]  The refreshed source task (may now have one fewer session).
 * @property {Task|null} [toTask]    The refreshed target task (may now have one more session).
 * @property {string} [error]        Failure reason (e.g. task not found).
 */

/**
 * Result of `tasks:merge` (absorbing one task's sessions into another, then
 * deleting the now-empty source). The target task's own fields are never
 * touched. `movedWorkLogIds` lets the caller's undo move those exact work_logs
 * back onto a recreated source task (via worklogs:move) instead of recreating
 * the rows and losing their edit history.
 * @typedef {Object} TaskMergeResult
 * @property {boolean} ok
 * @property {number[]} [movedWorkLogIds]  Ids of the work_logs moved onto the target.
 * @property {Task|null} [task]            The refreshed target task.
 * @property {string} [error]               Failure reason (e.g. task not found, self-merge).
 */

/**
 * One edit recorded against a work_logs row (worklogs:history →
 * db.getWorkLogHistory), newest first. Mirrors ClientFieldHistoryEntry's shape;
 * see work_log_history in CLAUDE.md — date/description/minutes/time/natural
 * fields, FK fields (time/natural) diffed by lookup code, not raw id.
 * @typedef {Object} WorkLogHistoryEntry
 * @property {number} id
 * @property {string} fieldName  Human label (e.g. 'Date', 'Minutes', 'Natural').
 * @property {string} oldValue
 * @property {string} newValue
 * @property {string} changedAt
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
 * @property {string} category             A PROJECT_CATEGORY lookup code ('NEW_PROJECT'|'CR_EXISTING'|'ANNUAL_SUPPORT').
 * @property {number|null} relatedProjectId    Set only for CR_EXISTING/ANNUAL_SUPPORT — the project this one relates to.
 * @property {string|null} relatedProjectName  Display name of relatedProjectId, resolved server-side.
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
 * @property {string} category             A PROJECT_CATEGORY lookup code ('NEW_PROJECT'|'CR_EXISTING'|'ANNUAL_SUPPORT').
 * @property {number|null} relatedProjectId    Set only for CR_EXISTING/ANNUAL_SUPPORT — the project this one relates to.
 * @property {string|null} relatedProjectName  Display name of relatedProjectId, resolved server-side.
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
 * @property {string} category         A PROJECT_CATEGORY lookup code — required.
 * @property {number|null} relatedProjectId  Optional; only meaningful for CR_EXISTING/ANNUAL_SUPPORT.
 */

/**
 * A department as listed on the Internal Tasks page (`departments:list`). There is
 * no departments table — this is a DEPARTMENT lookup row + a linked-task count.
 * Every active department is listed regardless of activity (same convention as
 * `clients:list`'s COMPANY rows).
 * @typedef {Object} DepartmentListItem
 * @property {number} id     The DEPARTMENT lookup_codes id (what tasks.department_id points at).
 * @property {string} code   Stable uppercase lookup code (e.g. 'HR').
 * @property {string} label  Display label (e.g. 'HR').
 * @property {number} taskCount Number of tasks linked to this department.
 */

/**
 * One department in full — its lookup identity + its linked TASKS, each with
 * nested `workLogs` (`departments:get`). Mirrors `Project`'s tasks shape, minus
 * the profile/documents fields Projects has and Departments don't.
 * @typedef {Object} Department
 * @property {number} id
 * @property {string} code
 * @property {string} label
 * @property {Task[]} tasks Linked tasks, each with nested `workLogs`.
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
 * One Auth connection recorded against a client (`clients:vpn-*`) — despite the
 * channel/field names (kept for backward compatibility), the UI labels this
 * section "Auth" and it holds VPN, PAM, and similar login records; `vpnType`
 * is free text distinguishing them (e.g. 'VPN', 'PAM', 'WireGuard').
 * @typedef {Object} ClientVpnConnection
 * @property {number} id
 * @property {number} companyId      The COMPANY lookup_codes id this belongs to.
 * @property {string} connectionName
 * @property {string} vpnType        Free text (e.g. 'VPN', 'PAM', 'WireGuard', 'IPSec') — not lookup-driven.
 * @property {string} endpoint       Free text host/URL.
 * @property {string} port           Free text port number, since migration 018.
 * @property {string} username       Since migration 018. Stored in plain text (no encryption layer in this app).
 * @property {string} password       Since migration 018. Stored in plain text (no encryption layer in this app).
 * @property {string} expiryDate         Since migration 026 — YYYY-MM-DD or '' (unset). Display only, no reminders.
 * @property {string} credentialLocation  Since migration 026 — free text reference to where the real secret is managed (e.g. a password manager entry), for records where this table's own password field isn't the source of truth.
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
 * @property {string} hostname   Free text — a separate hostname distinct from `host` (the IP). Since migration 022.
 * @property {string} username   Since migration 022. Stored in plain text (no encryption layer in this app).
 * @property {string} password   Since migration 022. Stored in plain text (no encryption layer in this app).
 * @property {string} systemName Free text (e.g. 'RabbitMQ'), since migration 023 — groups with a ClientInternalSystem sharing the same systemName + environment on the Clients "Systems" grouped view.
 * @property {string} role                Since migration 026 — free text purpose/role (e.g. 'Web/App server', 'DB host', 'Load Balancer').
 * @property {string} port                Since migration 026 — free text (e.g. SSH/RDP port); distinct from a database's port.
 * @property {string} credentialLocation  Since migration 026 — free text reference to where the real login is managed, for records where this table's own password field isn't the source of truth.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One database recorded against a client (`clients:database-*`, migration 019).
 * @typedef {Object} ClientDatabase
 * @property {number} id
 * @property {number} companyId  The COMPANY lookup_codes id this belongs to.
 * @property {string} name
 * @property {string} engine     Free text (e.g. 'PostgreSQL', 'SQL Server') — not lookup-driven.
 * @property {string} host       Free text host/IP.
 * @property {string} port       Free text port number.
 * @property {string} username   Stored in plain text (no encryption layer in this app).
 * @property {string} password   Stored in plain text (no encryption layer in this app).
 * @property {string} version             Since migration 026 — free text engine version (e.g. 'PostgreSQL 15').
 * @property {string} credentialLocation  Since migration 026 — free text reference to where the real login is managed, for records where this table's own password field isn't the source of truth.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One third-party API integration recorded against a client
 * (`clients:external-*`, migration 020) — e.g. a government/partner API.
 * @typedef {Object} ClientExternalService
 * @property {number} id
 * @property {number} companyId   The COMPANY lookup_codes id this belongs to.
 * @property {string} name
 * @property {string} url         Free text, often includes a query-string API key.
 * @property {string} companyCode Free text — the integration's own company/client code (not our COMPANY lookup id).
 * @property {string} secretKey   Stored in plain text (no encryption layer in this app).
 * @property {string} expiryDate Since migration 026 — YYYY-MM-DD or '' (unset), e.g. an API key/contract renewal date. Display only, no reminders.
 * @property {string} contact     Since migration 026 — free text support contact for this integration.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One internal web tool/portal recorded against a client
 * (`clients:internal-*`, migration 021) — e.g. an internal RabbitMQ console.
 * A plain name/url/username/password login, plus (since migration 024) an
 * optional companyCode/secretKey pair for records that are really a
 * third-party API integration (the ClientExternalService shape) grouped
 * alongside servers/portals instead.
 * @typedef {Object} ClientInternalSystem
 * @property {number} id
 * @property {number} companyId  The COMPANY lookup_codes id this belongs to.
 * @property {string} name
 * @property {string} url        Free text.
 * @property {string} username   Stored in plain text (no encryption layer in this app).
 * @property {string} password   Stored in plain text (no encryption layer in this app).
 * @property {string} systemName Free text (e.g. 'RabbitMQ'), since migration 023 — groups with a ClientServer sharing the same systemName + environment.
 * @property {string} environment 'PRODUCTION' | 'TEST' | '' (unset), since migration 023 — same hardcoded codes as ClientServer.environment.
 * @property {string} companyCode Since migration 024 — a third-party integration's own client/company code, unrelated to the app's COMPANY lookup.
 * @property {string} secretKey   Since migration 024 — stored in plain text (no encryption layer in this app).
 * @property {string} expiryDate Since migration 026 — YYYY-MM-DD or '' (unset), e.g. a credential/contract expiry. Display only, no reminders.
 * @property {string} role       Since migration 026 — free text purpose/description of this system.
 * @property {{label: string, url: string}[]} subServices Since migration 025 — structured sibling endpoints of one logical service (e.g. a government API's Bookings/Reports/Admin* endpoints sharing this record's companyCode/secretKey). Empty array when unused.
 * @property {string} notes
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One audit-history row for an edit to an existing Clients-page record
 * (`clients:field-history`, migration 027). Written only on UPDATE (never
 * create/delete) to one of the five client_* tables, one row per field that
 * actually changed. `oldValue`/`newValue` are '(hidden)' for the password/
 * secretKey fields — the change is still recorded, but the real credential
 * text is not duplicated into a permanent, potentially-backed-up table.
 * @typedef {Object} ClientFieldHistoryEntry
 * @property {number} id
 * @property {string} fieldName  Human label (e.g. 'Password', 'Host (IP)'), not the raw column name.
 * @property {string} oldValue
 * @property {string} newValue
 * @property {string} changedAt
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
 * @property {number} databaseCount
 * @property {number} externalServiceCount
 * @property {number} internalSystemCount
 * @property {ClientSearchRecord[]} records  One entry per auth/server/database/external/
 *   internal record this client owns — human-identifying fields only, never password/
 *   secretKey. Powers the list view's records search (flattened into a results table
 *   across all clients) — see `groupClientRows()` in db.js.
 */

/**
 * One searchable record within a {@link ClientListItem}, surfaced as a row in the
 * Clients list view's records-search results table.
 * @typedef {Object} ClientSearchRecord
 * @property {number} id         The underlying row's id in its own client_* table (scoped by `type`)
 *   — looked back up via `clients:get` to show the record-info popup with every field.
 * @property {'auth'|'servers'|'databases'|'external'|'internal'} type
 * @property {string} typeLabel  Human label for `type` ('Auth'/'Server'/'Database'/'External'/'Internal').
 * @property {string} name       The record's primary display name.
 * @property {string} detail     Secondary display text (e.g. host/url), joined with ' · '.
 * @property {string[]} fields   Every human-identifying field value on this record, for matching.
 */

/**
 * A client in full (`clients:get`): its label + ordered auth connections,
 * servers, databases, external services, and internal systems.
 * @typedef {Object} Client
 * @property {number} id     The COMPANY lookup_codes id.
 * @property {string} label
 * @property {ClientVpnConnection[]} vpnConnections
 * @property {ClientServer[]} servers
 * @property {ClientDatabase[]} databases
 * @property {ClientExternalService[]} externalServices
 * @property {ClientInternalSystem[]} internalSystems
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
 * CURRENCY, BILLING_CYCLE, PROJECT_STATUS, PROJECT_DOCUMENT,
 * COMPANY_DOCUMENT_CATEGORY), each an ordered list of options (incl. inactive).
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
 * @property {Object<string,number>} byDepartment       DEPARTMENT lookup label → minutes (Milestone 4)
 * @property {Object<string,number>} byProjectCategory  PROJECT_CATEGORY lookup label → minutes (Milestone 4)
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
 * @property {boolean} [canceled]  Present (true) when the user dismissed the save/open dialog.
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

/**
 * One date-urgent item from `attention:list` (db.getAttentionItems) — the
 * Milestone 3 aggregation across subscription renewals, Company Document
 * renewals, and the three client_* tables with an expiry_date (Auth/VPN,
 * External Services, Internal Systems). Carries the raw date, not a computed
 * urgency tier — the renderer already has daysUntil()/renewClass()/
 * renewLabel() and reuses them here instead of duplicating day-math
 * server-side.
 * @typedef {Object} AttentionItem
 * @property {'subscription'|'companyDocument'|'clientVpn'|'clientExternal'|'clientInternal'} type
 * @property {number} id           The source row's own id (subscription id, company_documents id, or the client_* record id).
 * @property {string} title        Human-facing name (subscription/document name, VPN connection name, etc.).
 * @property {string} date         YYYY-MM-DD renewal_date or expiry_date.
 * @property {'subscriptions'|'companydocs'|'clients'} module  Which nav module to deep-link into.
 * @property {number} [companyId]  Set only for the three 'client*' types — the COMPANY lookup id, for openClientDetail(companyId, title).
 */

/**
 * One file in <userData>/backups/ (Milestone 6, maintenance:listBackups).
 * @typedef {Object} BackupFileInfo
 * @property {string} name   Filename, e.g. cooperation-tools-2026-07-06-10-00-00.db
 * @property {string} mtime  ISO timestamp
 * @property {number} size   Bytes
 */

/**
 * Result of `maintenance:integrityCheck` — PRAGMA integrity_check +
 * foreign_key_check against the live DB, read-only.
 * @typedef {Object} IntegrityCheckResult
 * @property {boolean} ok
 * @property {string[]} integrityMessages       Empty when ok; otherwise each integrity_check violation line.
 * @property {Object[]} foreignKeyViolations    Raw PRAGMA foreign_key_check rows (table/rowid/parent/fkid).
 */

/**
 * One case-insensitive label collision within a lookup_codes category
 * (Milestone 6, maintenance:lookupDuplicates).
 * @typedef {Object} LookupDuplicateGroup
 * @property {string} category
 * @property {Array<{id: number, code: string, label: string, isActive: boolean}>} codes  The colliding rows (>= 2).
 */

/**
 * Milestone 6's most recent boot-time orphan-file sweep result
 * (maintenance:orphanSweepReport) — in-memory only, resets each app launch.
 * @typedef {Object} OrphanSweepReport
 * @property {string[]} projectIds          project ids whose projects/{id}/ folder was removed this boot.
 * @property {string[]} companyDocumentIds   company_documents ids whose folder was removed this boot.
 * @property {string|null} ranAt            ISO timestamp of the boot that produced this report, or null before first boot.
 */

/**
 * Result of `maintenance:fullBackup` (Milestone 8) — a single new timestamped
 * folder on the Desktop containing the checkpointed DB, full copies of
 * projects/ and company_documents/, and the rotating backups/ snapshots, plus
 * a manifest.json summary. Read-only with respect to <userData> — nothing
 * this writes lives under the live data folder.
 * @typedef {Object} FullBackupResult
 * @property {boolean} ok
 * @property {string} [path]      The new backup folder's absolute path.
 * @property {string} [error]
 * @property {Object} [manifest]  Same content written to manifest.json (appVersion, createdAt,
 *                                schemaHead, tableRowCounts, folders, totalFileCount, totalByteCount).
 */

/**
 * Result of `security:credentialEncryptionStatus` — whether the five client_*
 * tables' password/secret_key columns are actually being encrypted at rest
 * this run (Milestone 2, migration 032). `false` means safeStorage is
 * unavailable (e.g. a locked-down environment with no OS keychain) and
 * credentials are being stored in plain text, same as before Milestone 2 —
 * surfaced as a Settings banner rather than a silent regression.
 * @typedef {Object} CredentialEncryptionStatus
 * @property {boolean} available
 */

module.exports = {};   // documentation-only module
