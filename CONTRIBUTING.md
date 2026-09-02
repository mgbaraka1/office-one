# Contributing

Thanks for taking an interest. Office ONE is a small, opinionated desktop app
with a deliberately narrow set of dependencies, so the fastest way to get a
change merged is to understand the constraints before writing code.

This file covers the workflow and the invariants. For architecture and the
database model, the code is the reference: `db.js` owns the schema and every
query, `migrations/` records how the schema got there in order, and the smoke
suites in `test/` encode the rules a change has to keep.

One thing worth knowing before you open it: **`db.js` is around 5,200 lines** —
roughly a fifth of the codebase, and the file most non-trivial changes touch. It
is sectioned by domain rather than split into modules, and that is deliberate: it
owns the single SQLite connection, and keeping every query beside the schema it
depends on is what makes the invariants checkable in one place. Work inside the
section your change belongs to rather than appending to the bottom.

---

## Before you start

Open an issue first for anything beyond a bug fix or a typo. A feature that
conflicts with the design constraints below will be declined regardless of how
well it is implemented, and it is better to find that out before you spend the
evening on it.

## Design constraints

These are not preferences to be argued over per-PR; they define what the app is.

- **Offline, with no network layer.** No server, no cloud sync, no telemetry, no
  outbound requests. The renderer's CSP sets `connect-src 'none'` and it stays
  that way.
- **One runtime dependency.** `bcryptjs`, and it is pure JS. No native addons —
  they would break the "clone, `npm install`, run" property and the packaged
  build. Storage is Node 24's built-in `node:sqlite`.
- **No bundler and no transpilation.** The renderer is ordered classic scripts;
  load order in `index.html` is significant.
- **All data is per-account and scoped in the main process.** The renderer never
  supplies a `user_id` and never touches the filesystem.

## Getting set up

```bash
npm install
npm start          # launch the app
npm run lint       # eslint
npm test           # 40 headless smoke suites
npm run test:e2e   # real Electron over CDP
npm run pack       # unpacked build — a fast packaging sanity check
```

Node 24 or newer is required (`node:sqlite` and the test harness both depend on
it), and CI runs on Windows.

**Set `OFFICE_ONE_DATA_DIR` while developing.** Copy `.env.example` to `.env` and
point it at a throwaway folder. Without it the app opens the same database your
installed copy uses, and a stray migration or a destructive test is a real data
loss. See `.env.example`.

## The rules that CI enforces

A change that breaks one of these fails the build, so check them before pushing:

- **Migrations are append-only.** Add `migrations/NNN_name.js`; never edit an
  applied migration. A migration must be idempotent enough to survive restoring
  an older backup, and destructive ones set `destructive: true` so a snapshot is
  taken first.
- **A new IPC channel takes four edits, not one:** the handler in `main.js`, an
  argument contract in `ipc-contracts.js`, the façade method in `preload.js`, and
  the shape in `ipc-types.js`. A channel with no contract fails closed, and
  `test/ipc-contracts-smoke.js` checks all four agree.
- **Categories live in the lookup catalog**, never as hardcoded arrays. Compare
  on the stable `code`, render the label, and soft-disable rather than delete.
- **No inline event attributes.** Use `data-onclick` / `data-onchange` and friends,
  parsed by `renderer/event-delegation.js`; the CSP forbids anything else.
- **Design tokens only** — colors, spacing, radii and shadows come from the
  custom properties in `:root`.
- **Every new user-facing string needs an Arabic entry** in `renderer/i18n.js`,
  including strings returned from the main process. One English string carries
  exactly one Arabic meaning: if two features need the same word differently,
  rename the English rather than adding a second dictionary entry.
- **New top-level paths must be added to `package.json` → `build.files`**, or
  they will be missing from packaged builds.
- **No destructive action without a recovery path** — inline confirm plus an
  undo toast, never a bare hard delete.

## Code style

Run `npm run lint` before you push. CI runs it too, ahead of the test suites.

ESLint is the only style authority here — there is no Prettier and no formatting
pass, so a diff stays limited to the lines you actually changed. Beyond what the
linter enforces, match the file you are editing: two-space indent, single quotes,
semicolons, and comments that explain **why** rather than restating the code.
`.editorconfig` carries the whitespace rules for your editor.

Read `eslint.config.js` once before arguing with it. Two of its choices are
load-bearing rather than taste:

- **`prefer-const` and `no-var` are off for `renderer/`.** The renderer is
  ordered classic scripts sharing one global scope, so `core.js` declares the
  app's mutable state as top-level `let` and the feature files assign it.
  ESLint analyses one file at a time, reads those as never reassigned, and
  `--fix` will rewrite them to `const` — which throws a `TypeError` the moment
  another script assigns one. No smoke test catches that. Leave the rule off.
- **The stylistic rules are off for `migrations/`.** Applied migrations are
  immutable, so the linter must never ask anyone to edit one.

ESLint is pinned to an exact version so that a rule added in a patch release
cannot turn CI red without anyone having changed the code.

## Retired surfaces

Some features were withdrawn from the app while their tables and columns stayed
behind, because migrations are append-only and a column cannot be un-added. The
code still threading through them is residue, not an extension point:

- **Sub-Projects / Annual Support** (migration 035, retired 2026-07-09) —
  `projects.parent_project_id`, `project_support_years`, `tasks.support_year_id`.
  Nothing creates either link, but migration 048's triggers still name
  `support_year_id`, so the task write paths must keep passing it through.
  `db.js` carries the full explanation above `resolveParentProjectId`.
- **Project Categories** (migration 031) — removed outright by migration 042.
- **`client_databases` / `client_external_services`** — no UI and no rows, kept
  only so the credential-encryption sweep still catches a legacy plaintext value.
- **`appGet`/`appSet` and `internalTaskWhere` in `db.js`** have no caller today.
  Each is the other half of a pair whose live half is used constantly, kept so
  the predicate or the K/V scope is never re-derived by hand. They carry an
  explicit `eslint-disable` line rather than being deleted.

Don't build on any of these — and don't tidy them away either. The second is how
you end up out of step with a constraint SQLite is still enforcing.

## Pull requests

- Branch from `main`, keep the change focused, and make sure `npm test` and
  `npm run test:e2e` both pass locally. `npm test` stops at the first failure, so
  a green run after a fix can still be hiding a second problem — run it twice.
- Add or extend a smoke suite in `test/` for behavior you change. The suites are
  plain Node scripts with no framework.
- Write commit messages that explain **why**. The existing history is the style
  guide.
- Never include real data — no database file, no backup bundle, no screenshot of
  a live client, and no real hostname, IP address or email anywhere in source.
  Client and company data belongs in the **database**, never in the code.
  `test/no-real-data-smoke.js` enforces this in CI: use `example.com`, a `.test`
  domain, or an RFC 5737 address range for anything that needs to look real.

## Reporting bugs and vulnerabilities

Bugs go through the issue templates. **Security problems do not** — see
[SECURITY.md](SECURITY.md) for private reporting and the threat model.

## License

By contributing you agree that your contributions are licensed under the
[ISC License](LICENSE) that covers the project.
