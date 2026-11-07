// The office web app's page: a small shell; the app itself is /assets/office.js and talks to /api/office.
import { nextStep } from '../auth.js';
import { esc, secHeaders } from '../pages.js';
import { redirect } from '../lib/core.js';
import { CREW } from './util.js';

// load order matters: core first (helpers), main last (starts the app)
const OFFICE_SCRIPTS = ['core', 'live', 'jobs', 'requests', 'people', 'docs', 'reports', 'settings', 'main'];

export async function officeShell(env, u) {
  if (!u) return redirect('/login');
  if (CREW.has(u.role)) return redirect('/crew/');
  const ns = await nextStep(env, u);
  if (ns) return redirect(ns);
  const v = (env.CF_VERSION && env.CF_VERSION.id ? env.CF_VERSION.id : 'dev').slice(0, 8);
  return new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(u.company_name)} · TM WerX</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/assets/office.css?v=${v}">
</head><body><div id="app"><p style="padding:40px;color:#a0a7b0">Loading TM WerX…</p></div>${OFFICE_SCRIPTS.map(s => `<script src="/assets/office/${s}.js?v=${v}"></script>`).join('')}</body></html>`,
    {
      headers: secHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; frame-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      }),
    }
  );
}
