// Passwords, sessions, confirmed browsers, emailed links, and where a signed-in user should be next.
import { esc, msg, page } from './pages.js';
import { TERMS_VERSION, termsHtml } from './terms.js';
import {
  ACTIVE,
  CK,
  DAY,
  DK,
  PK,
  SESSION_DAYS,
  b64u,
  enc,
  now,
  randToken,
  redirectC,
  sendEmail,
  sha256,
  tooMany,
  unb64u,
} from './lib/core.js';

/* ---------- passwords (PBKDF2-SHA256, the most Workers allows: 100,000 rounds) ---------- */
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${b64u(salt)}$${b64u(bits)}`;
}
export async function checkPassword(pw, stored) {
  const [, it, s, h] = String(stored).split('$');
  if (!h) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(s), iterations: +it },
    key,
    256
  );
  return timingSafe(b64u(bits), h);
}
export function timingSafe(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const pwProblem = pw =>
  !pw || pw.length < 10
    ? 'Use a password of at least 10 characters.'
    : pw.length > 200
      ? 'That password is too long.'
      : null;

/* ---------- sessions ---------- */
export function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
// one device at a time: a new sign-in ends the login's other sessions, remembering them so that device can say why
// (TM WerX's own operators are left signed in elsewhere)
export async function startSession(env, userId) {
  const t = randToken();
  const usr = await env.DB.prepare('SELECT email, verified FROM users WHERE id = ?').bind(userId).first();
  const q = [];
  if (!(usr && isOperator(env, usr)))
    q.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO session_ends (id, user_id, reason, at) SELECT id, user_id, 'elsewhere', ? FROM sessions WHERE user_id = ?"
      ).bind(now(), userId),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)
    );
  q.push(
    env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await sha256(t),
      userId,
      now(),
      now() + SESSION_DAYS * DAY
    )
  );
  await env.DB.batch(q);
  return `${CK}=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
