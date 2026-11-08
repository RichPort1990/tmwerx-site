/* TM WerX: job allocation and field records for traffic management companies.
   The customer wrap-around (sign-up, email confirmation, the signed agreement, Stripe subscription per active user,
   logo, team invitations) is shared with CAD WerX; behind it, the office web app (/app) and the crew app (/crew).
   Cloudflare Worker + D1 (database) + R2 (files). No framework: small routers and plain pages. */
import { esc, page } from './pages.js';
import { privacyHtml } from './privacy.js';
import { termsHtml } from './terms.js';
import {
  about,
  account,
  accountClose,
  accountExport,
  accountInvite,
  accountLogo,
  accountPassword,
  accountRemove,
  canAdmin,
  font,
  logoImg,
  adminLogoImg,
} from './account.js';
import { admin, adminCsv, adminExempt, adminFree, adminLogo } from './admin.js';
import { clearCookie, cookie, currentUser, endedHere, loginCode } from './auth.js';
import { backup } from './backup.js';
import { billing, billingSuccess, checkout, portal, webhook } from './billing.js';
import { health, healthAlert, schemaReady, updating, withVersion } from './health.js';
import { housekeeping } from './housekeeping.js';
import { CK, ipKey, json, now, readBody, redirect, sha256, tooLarge } from './lib/core.js';
import { crewApi } from './tm/crew-api.js';
import { tmTick } from './tm/cron.js';
import { emailIntake } from './tm/intake.js';
import { officeApi } from './tm/office-api.js';
import { officeShell } from './tm/shell.js';
import { shareRoute } from './tm/share.js';
import { agreement, contact, forgot, home, invite, login, reset, signup, verify, verifySent } from './signin.js';

let healthMemo = null; // the last health check, reused for 30 seconds

