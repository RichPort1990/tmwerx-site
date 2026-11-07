// Public pages and signing in: home, contact, sign-up, email confirmation, login, password reset, invitations, the agreement.
import { homeHtml } from './home.js';
import { esc, msg, page, secHeaders, steps } from './pages.js';
import { TERMS_VERSION, termsHtml } from './terms.js';
import {
  accepted,
  adminAccepted,
  checkPassword,
  hashPassword,
  isOperator,
  knownDevice,
  makeToken,
  nextStep,
  pwProblem,
  readToken,
  revokeLogin,
  sendDeviceCode,
  startSession,
  termsHash,
  trustDevice,
  useToken,
} from './auth.js';
import { syncSeats } from './billing.js';
import { emailOk, now, plain, redirect, redirectC, sendEmail, tooMany, workDomain } from './lib/core.js';

/* ---------- pages ---------- */
export function home(env, u, sent = '', err = '', v = {}) {
  return new Response(homeHtml(env, u, { sent, err, v }), {
    status: err ? 400 : 200,
    headers: secHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
  });
}
// "Get in touch" and "Book a demo": emailed to SUPPORT_EMAIL, nothing kept in the database
export async function contact(req, env, M, f, ip) {
  if (M !== 'POST') return redirect('/#contact');
  const v = {
    kind: f('kind') === 'demo' ? 'demo' : 'question',
    name: f('name').slice(0, 120),
    company: f('company').slice(0, 120),
    email: f('email').toLowerCase().slice(0, 200),
    phone: f('phone').slice(0, 40),
    message: f('message').slice(0, 4000),
  };
  if (f('website')) return home(env, null, 'sent'); // honeypot field: bots fill it, people never see it
  let err = '';
  if (!v.name) err = 'Enter your name.';
  else if (!emailOk(v.email)) err = 'Enter a valid email address so we can reply.';
  else if (v.kind === 'question' && !v.message) err = 'Tell us what you would like to know.';
  else if (await tooMany(env, 'contact:' + ip, 5, 60))
    err = `Too many messages from here. Email ${env.SUPPORT_EMAIL} instead.`;
  if (err) return home(env, null, '', err, v);
  const text = `${v.kind === 'demo' ? 'Demo request' : 'Question'} from the TM WerX website\n\nName: ${v.name}\nCompany: ${v.company || '-'}\nEmail: ${v.email}\nPhone: ${v.phone || '-'}\n\n${v.message || '(no message)'}\n`;
  try {
    await sendEmail(
      env,
      env.SUPPORT_EMAIL,
      `${v.kind === 'demo' ? 'Demo request' : 'Website question'}: ${v.name}${v.company ? ', ' + v.company : ''}`,
      text
    );
  } catch (e) {
    return home(env, null, '', `Your message could not be sent. Email ${env.SUPPORT_EMAIL} instead.`, v);
  }
  return redirect('/?sent=1#contact');
}
export async function signup(req, env, M, f, u, ipk) {
  if (u) return redirect((await nextStep(env, u)) || '/app');
  let err = '',
    v = { company: '', name: '', email: '' };
  if (M === 'POST') {
    v = { company: f('company').slice(0, 120), name: f('name').slice(0, 120), email: f('email').toLowerCase() };
    const pw = f('password');
    if (!v.company || !v.name) err = 'Enter your company name and your name.';
    else if (!emailOk(v.email)) err = 'Enter a valid email address.';
    else if (pwProblem(pw)) err = pwProblem(pw);
    else if (!signupAllowed(env, v.email))
      err = `Sign-up is by invitation while TM WerX is in testing. Email ${env.SUPPORT_EMAIL || 'us'} to join.`;
    else if (await tooMany(env, 'signup:' + ipk, 10, 60)) err = 'Too many sign-ups from here. Try again later.';
    else if (
      !(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(v.email).first()) &&
      (await orgForDomain(env, v.email))
    )
      return askToJoin(req, env, await orgForDomain(env, v.email), v);
    else if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(v.email).first())
      err = 'There is already an account for that email. Sign in, or reset your password.';
    else {
      const cid = crypto.randomUUID(),
        uid = crypto.randomUUID();
      // the domain is only claimed once this company is confirmed and paying (applySubscription)
      await env.DB.batch([
        env.DB.prepare('INSERT INTO companies (id, name, created_at, domain_claim) VALUES (?, ?, ?, ?)').bind(
          cid,
          v.company,
          now(),
          (await exempt(env, v.email)) || isOperator(env, { email: v.email, verified: 1 }) ? null : workDomain(v.email)
        ),
        env.DB.prepare(
          'INSERT INTO users (id, company_id, email, name, pass_hash, role, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
        ).bind(uid, cid, v.email, v.name, await hashPassword(pw), 'admin', now()),
      ]);
      await sendVerify(env, req, uid, v.email);
      return redirect('/verify-sent', { 'Set-Cookie': await startSession(env, uid) });
    }
  }
  return page(
    env,
    'Start a subscription',
    `${steps('account')}<div class="card"><h1>Start a subscription</h1>${msg(err)}
<form method="post"><label for="company">Company name</label><input id="company" name="company" type="text" required maxlength="120" value="${esc(v.company)}" autocomplete="organization">
<label for="name">Your name</label><input id="name" name="name" type="text" required maxlength="120" value="${esc(v.name)}" autocomplete="name">
<label for="email">Work email</label><input id="email" name="email" type="email" required value="${esc(v.email)}" autocomplete="email">
<label for="password">Password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password">
<button type="submit">Create account</button></form>
<p class="muted">You'll confirm your email, read and accept the agreement, then set up the monthly subscription. You become your company's administrator and can invite your team.</p></div>`,
    null
  );
}
// one organisation per work domain: once someone from a domain has signed up, colleagues are added by its
// administrator (so the organisation is billed together), unless an operator has let this address start separately
export const exempt = async (env, email) =>
  !!(await env.DB.prepare('SELECT 1 FROM domain_exempt WHERE email = ?').bind(email).first());
