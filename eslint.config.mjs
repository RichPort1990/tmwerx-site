// ESLint: the Worker's modules, the build scripts, and the office and crew apps in public/
import js from '@eslint/js';
import globals from 'globals';
import { readdirSync, readFileSync } from 'node:fs';

// the office app is plain scripts sharing one page, so a name declared at the top of one file is used in the others
const officeDir = 'public/assets/office';
const shared = {};
for (const f of readdirSync(officeDir).filter(f => f.endsWith('.js')))
  for (const m of readFileSync(`${officeDir}/${f}`, 'utf8').matchAll(/^(?:const|let|function|async function)\s+([\w$]+)/gm)) shared[m[1]] = 'writable';

const common = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-constant-condition': ['error', { checkLoops: false }],
};
export default [
  { ignores: ['build/**', 'node_modules/**', '.wrangler/**'] },
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.worker, ...globals.node } },
    rules: common,
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker } },
    rules: common,
  },
  {
    files: ['public/crew/app.js'],
    languageOptions: { globals: { TMDB: 'readonly' } },
  },
  {
    files: ['public/crew/sw.js'],
    languageOptions: { globals: { TMDB: 'readonly', importScripts: 'readonly' } },
  },
  {
    files: ['public/crew/outbox.js'],
    rules: { 'no-unused-vars': ['warn', { vars: 'local' }] },
  },
  {
    files: ['public/assets/office/*.js'],
    languageOptions: { globals: shared },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'local' }], 'no-redeclare': 'off' },
  },
];
