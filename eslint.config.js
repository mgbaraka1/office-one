// ESLint flat config.
//
// Two source environments live in this repo and they are linted differently:
//
//   * Main process + tests + migrations — CommonJS running under Node 24.
//   * `renderer/` — ordered CLASSIC SCRIPTS. There is no bundler and no module
//     system (see CONTRIBUTING.md); every file shares one global scope, and
//     `core.js` deliberately publishes helpers like `esc()` and `toast()` as
//     globals for the feature files to use. ESLint cannot model that without a
//     hand-maintained list of every cross-file name, which would rot on the
//     first refactor — so `no-undef` is off there and `index.html`'s load order
//     remains the real contract. Everything that catches actual bugs stays on.
//
// Globals are written out below instead of pulling in the `globals` package:
// this project keeps its dependency list short on purpose.

const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  globalThis: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  fetch: 'readonly',
  WebSocket: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  DOMParser: 'readonly',
  FileReader: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  Intl: 'readonly',
  crypto: 'readonly',
  performance: 'readonly',
  structuredClone: 'readonly',
  globalThis: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  alert: 'readonly',
  Quill: 'readonly',
  DOMPurify: 'readonly',
};

// Rules applied everywhere. `eslint:recommended` is the correctness baseline;
// these adjust it to how this codebase is actually written.
const sharedRules = {
  // Empty `catch {}` blocks are used deliberately for best-effort cleanup and
  // for rollbacks that must not mask the original error. See CONTRIBUTING.md.
  'no-empty': ['error', { allowEmptyCatch: true }],
  // An unused function argument is often part of a signature that has to match
  // (IPC handlers take `_event` first); an underscore prefix opts out.
  'no-unused-vars': ['error', {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
    ignoreRestSiblings: true,
  }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  'no-throw-literal': 'error',
  'no-return-await': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-console': 'off',
  curly: 'off',
  semi: ['error', 'always'],
  'no-unexpected-multiline': 'error',
  // Deliberate: xlsx.js strips the control characters OpenXML forbids in a
  // shared string, and a smoke test matches on them.
  'no-control-regex': 'off',
  // `let x = []; try { x = await api.get(); } catch { x = []; }` is the standard
  // shape for every renderer load in this codebase, and the initialiser is the
  // point — it guarantees a usable value no matter which branch runs, including
  // one added later. This rule reads that initialiser as wasted.
  'no-useless-assignment': 'off',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'renderer/vendor/**', // Quill + DOMPurify, vendored verbatim — not ours to lint.
    ],
  },

  js.configs.recommended,

  // Main process, data layer, migrations, tests, build tooling.
  {
    files: ['**/*.js'],
    ignores: ['renderer/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },

  // Renderer: classic scripts sharing one global scope.
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: {
      ...sharedRules,
      'no-undef': 'off', // See the note at the top of this file.
      // Only FUNCTION-SCOPE variables can be judged here. A top-level function
      // in a renderer file is a global on purpose — it is reached from markup
      // by name (`data-onclick="saveSubSettings()"`, resolved at runtime by
      // renderer/event-delegation.js) or from a later-loaded file, neither of
      // which ESLint can see. `vars: 'local'` keeps the rule useful for dead
      // locals without flagging the whole delegated-handler surface.
      'no-unused-vars': ['error', {
        vars: 'local',
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // OFF ON PURPOSE, and it must stay off. `core.js` declares the app's
      // shared mutable state as top-level `let` (activeDate, activeModule,
      // rows, subEditId, …) and the feature files reassign it. ESLint analyses
      // one file at a time, so it sees those as never reassigned and `--fix`
      // will happily rewrite them to `const` — which throws a TypeError the
      // moment any other script assigns one. Re-enabling this rule for the
      // renderer breaks the running app in a way no smoke test catches.
      'prefer-const': 'off',
      // Same reason: at the top level of a classic script `var x` also defines
      // `window.x` while `let x` does not, so this is not a safe rewrite here.
      'no-var': 'off',
    },
  },

  // Applied migrations are immutable — the runner has already replayed them
  // against real databases and `test/` treats the sequence as append-only
  // history. Correctness rules still apply to a NEW migration; the stylistic
  // ones are off so the linter can never ask anyone to edit an applied one.
  {
    files: ['migrations/**/*.js'],
    rules: {
      'prefer-const': 'off',
      'no-var': 'off',
    },
  },
];