export async function orgForDomain(env, email) {
  const d = workDomain(email);
  if (!d || isOperator(env, { email, verified: 1 }) || (await exempt(env, email))) return null;
  return env.DB.prepare(
    "SELECT id, name FROM companies WHERE domain = ? AND closed_at IS NULL AND sub_status IN ('active','trialing','past_due') ORDER BY created_at LIMIT 1"
  )
    .bind(d)
    .first();
}
export async function askToJoin(req, env, org, v) {
  if (!(await tooMany(env, 'join:' + v.email, 2, 24 * 60)) && !(await tooMany(env, 'joinorg:' + org.id, 10, 24 * 60))) {
    const admins = (
      await env.DB.prepare("SELECT email FROM users WHERE company_id = ? AND role = 'admin' AND disabled = 0")
        .bind(org.id)
        .all()
    ).results;
    const app = env.APP_NAME || 'TM WerX',
      link = new URL('/account?invite=' + encodeURIComponent(v.email), req.url).toString();
    for (const a of admins)
      await sendEmail(
        env,
        a.email,
        `${plain(v.name)} would like to join ${plain(org.name)} on ${app}`,
        `${plain(v.name)} (${v.email}) tried to sign up to ${app}. Your organisation already has an account for @${workDomain(v.email)}, so colleagues join it rather than starting their own.\n\nTo add them, open this link and send the invitation (each user is added to your subscription):\n\n${link}\n\nIf you don't know them, ignore this email.`
      ).catch(() => {});
  }
  return page(
    env,
    'Join your organisation',
    `<div class="card"><h1>Your organisation already uses ${esc(env.APP_NAME || 'TM WerX')}</h1><p>Everyone with an <b>@${esc(workDomain(v.email))}</b> email address joins one organisation account, so it's billed together. We've asked its administrator to add you: you'll get an email invitation to set up your login.</p><p class="muted">If you need a separate account (a different company or branch), email ${esc(env.SUPPORT_EMAIL || 'us')}.</p></div>`,
    null
  );
}
// SIGNUP_ALLOW: "*" = anyone may sign up; otherwise a comma-separated list of addresses and @domains (not set = nobody,
// so losing the setting closes sign-up rather than opening it)
export function signupAllowed(env, email) {
  const list = (env.SIGNUP_ALLOW || '')
    .toLowerCase()
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (list.includes('*')) return true;
  const e = email.toLowerCase(),
    d = e.slice(e.lastIndexOf('@'));
  return list.includes(e) || list.includes(d);
}
export async function sendVerify(env, req, uid, email) {
  await env.DB.prepare("UPDATE tokens SET used = 1 WHERE user_id = ? AND kind = 'verify'").bind(uid).run(); // only the newest link works
  const t = await makeToken(env, 'verify', { user_id: uid, email }, 48);
  const link = new URL('/verify?t=' + t, req.url).toString();
  await sendEmail(
    env,
    email,
    `Confirm your email for ${env.APP_NAME || 'TM WerX'}`,
    `Confirm your email address by opening this link (valid for 48 hours):\n\n${link}\n\nIf you didn't sign up, ignore this email.`
  );
}
export async function verifySent(env, M, u) {
  if (!u) return redirect('/login');
  if (u.verified) return redirect((await nextStep(env, u)) || '/app');
  return page(
    env,
    'Confirm your email',
    `${steps('verify')}<div class="card"><h1>Check your email</h1><p>We've sent a link to <b>${esc(u.email)}</b>. Open it to confirm your address, then carry on here.</p>
<form method="post" action="/verify?resend=1"><button class="sec" type="submit">Send the link again</button></form></div>`,
    u
  );
}
export async function verify(req, env, url, M, f, u) {
  if (url.searchParams.get('resend') && M === 'POST') {
    if (!u) return redirect('/login');
    if (!u.verified && !(await tooMany(env, 'verify:' + u.id, 5, 60))) await sendVerify(env, req, u.id, u.email);
    return redirect('/verify-sent');
  }
  const t = url.searchParams.get('t'),
    tk = await readToken(env, 'verify', t);
  const gone = () =>
    page(
      env,
      'Link expired',
      `<div class="card"><h1>That link has expired</h1><p>Sign in and ask for a new confirmation link.</p><a class="btn" href="/login">Sign in</a></div>`,
      null,
      400
    );
  if (!tk) return gone();
  // an address already confirmed has nothing left to confirm: an old link must not become a password reset
  const tu = await env.DB.prepare('SELECT verified, disabled FROM users WHERE id = ?').bind(tk.user_id).first();
  if (!tu || tu.disabled || tu.verified) {
    await useToken(env, t);
    return u && u.id === tk.user_id ? redirect((await nextStep(env, u)) || '/app') : gone();
  }
  if (u && u.id === tk.user_id) {
    if (!(await useToken(env, t))) return gone();
    await env.DB.prepare('UPDATE users SET verified = 1 WHERE id = ?').bind(tk.user_id).run();
    return redirect(isOperator(env, { email: u.email, verified: 1 }) ? '/admin' : '/agreement', {
      'Set-Cookie': await trustDevice(env, req, tk.user_id),
    });
  }
  let err = '';
  if (M === 'POST') {
    const pw = f('password');
    err = pwProblem(pw);
    if (!err) {
      if (!(await useToken(env, t))) return gone();
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET verified = 1, pass_hash = ? WHERE id = ?').bind(
          await hashPassword(pw),
          tk.user_id
        ),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(tk.user_id),
      ]);
      await revokeLogin(env, tk.user_id, req);
      return redirectC(isOperator(env, { email: tk.email, verified: 1 }) ? '/admin' : '/agreement', [
        await startSession(env, tk.user_id),
        await trustDevice(env, req, tk.user_id),
      ]);
    }
  }
  return page(
    env,
    'Confirm your email',
    `<div class="card"><h1>Confirm your email</h1>${msg(err)}<p>You opened this link in a different browser from the one used to sign up, so please set the password for <b>${esc(tk.email)}</b> to finish. Any other sign-ins to this account will be ended.</p>
<form method="post"><label for="password">Password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password"><button type="submit">Confirm and continue</button></form></div>`,
    null
  );
}
export async function login(req, env, M, f, u, ip) {
  if (u && M !== 'POST') return redirect((await nextStep(env, u)) || (u.super ? '/admin' : '/app'));
  const asAdmin = new URL(req.url).searchParams.has('admin');
  let err = '',
    email = '';
  if (M === 'POST') {
    email = f('email').toLowerCase();
    // per address (IP): only failed sign-ins count, so an office signing in at 8 am isn't locked out
    const ipFails = (
      await env.DB.prepare('SELECT COUNT(*) AS c FROM attempts WHERE k = ? AND at > ?')
        .bind('loginip:' + ip, now() - 15 * 60e3)
        .first()
    ).c;
    // per login: only failed passwords count, and a browser this login has confirmed before is let through, so someone
    // guessing from many addresses can't lock the real user out
    const r0 = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND disabled = 0').bind(email).first();
    const emailFails = (
      await env.DB.prepare('SELECT COUNT(*) AS c FROM attempts WHERE k = ? AND at > ?')
        .bind('loginfail:' + email, now() - 15 * 60e3)
        .first()
    ).c;
    if (
      ipFails >= 30 ||
      (await tooMany(env, 'login:' + email + '|' + ip, 8, 15)) ||
      (emailFails >= 60 && !(r0 && (await knownDevice(env, req, r0.id))))
    )
      err = 'Too many attempts. Wait 15 minutes and try again.';
    else {
      const r = r0;
      const okPw = await checkPassword(
        f('password'),
        r ? r.pass_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      ); // same work whether or not the account exists
      if (r && okPw) {
        if (!(await knownDevice(env, req, r.id))) {
          if (await tooMany(env, 'codes:' + r.id, 6, 60))
            err =
              'Too many sign-in codes for this login in the last hour. Wait an hour and try again, or use a browser you have signed in on before.';
          else return sendDeviceCode(env, req, r, req.url);
        } else {
          const nu = await env.DB.prepare(
            'SELECT u.*, c.sub_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?'
          )
            .bind(r.id)
            .first();
          return redirect((await nextStep(env, nu)) || (isOperator(env, nu) ? '/admin' : '/app'), {
            'Set-Cookie': await startSession(env, r.id),
          });
        }
      } else {
        err = 'Email or password not recognised.';
        await env.DB.batch([
          env.DB.prepare('INSERT INTO attempts (k, at) VALUES (?, ?)').bind('loginip:' + ip, now()),
          env.DB.prepare('INSERT INTO attempts (k, at) VALUES (?, ?)').bind('loginfail:' + email, now()),
        ]);
      }
    }
  }
  if (!err && new URL(req.url).searchParams.get('m') === 'elsewhere')
    err =
      "You were signed out because your login was used to sign in on another device. A login can be signed in on one device at a time. If that wasn't you, sign in and change your password.";
  return page(
    env,
    asAdmin ? 'Admin sign in' : 'Sign in',
    `<div class="card"><h1>${asAdmin ? 'Admin sign in' : 'Sign in'}</h1>${msg(err)}<form method="post">
<label for="email">Email</label><input id="email" name="email" type="email" required value="${esc(email)}" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password">
<button type="submit">Sign in</button></form><p class="muted"><a href="/forgot">Forgotten your password?</a> · ${asAdmin ? '' : `<a href="/signup">New customer? Start a subscription</a>`}</p></div>`,
    null
  );
}
export async function forgot(req, env, M, f, ip) {
  let done = false;
  if (M === 'POST') {
    const email = f('email').toLowerCase();
    if (!(await tooMany(env, 'forgot:' + ip, 10, 60))) {
      const r = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND disabled = 0').bind(email).first();
      if (r && !(await tooMany(env, 'forgotto:' + r.id, 5, 60))) {
        await env.DB.prepare("UPDATE tokens SET used = 1 WHERE user_id = ? AND kind = 'reset'").bind(r.id).run();
        const t = await makeToken(env, 'reset', { user_id: r.id, email }, 2);
        await sendEmail(
          env,
          email,
          'Reset your password',
          `Reset your password with this link (valid for 2 hours):\n\n${new URL('/reset?t=' + t, req.url)}\n\nIf you didn't ask for this, ignore this email.`
        );
      }
    }
    done = true; // same answer whether or not the address exists
  }
  return page(
    env,
    'Reset password',
    `<div class="card"><h1>Reset your password</h1>${done ? msg('If that email has an account, a reset link is on its way.', 'ok') : ''}
<form method="post"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username"><button type="submit">Send reset link</button></form></div>`,
    null
  );
}
export async function reset(req, env, M, f, url) {
  const t = url.searchParams.get('t'),
    tk = await readToken(env, 'reset', t);
  if (!tk)
    return page(
      env,
      'Link expired',
      `<div class="card"><h1>That link has expired</h1><a class="btn" href="/forgot">Ask for a new one</a></div>`,
      null,
      400
    );
  let err = '';
  if (M === 'POST') {
    const pw = f('password');
    err = pwProblem(pw);
    if (!err) {
      if (!(await useToken(env, t)))
        return page(
          env,
          'Link expired',
          `<div class="card"><h1>That link has expired</h1><a class="btn" href="/forgot">Ask for a new one</a></div>`,
          null,
          400
        );
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET pass_hash = ?, verified = 1 WHERE id = ?').bind(
          await hashPassword(pw),
          tk.user_id
        ),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(tk.user_id),
      ]);
      await revokeLogin(env, tk.user_id, req);
      const nu = await env.DB.prepare(
        'SELECT u.*, c.sub_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = ?'
      )
        .bind(tk.user_id)
        .first();
      return redirectC((await nextStep(env, nu)) || (isOperator(env, nu) ? '/admin' : '/app'), [
        await startSession(env, tk.user_id),
        await trustDevice(env, req, tk.user_id),
      ]);
    }
  }
  return page(
    env,
    'New password',
    `<div class="card"><h1>Choose a new password</h1>${msg(err)}<form method="post"><label for="password">New password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password"><button type="submit">Save password</button></form></div>`,
    null
  );
}
export async function invite(req, env, M, f, url) {
  const t = url.searchParams.get('t'),
    tk = await readToken(env, 'invite', t);
  if (!tk)
    return page(
      env,
      'Invitation expired',
      `<div class="card"><h1>That invitation has expired</h1><p>Ask your administrator to invite you again.</p></div>`,
      null,
      400
    );
  const c = await env.DB.prepare('SELECT name, closed_at FROM companies WHERE id = ?').bind(tk.company_id).first();
  // an invitation stops working if whoever sent it is no longer an active administrator there
  const by = tk.created_by
    ? await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND company_id = ? AND role = 'admin' AND disabled = 0")
        .bind(tk.created_by, tk.company_id)
        .first()
    : true;
  if (!c || c.closed_at || !by)
    return page(
      env,
      'Invitation expired',
      `<div class="card"><h1>That invitation has expired</h1><p>Ask your administrator to invite you again.</p></div>`,
      null,
      400
    );
  let err = '',
    name = '';
  if (M === 'POST') {
    name = f('name').slice(0, 120);
    const pw = f('password');
    if (!name) err = 'Enter your name.';
    else err = pwProblem(pw);
    const ex = err
      ? null
      : await env.DB.prepare('SELECT id, company_id, disabled FROM users WHERE email = ?').bind(tk.email).first();
    if (ex && !(ex.disabled && ex.company_id === tk.company_id)) err = 'That email already has an account.';
    if (!err && !(await useToken(env, t)))
      return page(
        env,
        'Invitation expired',
        `<div class="card"><h1>That invitation has already been used</h1><a class="btn" href="/login">Sign in</a></div>`,
        null,
        400
      );
    if (!err) {
      let uid = crypto.randomUUID();
      if (ex) {
        uid = ex.id;
        await env.DB.prepare(
          'UPDATE users SET name = ?, pass_hash = ?, role = ?, verified = 1, disabled = 0 WHERE id = ?'
        )
          .bind(name, await hashPassword(pw), tk.role === 'admin' ? 'admin' : 'office', uid)
          .run();
      } // a removed colleague re-invited
      else
        await env.DB.prepare(
          'INSERT INTO users (id, company_id, email, name, pass_hash, role, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
        )
          .bind(
            uid,
            tk.company_id,
            tk.email,
            name,
            await hashPassword(pw),
            tk.role === 'admin' ? 'admin' : 'office',
            now()
          )
          .run();
      await syncSeats(env, tk.company_id);
      return redirectC('/agreement', [await startSession(env, uid), await trustDevice(env, req, uid)]);
    }
  }
  return page(
    env,
    'Join your team',
    `<div class="card"><h1>Join ${esc(c ? c.name : 'your team')}</h1>${msg(err)}<p>Set up your login for <b>${esc(tk.email)}</b>.</p>
<form method="post"><label for="name">Your name</label><input id="name" name="name" type="text" required maxlength="120" value="${esc(name)}" autocomplete="name">
<label for="password">Password (at least 10 characters)</label><input id="password" name="password" type="password" required minlength="10" autocomplete="new-password"><button type="submit">Create my login</button></form></div>`,
    null
  );
}
export async function agreement(req, env, M, f, u, ip, ua) {
  if (!u) return redirect('/login');
  if (!u.verified) return redirect('/verify-sent');
  const html = termsHtml(env),
    docHash = await termsHash(env),
    already = await accepted(env, u);
  const waiting = already && u.role !== 'admin' && !(await adminAccepted(env, u.company_id));
  let err = '';
  if (M === 'POST' && !already) {
    const signed = f('signed_name').slice(0, 120);
    if (f('doc_hash') !== docHash)
      err = 'The agreement has changed since this page was opened. Please read it again and sign.';
    else if (f('agree') !== 'yes') err = 'Tick the box to confirm you accept the agreement.';
    else if (signed.toLowerCase().replace(/\s+/g, ' ') !== u.name.toLowerCase().replace(/\s+/g, ' '))
      err = `Type your full name exactly as on your account (${u.name}) to sign.`;
    else {
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO terms_docs (hash, version, html, created_at) VALUES (?, ?, ?, ?)').bind(
          docHash,
          TERMS_VERSION,
          html,
          now()
        ), // the exact text signed
        env.DB.prepare(
          'INSERT INTO acceptances (id, user_id, company_id, version, doc_hash, signed_name, email, company_name, role, ip, user_agent, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          crypto.randomUUID(),
          u.id,
          u.company_id,
          TERMS_VERSION,
          docHash,
          signed,
          u.email,
          u.company_name,
          u.role,
          ip,
          ua,
          now()
        ),
      ]);
      return redirect((await nextStep(env, Object.assign({}, u, { acc_ok: null, adm_ok: null }))) || '/app'); // just signed: ask the database again
    }
  }
  const signer =
    u.role === 'admin'
      ? `By signing, you accept this agreement on behalf of <b>${esc(u.company_name)}</b> and confirm you are authorised to do so.`
      : `By signing, you confirm you will use the service on these terms, which ${esc(u.company_name)} has accepted.`;
  return page(
    env,
    'Agreement',
    `${steps('agreement')}<div class="card"><h1>Subscription agreement</h1>${msg(err)}
${already ? msg(`You accepted version ${TERMS_VERSION}.`, 'ok') : ''}${waiting ? msg(`Waiting for an administrator at ${u.company_name} to accept this version on the company's behalf. You'll be able to use the designer as soon as they have.`, 'info') : ''}<div class="terms">${html}</div>
${
  already
    ? waiting
      ? ''
      : '<a class="btn" href="/">Continue</a>'
    : `<form method="post"><input type="hidden" name="doc_hash" value="${docHash}"><p>${signer}</p>
<label class="chk"><input type="checkbox" name="agree" value="yes"> I have read and accept the agreement (version ${TERMS_VERSION}).</label>
<label for="signed_name">Type your full name to sign</label><input id="signed_name" name="signed_name" type="text" required autocomplete="off">
<button type="submit">Sign and continue</button></form><p class="muted">We record your name, email, company, the agreement version and its fingerprint, the time and your IP address. <a href="/terms" target="_blank">Open the agreement in a new tab</a> to save or print it.</p>`
}</div>`,
    u
  );
}
