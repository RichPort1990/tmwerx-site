// Is this deployment safe to serve: the database schema, the health check and the operator alerts.
import { BUILT_AT, NEEDS_MIGRATION } from '../build/release.js';
import { esc, page } from './pages.js';
import { logErr, now, sendEmail, tooMany } from './lib/core.js';

/* ---------- router ---------- */
// which deployed version answered (Cloudflare's version id), so a deploy can be checked from outside: X-TMWerX-Version
// and every answer tells browsers to use https only, for a year (HSTS)
export function withVersion(r, env, https) {
  if (!r || r.status === 101) return r;
  const v = env.CF_VERSION && env.CF_VERSION.id,
    set = h => {
      if (v) h.set('X-TMWerX-Version', v.slice(0, 8));
      if (https) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    };
  try {
    set(r.headers);
    return r;
  } catch (e) {
    const n = new Response(r.body, r);
    set(n.headers);
    return n;
  }
}
/* ---------- is this deployment safe to serve? (the database has the migration this code needs) ---------- */
let schemaOk = null; // per running copy of the Worker: checked once a minute until it passes, then never again
export async function schemaReady(env) {
  if (schemaOk && schemaOk.ok) return true;
  if (schemaOk && now() - schemaOk.at < 60e3) return false;
  let ok = false;
  try {
    ok = !!(await env.DB.prepare('SELECT 1 FROM d1_migrations WHERE name = ?').bind(NEEDS_MIGRATION).first());
  } catch (e) {
    return true;
  } // the database itself failing: let the request show its own error
  schemaOk = { ok, at: now() };
  if (!ok) console.error('NOT SERVING: database migration ' + NEEDS_MIGRATION + ' has not been applied');
  return ok;
}
// what /healthz reports, and what the half-hourly check emails the operators about
export async function health(env) {
  const c = {},
    t0 = now();
  try {
    await env.DB.prepare('SELECT 1').first();
    c.database = 'ok';
  } catch (e) {
    c.database = 'failed';
  }
  c.migrations = (await schemaReady(env)) ? 'ok' : 'missing ' + NEEDS_MIGRATION;
  c.email = env.RESEND_API_KEY || env.DEV_MODE === '1' ? 'ok' : 'no RESEND_API_KEY';
  c.push = env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY ? 'ok' : 'no VAPID keys: phone notifications are off';
  c.cadwerx = env.CADWERX ? 'ok' : 'not linked: CAD WerX drawings unavailable';
  c.stripe = env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? 'ok' : 'Stripe secrets missing';
  c.backup = env.BACKUP_KEY || env.DEV_MODE === '1' ? 'ok' : 'no BACKUP_KEY: weekly backups are not written';
  // the scheduled jobs and the feeds are still running (on the live site; the test server has no schedule)
  if (env.DEV_MODE !== '1') {
    try {
      const rows = (await env.DB.prepare("SELECT k, at FROM alerts WHERE k LIKE 'last:%' OR k LIKE 'fail:%'").all())
        .results;
      const last = k => (rows.find(r => r.k === 'last:' + k) || {}).at || 0,
        age = k => (now() - last(k)) / 3600e3;
      if (age('housekeeping') > 2) c.housekeeping = `not run for ${Math.round(age('housekeeping'))} h`;
      const hf = rows.find(r => r.k.startsWith('fail:housekeeping:') && now() - r.at < 3600e3);
      if (hf) c.housekeeping = 'failed: ' + hf.k.slice('fail:housekeeping:'.length);
      if (last('backup') && age('backup') > 8 * 24) c.backup = `no backup for ${Math.round(age('backup') / 24)} days`;
    } catch (e) {
      c.jobs = 'could not be checked: ' + e.message;
    }
  }
  const ok = Object.entries(c).every(([k, v]) => v === 'ok' || k === 'cadwerx');
  return {
    ok,
    checks: c,
    version: env.CF_VERSION && env.CF_VERSION.id ? env.CF_VERSION.id.slice(0, 8) : 'dev',
    built: BUILT_AT,
    ms: now() - t0,
  };
}
export async function healthAlert(env) {
  const h = await health(env);
  if (h.ok) {
    await env.DB.prepare("DELETE FROM alerts WHERE k = 'health'").run().catch(logErr('d1'));
    return;
  }
  // at most one email every 6 hours while it stays broken
  // (the alerts table comes with migration 0008: if that is what's missing, the older attempts table rate-limits instead)
  const r = await env.DB.prepare(
    "INSERT INTO alerts (k, at) VALUES ('health', ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at WHERE alerts.at < ?"
  )
    .bind(now(), now() - 6 * 3600e3)
    .run()
    .catch(() => null);
  if (r ? !(r.meta && r.meta.changes) : await tooMany(env, 'alert:health', 1, 360).catch(() => false)) return;
  const bad = Object.entries(h.checks)
    .filter(([k, v]) => v !== 'ok' && k !== 'cadwerx')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  for (const to of (env.ADMIN_EMAILS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean))
    await sendEmail(
      env,
      to,
      `${env.APP_NAME || 'TM WerX'} health check failing`,
      `The site's health check is failing (version ${h.version}):\n\n${bad}\n\nDetails: https://tmwerx.co.uk/healthz\nIf a database migration is missing, apply it: npx wrangler d1 migrations apply tmwerx --remote`
    ).catch(() => {});
}
export const updating = env =>
  page(
    env,
    'Being updated',
    `<div class="card"><h1>TM WerX is being updated</h1><p>Please try again in a few minutes. If this lasts, contact ${esc(env.SUPPORT_EMAIL || 'support')}.</p></div>`,
    null,
    503
  );