export async function currentUser(req, env) {
  const t = cookie(req, CK);
  if (!t) return null;
  // the agreement checks ride along (one query per request, not three): has this user, and the company's admin, signed
  // the current terms
  const th = await termsHash(env);
  const r = await env.DB.prepare(
    `SELECT u.*, s.id AS sid, c.name AS company_name, c.sub_status, c.stripe_customer, c.stripe_sub, c.stripe_item, c.seats_paid, c.period_end, c.cancel_at_period_end, c.logo_type,
      EXISTS (SELECT 1 FROM acceptances WHERE user_id = u.id AND version = ? AND doc_hash = ?) AS acc_ok,
      EXISTS (SELECT 1 FROM acceptances a JOIN users x ON x.id = a.user_id WHERE a.company_id = u.company_id AND a.version = ? AND a.doc_hash = ? AND x.role = 'admin' AND x.disabled = 0) AS adm_ok
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`
  )
    .bind(TERMS_VERSION, th, TERMS_VERSION, th, await sha256(t), now())
    .first();
  if (!r) return null;
  r.super = isOperator(env, r);
  return r;
}
export const clearCookie = `${CK}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export async function endedHere(req, env) {
  const t = cookie(req, CK);
  return !!(
    t &&
    t.length <= 100 &&
    (await env.DB.prepare("SELECT 1 FROM session_ends WHERE id = ? AND reason = 'elsewhere'")
      .bind(await sha256(t))
      .first())
  );
}

/* ---------- confirmed browsers: the first sign-in on a browser needs a code emailed to the user ---------- */
export const devCookie = id => `${DK}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${400 * 86400}`;
export const devOf = req => {
  const d = cookie(req, DK);
  return d && d.length <= 100 ? d : null;
};
export async function knownDevice(env, req, userId) {
  const d = devOf(req);
  if (!d) return false;
  const r = await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE user_id = ? AND id = ?')
    .bind(now(), userId, await sha256(d))
    .run();
  return !!(r.meta && r.meta.changes);
}
// an emailed link or code has just proved the user reads that mailbox: trust this browser from now on
export async function trustDevice(env, req, userId) {
  const d = devOf(req) || randToken();
  await env.DB.prepare(
    'INSERT INTO devices (user_id, id, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET last_seen = excluded.last_seen'
  )
    .bind(userId, await sha256(d), now(), now())
    .run();
  return devCookie(d);
}
// a password change or reset: every emailed link still out for this login stops working, and every other
// confirmed browser has to confirm again with a code (keep = the browser making the change)
// the statements that remove a user's sign-ins: sessions, confirmed browsers and pending codes (and, for a user
// removed for good, the notes that a session was ended elsewhere)
export function loginRows(env, userId, { forGood = false } = {}) {
  return ['sessions', 'devices', 'device_codes', ...(forGood ? ['session_ends'] : [])].map(t =>
    env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId)
  );
}
export async function revokeLogin(env, userId, req) {
  const d = req ? devOf(req) : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE tokens SET used = 1 WHERE user_id = ? AND kind IN ('verify', 'reset')").bind(userId),
    env.DB.prepare('DELETE FROM device_codes WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM devices WHERE user_id = ? AND id <> ?').bind(userId, d ? await sha256(d) : ''),
  ]);
}
export async function sendDeviceCode(env, req, usr, url) {
  const cks = [];
  let d = devOf(req);
  if (!d) {
    d = randToken();
    cks.push(devCookie(d));
  }
  const p = randToken(),
    code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0'),
    app = env.APP_NAME || 'TM WerX';
  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_codes WHERE user_id = ?').bind(usr.id),
    env.DB.prepare(
      'INSERT INTO device_codes (id, user_id, dev, code_hash, tries, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).bind(await sha256(p), usr.id, await sha256(d), await sha256(code + ':' + usr.id), now() + 15 * 60e3, now()),
  ]);
  await sendEmail(
    env,
    usr.email,
    `${app} sign-in code: ${code}`,
    `Your code to finish signing in to ${app} is:\n\n${code}\n\nIt works for 15 minutes, on the browser you signed in from. You're asked for a code the first time a login is used on a browser.\n\nIf you didn't just sign in, someone knows your password: change it on the Account page straight away.`
  );
  cks.push(`${PK}=${p}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
  return redirectC('/login/code', cks);
}
export async function loginCode(req, env, M, f, url) {
  const p = cookie(req, PK);
  const row =
    p && p.length <= 100
      ? await env.DB.prepare(
          'SELECT d.*, u.email, u.disabled FROM device_codes d JOIN users u ON u.id = d.user_id WHERE d.id = ?'
        )
          .bind(await sha256(p))
          .first()
      : null;
  const gone = () =>
    page(
      env,
      'Sign in',
      `<div class="card"><h1>That sign-in has expired</h1><p>Codes work for 15 minutes. Sign in again for a new one.</p><a class="btn" href="/login">Sign in</a></div>`,
      null,
      400
    );
  if (!row || row.expires_at < now() || row.disabled) return gone();
  let err = '';
  if (M === 'POST') {
    if (f('resend')) {
      if ((await tooMany(env, 'code:' + row.user_id, 3, 15)) || (await tooMany(env, 'codes:' + row.user_id, 6, 60)))
        err = 'Too many codes sent. Wait 15 minutes and sign in again.';
      else return sendDeviceCode(env, req, { id: row.user_id, email: row.email }, url);
    } else {
      const code = f('code').replace(/\D/g, ''),
        d = devOf(req);
      // count the try before checking it, in one statement, so guesses sent at the same moment still get 5 between them
      const tr = await env.DB.prepare(
        'UPDATE device_codes SET tries = tries + 1 WHERE id = ? AND tries < 5 AND expires_at > ?'
      )
        .bind(row.id, now())
        .run();
      if (!(tr.meta && tr.meta.changes === 1)) {
        await env.DB.prepare('DELETE FROM device_codes WHERE id = ?').bind(row.id).run();
        err = 'Too many wrong codes. Sign in again for a new one.';
      } else if (!d || (await sha256(d)) !== row.dev) err = 'Enter the code in the browser you signed in from.';
      else if (
        code.length === 6 &&
        timingSafe(await sha256(code + ':' + row.user_id), row.code_hash) &&
        (await env.DB.prepare('DELETE FROM device_codes WHERE id = ?').bind(row.id).run()).meta.changes === 1
      ) {
        const nu = await env.DB.prepare(
          'SELECT u.*, c.sub_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?'
        )
          .bind(row.user_id)
          .first();
        return redirectC((await nextStep(env, nu)) || (isOperator(env, nu) ? '/admin' : '/app'), [
          await startSession(env, row.user_id),
          await trustDevice(env, req, row.user_id),
          `${PK}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ]);
      } else err = "That code isn't right. Check the most recent email.";
    }
  }
  return page(
    env,
    'Confirm this browser',
    `<div class="card"><h1>Check your email</h1>${msg(err)}<p>This is the first time <b>${esc(row.email)}</b> has signed in on this browser. We've emailed a 6-digit code: enter it to carry on. You'll only be asked once on each browser.</p>
<form method="post"><label for="code">Code</label><input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="one-time-code" required autofocus><button type="submit">Confirm</button></form>
<form method="post"><input type="hidden" name="resend" value="1"><button class="sec" type="submit">Send a new code</button></form></div>`,
    null
  );
}

/* ---------- emailed one-use links ---------- */
export async function makeToken(env, kind, o, hours) {
  const t = randToken();
  await env.DB.prepare(
    'INSERT INTO tokens (id, kind, user_id, company_id, email, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      await sha256(t),
      kind,
      o.user_id || null,
      o.company_id || null,
      o.email || null,
      o.role || null,
      now() + hours * 3600e3,
      now(),
      o.created_by || null
    )
    .run();
  return t;
}
export async function readToken(env, kind, t) {
  if (!t || t.length > 100) return null;
  const r = await env.DB.prepare('SELECT * FROM tokens WHERE id = ? AND kind = ?')
    .bind(await sha256(t), kind)
    .first();
  return r && !r.used && r.expires_at > now() ? r : null;
}
export const useToken = async (env, t) => {
  const r = await env.DB.prepare('UPDATE tokens SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ?')
    .bind(await sha256(t), now())
    .run();
  return !!(r.meta && r.meta.changes === 1);
};
/* ---------- where a user should be: the sign-up steps in order ---------- */
export let hashMemo = null;
export async function termsHash(env) {
  if (hashMemo && hashMemo.env === env) return hashMemo.d; // the terms depend only on the site's settings: worked out once per instance
  const h = termsHtml(env);
  if (!hashMemo || hashMemo.h !== h) hashMemo = { h, d: await sha256(h) };
  hashMemo.env = env;
  return hashMemo.d;
}
export async function accepted(env, u) {
  return !!(await env.DB.prepare('SELECT 1 FROM acceptances WHERE user_id = ? AND version = ? AND doc_hash = ?')
    .bind(u.id, TERMS_VERSION, await termsHash(env))
    .first());
}
export const adminAccepted = async (env, cid) =>
  !!(await env.DB.prepare(
    "SELECT 1 FROM acceptances a JOIN users x ON x.id = a.user_id WHERE a.company_id = ? AND a.version = ? AND a.doc_hash = ? AND x.role = 'admin' AND x.disabled = 0"
  )
    .bind(cid, TERMS_VERSION, await termsHash(env))
    .first());
export function isOperator(env, u) {
  return (
    !!u.verified &&
    (env.ADMIN_EMAILS || '')
      .toLowerCase()
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .includes((u.email || '').toLowerCase())
  );
}
export async function nextStep(env, u) {
  if (!u.verified) return '/verify-sent';
  if (u.super || isOperator(env, u)) return null; // TM WerX's own operators: no agreement or subscription needed
  if (!(u.acc_ok != null ? !!u.acc_ok : await accepted(env, u))) return '/agreement';
  if (u.role !== 'admin' && !(u.adm_ok != null ? !!u.adm_ok : await adminAccepted(env, u.company_id)))
    return '/agreement'; // the company must sign a new version first
  if (!ACTIVE.has(u.sub_status)) return '/billing';
  return null;
}
