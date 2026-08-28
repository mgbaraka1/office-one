# Contributing

Thanks for taking an interest. Office ONE is a small, opinionated desktop app
with a deliberately narrow set of dependencies, so the fastest way to get a
change merged is to understand the constraints before writing code.

This file covers the workflow and the invariants. For architecture and the
database model, the code is the reference: `db.js` owns the schema and every
query, `migrations/` records how the schema got there in order, and the smoke
suites in `test/` encode the rules a change has to keep.

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
npm test           # 39 headless smoke suites
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

## Pull requests

- Branch from `main`, keep the change focused, and make sure `npm test` and
  `npm run test:e2e` both pass locally. `npm test` stops at the first failure, so
  a green run after a fix can still be hiding a second problem — run it twice.
- Add or extend a smoke suite in `test/` for behavior you change. The suites are
  plain Node scripts with no framework.
- Write commit messages that explain **why**. The existing history is the style
  guide.
- Never include real data — no database file, no backup bundle, no screenshot of
  a live client. Test fixtures use obviously fake names.

## Reporting bugs and vulnerabilities

Bugs go through the issue templates. **Security problems do not** — see
[SECURITY.md](SECURITY.md) for private reporting and the threat model.

## License

By contributing you agree that your contributions are licensed under the
[ISC License](LICENSE) that covers the project.