export default {
  async scheduled(ev, env, ctx) {
    // two schedules (wrangler.toml): every minute, and the weekly backup ("17 3 * * SUN": Cloudflare numbers the days
    // 1-7 from Sunday, so 0 is refused). Anything but the every-minute one is the backup, however it is written.
    if (ev.cron && ev.cron.trim() !== '* * * * *') {
      await backup(env);
      return;
    }
    if (!(await schemaReady(env))) {
      if (new Date().getUTCMinutes() % 30 === 0) await healthAlert(env);
      return;
    } // nothing that writes until the database is ready
    await tmTick(env);
    // the half-hourly clean-ups and health check, on the hour and half hour
    if (new Date(ev.scheduledTime || now()).getUTCMinutes() % 30 === 0) {
      await housekeeping(env);
      await healthAlert(env);
    }
  },
  // job requests forwarded to jobs+<key>@tmwerx.co.uk (Cloudflare Email Routing: catch-all to this Worker)
  async email(message, env) {
    await emailIntake(message, env);
  },
  async fetch(req, env, ctx) {
    const https = req.url.startsWith('https:');
    // plain http (someone typing the bare domain): straight to https, so a sign-in form is never sent unencrypted
    // (the local test server runs on http://localhost)
    if (!https) {
      const u = new URL(req.url);
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !u.hostname.endsWith('.localhost')) {
        u.protocol = 'https:';
        return new Response(null, { status: 308, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
      }
    }
    try {
      const path = new URL(req.url).pathname;
      // public: up or not, and which version (the details go to the operators by email)
      if (path === '/healthz') {
        const h = healthMemo && now() - healthMemo.at < 30e3 ? healthMemo.h : await health(env);
        healthMemo = { h, at: now() };
        const up = h.checks.database === 'ok' && h.checks.migrations === 'ok';
        return withVersion(json({ ok: up, version: h.version }, up ? 200 : 503), env, https);
      }
      if (!(await schemaReady(env)))
        return withVersion(
          path === '/stripe/webhook' ? new Response('Updating', { status: 503 }) : updating(env),
          env,
          https
        ); // Stripe retries later
      return withVersion(await route(req, env, ctx), env, https);
    } catch (e) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error('ref ' + ref + ': ' + ((e && e.stack) || e));
      return page(
        env,
        'Something went wrong',
        `<div class="card"><h1>Something went wrong</h1><p>Please try again. If it keeps happening, contact ${esc(env.SUPPORT_EMAIL || 'support')} quoting reference <code>${ref}</code>.</p><p><a href="/">Back to the start</a></p></div>`,
        null,
        500
      );
    }
  },
};
async function route(req, env, ctx) {
  const url = new URL(req.url),
    path = url.pathname.replace(/\/+$/, '') || '/',
    M = req.method;
  if (path === '/stripe/webhook' && M === 'POST') return webhook(req, env);
  // the JSON APIs (same-origin only for anything that changes data)
  if (path.startsWith('/api/office/') || path.startsWith('/api/crew/')) {
    const o = req.headers.get('Origin');
    if (M !== 'GET' && o && o !== url.origin) return new Response('Bad origin', { status: 403 });
    const u0 = await currentUser(req, env);
    return path.startsWith('/api/office/') ? officeApi(req, env, u0, url, M) : crewApi(req, env, u0, url, M);
  }
  if (path.startsWith('/share/') && M === 'GET') return shareRoute(env, url);
  // forms: only from our own pages (SameSite cookies plus an Origin check)
  if (M === 'POST') {
    const o = req.headers.get('Origin');
    if (o && o !== url.origin) return new Response('Bad origin', { status: 403 });
  }
  if (M === 'GET' && path.startsWith('/fonts/')) return font(path.slice(7));
  const u = await currentUser(req, env);
  // signed out because the same login signed in on another device: say so on the next page that needs a login
  if (
    !u &&
    M === 'GET' &&
    /^\/(app|account|admin|billing|agreement|verify-sent)(\/|$)/.test(path) &&
    (await endedHere(req, env))
  )
    return redirect('/login?m=elsewhere', { 'Set-Cookie': clearCookie });
  // crew logins have the crew app only: the office's account, billing, agreement and admin pages are not theirs
  if (
    u &&
    ['lead', 'engineer'].includes(u.role) &&
    /^\/(app|account|billing|agreement|admin|verify-sent)(\/|$)/.test(path)
  )
    return redirect('/crew/');
  let F = null;
  if (M === 'POST') {
    const body = await readBody(req, path === '/account/logo' || path === '/admin/logo' ? 1300000 : 32768);
    if (!body) return tooLarge();
    try {
      F = await new Response(body, { headers: { 'Content-Type': req.headers.get('Content-Type') || '' } }).formData();
    } catch (e) {
      F = null;
    }
  }
  const f = k => ((F && F.get(k)) || '').toString().trim();
  const ip = req.headers.get('CF-Connecting-IP') || '',
    ipk = ipKey(ip),
    ua = (req.headers.get('User-Agent') || '').slice(0, 300);

  switch (path) {
    case '/':
      return home(env, u, url.searchParams.has('sent') ? 'sent' : '');
    case '/contact':
      return contact(req, env, M, f, ipk);
    case '/terms':
      return page(
        env,
        'Agreement',
        `<div class="card"><div class="terms" style="max-height:none">${termsHtml(env)}</div></div>`,
        u
      );
    case '/privacy':
      return page(
        env,
        'Privacy',
        `<div class="card"><div class="terms" style="max-height:none">${privacyHtml(env)}</div></div>`,
        u
      );
    case '/about':
      return about(env, u);
    case '/signup':
      return signup(req, env, M, f, u, ipk);
    case '/login':
      return login(req, env, M, f, u, ipk);
    case '/login/code':
      return loginCode(req, env, M, f, url);
    case '/api/session':
      return u
        ? json({ ok: true })
        : json({ ok: false, reason: (await endedHere(req, env)) ? 'elsewhere' : 'signed-out' }, 401);
    case '/admin/exempt':
      return adminExempt(env, M, f, u);
    case '/admin/free':
      return adminFree(env, M, f, u);
    case '/admin/logo':
      return adminLogo(env, M, F, u);
    case '/logout': {
      // only by POST, so a link or image elsewhere cannot sign people out
      if (M !== 'POST')
        return page(
          env,
          'Sign out',
          `<div class="card"><h1>Sign out</h1><form method="post" action="/logout"><button type="submit">Sign out</button></form></div>`,
          u
        );
      const t = cookie(req, CK);
      if (t)
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
          .bind(await sha256(t))
          .run();
      return redirect('/login', { 'Set-Cookie': clearCookie });
    }
    case '/verify-sent':
      return verifySent(env, M, u);
    case '/verify':
      return verify(req, env, url, M, f, u);
    case '/forgot':
      return forgot(req, env, M, f, ipk);
    case '/reset':
      return reset(req, env, M, f, url);
    case '/invite':
      return invite(req, env, M, f, url);
    case '/agreement':
      return agreement(req, env, M, f, u, ip, ua);
    case '/billing':
      return billing(env, M, u, url);
    case '/billing/checkout':
      return checkout(req, env, M, u, url);
    case '/billing/success':
      return billingSuccess(env, u, url);
    case '/billing/portal':
      return portal(env, M, u, url);
    case '/account':
      return account(env, u, url);
    case '/account/invite':
      return accountInvite(env, M, f, u, url);
    case '/account/remove':
      return accountRemove(env, M, f, u);
    case '/account/revoke': {
      if (!(await canAdmin(env, u, M))) return redirect('/account');
      await env.DB.prepare("UPDATE tokens SET used = 1 WHERE kind = 'invite' AND company_id = ? AND email = ?")
        .bind(u.company_id, f('email').toLowerCase())
        .run();
      return redirect('/account?m=revoked');
    }
    case '/account/logo':
      return F ? accountLogo(env, M, F, u) : redirect('/account?e=file');
    case '/account/logo.img':
      return logoImg(env, u);
    case '/admin/logo.img':
      return adminLogoImg(env, u, url);
    case '/account/password':
      return accountPassword(req, env, M, f, u);
    case '/account/export':
      return accountExport(env, u);
    case '/account/close':
      return accountClose(env, M, f, u);
    case '/app':
      return officeShell(env, u);
    case '/admin':
      return admin(env, u, url);
    case '/admin/acceptances.csv':
      return adminCsv(env, u);
    case '/dev/outbox':
      return env.DEV_MODE === '1' && !env.RESEND_API_KEY && /^(localhost|127\.0\.0\.1)$/.test(url.hostname)
        ? json((await env.DB.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all()).results)
        : new Response('Not found', { status: 404 });
  }
  return page(
    env,
    'Not found',
    `<div class="card"><h1>Page not found</h1><p><a href="/">Back to the start</a></p></div>`,
    u,
    404
  );
}
