// A company's account: team, logo, password, export, closing; fonts and the data sources page.
import { FONTS, FONT_CSS } from './fonts.js';
import { esc, msg, page } from './pages.js';
import { TERMS_VERSION } from './terms.js';
import { checkPassword, clearCookie, hashPassword, makeToken, nextStep, loginRows, revokeLogin } from './auth.js';
import { stripe, syncSeats } from './billing.js';
import { ACTIVE, ERR, emailOk, logErr, now, plain, pwCode, redirect, sendEmail, tooMany } from './lib/core.js';

/* ---------- account: team, logo, billing ---------- */
export async function account(env, u, url) {
  if (!u) return redirect('/login');
  const ns = await nextStep(env, u);
  if (ns && ns !== '/billing') return redirect(ns);
  const m = url.searchParams.get('m'),
    e = url.searchParams.get('e');
  const notes = {
    revoked: 'Invitation cancelled.',
    invited: 'Invitation sent, unless that address already has a login with another company.',
    removed: 'User removed; the subscription has been adjusted.',
    logo: 'Logo saved. It appears on job packs and the crew app.',
    logodel: 'Logo removed.',
    pw: 'Password changed.',
  };
  let h = `<h1>Account</h1>${msg(notes[m], 'ok')}${msg(ERR[e])}`;
  h += `<div class="card"><h2>You</h2><p>${esc(u.name)} · ${esc(u.email)} · ${u.role === 'admin' ? 'Administrator' : 'Office user'} at ${esc(u.company_name)}</p>
<details><summary>Change password</summary><form method="post" action="/account/password"><label for="cur">Current password</label><input id="cur" name="current" type="password" required autocomplete="current-password"><label for="np">New password</label><input id="np" name="password" type="password" required minlength="10" autocomplete="new-password"><button type="submit">Change password</button></form></details></div>`;
  if (u.role !== 'admin')
    return page(
      env,
      'Account',
      h + `<p class="muted">Your administrator manages the team, logo and subscription.</p>`,
      u
    );
  const team = (
    await env.DB.prepare(
      'SELECT id, name, email, role, disabled, created_at FROM users WHERE company_id = ? ORDER BY disabled, created_at'
    )
      .bind(u.company_id)
      .all()
  ).results;
  const pend = (
    await env.DB.prepare(
      "SELECT email, role, expires_at FROM tokens WHERE company_id = ? AND kind = 'invite' AND used = 0 AND expires_at > ?"
    )
      .bind(u.company_id, now())
      .all()
  ).results;
  const acc = new Set(
    (
      await env.DB.prepare('SELECT user_id FROM acceptances WHERE company_id = ? AND version = ?')
        .bind(u.company_id, TERMS_VERSION)
        .all()
    ).results.map(r => r.user_id)
  );
  const statusTxt =
    {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Payment overdue: update your card',
      canceled: 'Cancelled',
      unpaid: 'Unpaid',
      incomplete: 'Payment incomplete',
      none: 'Not started',
    }[u.sub_status] || u.sub_status;
  h += `<div class="card"><h2>Subscription</h2><p><b>${esc(statusTxt)}</b>${u.seats_paid ? ` · ${u.seats_paid} user${u.seats_paid === 1 ? '' : 's'}` : ''}${u.period_end ? ` · ${u.cancel_at_period_end ? 'ends' : 'renews'} ${new Date(u.period_end).toLocaleDateString('en-GB')}` : ''}</p>
${u.stripe_customer ? `<form method="post" action="/billing/portal"><button class="sec" type="submit">Payment details, invoices and cancellation</button></form>` : `<a class="btn" href="/billing">Set up subscription</a>`}</div>`;
  h += `<div class="card"><h2>Team</h2><table class="cards"><tr><th>Name</th><th>Email</th><th>Role</th><th>Agreement</th><th></th></tr>${team
    .filter(t => !t.disabled)
    .map(
      t =>
        `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.email)}</td><td data-l="Role">${t.role === 'admin' ? 'Administrator' : 'Office user'}</td><td data-l="Agreement">${acc.has(t.id) ? 'Signed' : '<span class="muted">Not yet</span>'}</td><td>${t.id === u.id ? '' : `<form method="post" action="/account/remove" style="margin:0"><input type="hidden" name="id" value="${esc(t.id)}"><button class="danger" style="margin:0;padding:6px 10px;font-size:13px" type="submit">Remove</button></form>`}</td></tr>`
    )
    .join('')}
${pend.map(p => `<tr><td class="muted">Invited</td><td>${esc(p.email)}</td><td>${p.role === 'admin' ? 'Administrator' : 'Office user'}</td><td class="muted">Pending</td><td><form method="post" action="/account/revoke" style="margin:0"><input type="hidden" name="email" value="${esc(p.email)}"><button class="sec" style="margin:0;padding:6px 10px;font-size:13px" type="submit">Cancel invitation</button></form></td></tr>`).join('')}</table>
<form method="post" action="/account/invite"><div class="row"><div><label for="iemail">Invite by email</label><input id="iemail" name="email" type="email" required value="${esc(emailOk(url.searchParams.get('invite') || '') ? url.searchParams.get('invite') : '')}"></div><div><label for="irole">Role</label><select id="irole" name="role" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:4px;font:inherit"><option value="office">Office user</option><option value="admin">Administrator</option></select></div></div><button type="submit">Send invitation</button></form>
<p class="muted">Each person who joins is added to the subscription (charged from that day, prorated). Removing someone stops their charge.</p></div>`;
  h += `<div class="card"><h2>Logo for job packs and the crew app</h2>${u.logo_type ? `<p><img class="logo-prev" src="/account/logo.img?v=${now()}" alt="Your logo"></p>` : '<p class="muted">No logo yet: your company name is printed instead.</p>'}
<form method="post" action="/account/logo" enctype="multipart/form-data"><label for="logo">PNG or JPEG, up to 1 MB. A wide logo works best (about 2:1).</label><input id="logo" name="logo" type="file" accept="image/png,image/jpeg" required><button type="submit">Upload logo</button></form>
${u.logo_type ? `<form method="post" action="/account/logo"><input type="hidden" name="delete" value="1"><button class="sec" type="submit">Remove logo</button></form>` : ''}</div>`;
  h += `<div class="card"><h2>Your data</h2><p><a href="/account/export">Download your account data</a> (company, team, signed agreements) as a file, or <a href="/app#export">export every job, record and photo</a> from the office app.</p>
<details><summary>Close the account</summary><p class="muted">This ends the subscription now (no refund for the current month), signs everyone out and deletes the logo straight away. Team names and emails are deleted after 90 days; signed agreements are kept as the record of the contract. Jobs, records and photos are deleted with the account's data after 90 days, and nobody can sign in once the account is closed: download the full export below (jobs, records and photos) first.</p>
<form method="post" action="/account/close"><label for="cname">Type the company name (${esc(u.company_name)})</label><input id="cname" name="company" type="text" required autocomplete="off"><label for="cpw">Your password</label><input id="cpw" name="password" type="password" required autocomplete="current-password"><button class="danger" type="submit">Close the account</button></form></details></div>`;
  return page(env, 'Account', h, u);
}
export async function canAdmin(env, u, M) {
  if (!u || M !== 'POST' || u.role !== 'admin') return false;
  const ns = await nextStep(env, u);
  return !ns || ns === '/billing';
}
export async function accountInvite(env, M, f, u, url) {
  if (!(await canAdmin(env, u, M))) return redirect('/account');
  const email = f('email').toLowerCase(),
    role = f('role') === 'admin' ? 'admin' : 'office';
  if (!emailOk(email)) return redirect('/account?e=email');
  if (!['active', 'trialing'].includes(u.sub_status) || u.cancel_at_period_end) return redirect('/account?e=invSub');
  const ex = await env.DB.prepare('SELECT company_id, disabled FROM users WHERE email = ?').bind(email).first();
  if (ex && !(ex.disabled && ex.company_id === u.company_id)) return redirect('/account?m=invited'); // same answer either way: the page doesn't reveal who has an account
  if (
    (await tooMany(env, 'invite:' + u.company_id, 30, 60)) ||
    (await tooMany(env, 'inviteto:' + email, 3, 24 * 60)) ||
    (await tooMany(env, 'inviteall', 500, 60))
  )
    return redirect('/account?e=invTooMany');
  const t = await makeToken(env, 'invite', { company_id: u.company_id, email, role, created_by: u.id }, 24 * 7);
  const who = plain(u.name),
    co = plain(u.company_name, 'their company'),
    app = env.APP_NAME || 'TM WerX';
  await sendEmail(
    env,
    email,
    `You have been invited to ${app}`,
    `${who} has invited you to join ${co} on ${app}.\n\nSet up your login here (valid for 7 days):\n\n${new URL('/invite?t=' + t, url)}\n\nIf you weren't expecting this, ignore this email.`
  );
  return redirect('/account?m=invited');
}
export async function accountRemove(env, M, f, u) {
  if (!(await canAdmin(env, u, M))) return redirect('/account');
  const id = f('id');
  if (id === u.id) return redirect('/account');
  const r = await env.DB.prepare('UPDATE users SET disabled = 1 WHERE id = ? AND company_id = ?')
    .bind(id, u.company_id)
    .run();
  if (r.meta && r.meta.changes) {
    await env.DB.batch([
      ...loginRows(env, id),
      env.DB.prepare("UPDATE tokens SET used = 1 WHERE user_id = ? OR (kind = 'invite' AND created_by = ?)").bind(
        id,
        id
      ),
    ]); // and the invitations they sent
    await syncSeats(env, u.company_id);
  }
  return redirect('/account?m=removed');
}
export async function accountLogo(env, M, F, u) {
  if (!(await canAdmin(env, u, M))) return redirect('/account');
  if (F.get('delete')) {
    await env.FILES.delete('logos/' + u.company_id);
    await env.DB.prepare('UPDATE companies SET logo_type = NULL WHERE id = ?').bind(u.company_id).run();
    return redirect('/account?m=logodel');
  }
  const e = await storeLogo(env, u.company_id, F.get('logo'));
  return redirect(e ? '/account?e=' + e : '/account?m=logo');
}
// a company's logo, checked and stored: null when saved, or the reason it wasn't (a message key)
export async function storeLogo(env, companyId, file) {
  if (!file || typeof file === 'string') return 'file';
  const type = file.type,
    buf = await file.arrayBuffer();
  // PNG and JPEG only: an SVG is a document that can carry scripts, so it isn't accepted at all
  if (!['image/png', 'image/jpeg'].includes(type)) return 'imgType';
  if (buf.byteLength > 1024 * 1024) return 'imgSize';
  const head = new Uint8Array(buf.slice(0, 8));
  const okSig =
    type === 'image/png'
      ? head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
      : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (!okSig) return 'imgBad';
  await env.FILES.put('logos/' + companyId, buf, { httpMetadata: { contentType: type } });
  await env.DB.prepare('UPDATE companies SET logo_type = ? WHERE id = ?').bind(type, companyId).run();
  return null;
}
export async function logoImg(env, u) {
  if (!u || !u.logo_type) return new Response('Not found', { status: 404 });
  const o = await env.FILES.get('logos/' + u.company_id);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, {
    headers: {
      'Content-Type': u.logo_type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
// a company's logo, for TM WerX's own operators only
export async function adminLogoImg(env, u, url) {
  if (!u || !u.super) return new Response('Not found', { status: 404 });
  const id = String(url.searchParams.get('c') || '').slice(0, 64);
  const c = await env.DB.prepare('SELECT logo_type FROM companies WHERE id = ? AND closed_at IS NULL').bind(id).first();
  if (!c || !c.logo_type) return new Response('Not found', { status: 404 });
  const o = await env.FILES.get('logos/' + id);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, {
    headers: {
      'Content-Type': c.logo_type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
export async function accountPassword(req, env, M, f, u) {
  if (!u || M !== 'POST') return redirect('/account');
  if (await tooMany(env, 'pw:' + u.id, 5, 15)) return redirect('/account?e=pwMany');
  if (!(await checkPassword(f('current'), u.pass_hash))) return redirect('/account?e=pwCur');
  const p = pwCode(f('password'));
  if (p) return redirect('/account?e=' + p);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(f('password')), u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(u.id, u.sid),
  ]); // signs out every other device
  await revokeLogin(env, u.id, req);
  return redirect('/account?m=pw');
}

export async function accountExport(env, u) {
  if (!u || u.role !== 'admin') return redirect('/account');
  const c = await env.DB.prepare(
    'SELECT id, name, created_at, sub_status, seats_paid, period_end, cancel_at_period_end, logo_type FROM companies WHERE id = ?'
  )
    .bind(u.company_id)
    .first();
  const team = (
    await env.DB.prepare(
      'SELECT name, email, role, verified, disabled, created_at FROM users WHERE company_id = ? ORDER BY created_at'
    )
      .bind(u.company_id)
      .all()
  ).results;
  const acc = (
    await env.DB.prepare(
      'SELECT version, doc_hash, signed_name, email, role, ip, user_agent, accepted_at FROM acceptances WHERE company_id = ? ORDER BY accepted_at'
    )
      .bind(u.company_id)
      .all()
  ).results;
  const inv = (
    await env.DB.prepare(
      "SELECT email, role, created_at, expires_at FROM tokens WHERE company_id = ? AND kind = 'invite' AND used = 0 AND expires_at > ?"
    )
      .bind(u.company_id, now())
      .all()
  ).results;
  const iso = t => (t ? new Date(t).toISOString() : null);
  const out = {
    exported_at: iso(now()),
    company: Object.assign({}, c, { created_at: iso(c.created_at), period_end: iso(c.period_end) }),
    team: team.map(t => Object.assign({}, t, { created_at: iso(t.created_at) })),
    signed_agreements: acc.map(a => Object.assign({}, a, { accepted_at: iso(a.accepted_at) })),
    pending_invitations: inv.map(i =>
      Object.assign({}, i, { created_at: iso(i.created_at), expires_at: iso(i.expires_at) })
    ),
    jobs_records_and_photos:
      'Download them from the office app: Settings, Export (a zip file of every job, record and photo).',
    invoices: 'Invoices are in the Stripe portal: Account → Payment details, invoices and cancellation.',
  };
  return new Response(JSON.stringify(out, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="account-data.json"',
      'Cache-Control': 'no-store',
    },
  });
}
export async function accountClose(env, M, f, u) {
  if (!u || M !== 'POST' || u.role !== 'admin') return redirect('/account');
  if (await tooMany(env, 'pw:' + u.id, 5, 15)) return redirect('/account?e=pwMany');
  if (
    f('company').replace(/\s+/g, ' ').toLowerCase() !== u.company_name.replace(/\s+/g, ' ').toLowerCase() ||
    !(await checkPassword(f('password'), u.pass_hash))
  )
    return redirect('/account?e=close');
  if (u.stripe_sub && ACTIVE.has(u.sub_status)) await stripe(env, 'DELETE', `subscriptions/${u.stripe_sub}`); // ends billing now; fails loudly rather than leave a live subscription
  await env.FILES.delete('logos/' + u.company_id).catch(logErr('r2'));
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE companies SET closed_at = ?, sub_status = 'canceled', domain = NULL, logo_type = NULL WHERE id = ?"
    ).bind(now(), u.company_id),
    env.DB.prepare('UPDATE users SET disabled = 1 WHERE company_id = ?').bind(u.company_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').bind(
      u.company_id
    ),
    env.DB.prepare("UPDATE tokens SET used = 1 WHERE company_id = ? AND kind = 'invite'").bind(u.company_id),
  ]);
  return page(
    env,
    'Account closed',
    `<div class="card"><h1>Account closed</h1><p>${esc(u.company_name)}'s subscription has ended and everyone has been signed out. Team details will be deleted in 90 days. To reopen within that time, contact ${esc(env.SUPPORT_EMAIL || 'support')}.</p></div>`,
    null,
    200,
    '',
    clearCookie
  );
}
export function font(name) {
  if (name === 'fonts.css')
    return new Response(FONT_CSS, {
      headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=86400' },
    });
  const b = FONTS[name];
  if (!b) return new Response('Not found', { status: 404 });
  return new Response(b, {
    headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}
export function about(env, u) {
  const y = new Date().getFullYear();
  return page(
    env,
    'Data sources',
    `<div class="card"><h1>Data sources</h1>
<h3>Drawings</h3><p>Traffic management drawings come from your own CAD WerX account, or are PDFs you upload. Their map data and licence credits are printed on the drawing itself and must be kept.</p>
<h3>Job maps</h3><p>Map tiles: © OpenStreetMap contributors, available under the Open Database Licence (<a href="https://www.openstreetmap.org/copyright">openstreetmap.org/copyright</a>).</p>
<p>Postcode lookup: postcodes.io, from ONS and OS open data. Contains OS data © Crown copyright and database right ${y}; contains Royal Mail data © Royal Mail copyright and database right ${y}; contains National Statistics data © Crown copyright and database right ${y}.</p>
<p>Nearest A&amp;E suggestions: NHS organisation data (NHS England), Open Government Licence v3.0. Always check the route before relying on it.</p>
<h3>Fonts</h3><p>Barlow, Barlow Condensed and JetBrains Mono, SIL Open Font Licence 1.1, served from this site.</p></div>`,
    u
  );
}
