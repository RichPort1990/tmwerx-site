// The operator view: every customer and the signed agreements.
import { esc, msg, page } from './pages.js';
import { ACTIVE, emailOk, now, redirect } from './lib/core.js';
import { storeLogo } from './account.js';

/* ---------- operator view: every customer, and the signed agreements as CSV ---------- */
export async function admin(env, u, url) {
  if (!u || !u.super) return page(env, 'Not found', `<div class="card"><h1>Page not found</h1></div>`, u, 404);
  const rows = await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM users x WHERE x.company_id = c.id AND x.disabled = 0) AS users,
    (SELECT email FROM users x WHERE x.company_id = c.id AND x.role = 'admin' ORDER BY created_at LIMIT 1) AS admin_email,
    (SELECT COUNT(*) FROM tm_jobs j WHERE j.company_id = c.id) AS jobs FROM companies c ORDER BY created_at DESC LIMIT 500`
  ).all();
  const ex = await env.DB.prepare('SELECT * FROM domain_exempt ORDER BY created_at DESC')
    .all()
    .catch(() => ({ results: [] }));
  const active = rows.results.filter(r => ACTIVE.has(r.sub_status) && !r.closed_at);
  const css = `<style>.big{font:700 40px/1 var(--display);margin:4px 0 2px}.meter{position:relative;height:18px;background:#2b3138;border-radius:3px;margin:14px 0 26px}.meter i{position:absolute;left:0;top:0;bottom:0;background:#e3e6e9;border-radius:3px}.meter b{position:absolute;top:-4px;bottom:-4px;width:2px;background:#f26b1d}.meter span{position:absolute;top:22px;font-size:12px;color:var(--muted);transform:translateX(-50%);white-space:nowrap}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:8px}.stats div{border-left:3px solid #f26b1d;padding:2px 0 2px 10px}.stats strong{display:block;font:700 22px/1.2 var(--display)}.chart{width:100%;height:120px;display:block}.axis{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}td.n,th.n{text-align:right}</style>`;
  return page(
    env,
    'Admin',
    `${css}<h1>Admin</h1>
<div class="card" id="customers"><h2>Customers</h2>${{ ok: msg('Logo saved for that customer.', 'ok'), none: msg('That customer was not found.'), file: msg('Choose a PNG or JPEG file.'), imgType: msg('Logos must be PNG or JPEG.'), imgSize: msg('Logos must be 1 MB or less.'), imgBad: msg("That file isn't a valid PNG or JPEG.") }[url.searchParams.get('logo')] || ''}<div class="stats"><div><strong>${active.length}</strong>Active subscriptions</div><div><strong>${active.reduce((a, r) => a + (r.seats_paid || 0), 0)}</strong>Paid seats</div><div><strong>${rows.results.reduce((a, r) => a + (r.users || 0), 0)}</strong>Users</div></div>
<table style="margin-top:14px"><tr><th>Company</th><th>Domain</th><th>Admin</th><th>Users</th><th>Paid seats</th><th>Status</th><th>Jobs</th><th>Since</th><th>Logo</th></tr>${rows.results.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.domain || (r.domain_claim ? r.domain_claim + ' (held once paying)' : '—'))}</td><td>${esc(r.admin_email || '')}</td><td>${r.users}</td><td>${r.seats_paid || 0}</td><td>${esc(r.sub_status)}</td><td>${r.jobs || 0}</td><td>${new Date(r.created_at).toLocaleDateString('en-GB')}</td><td>${r.closed_at ? '' : `<form method="post" action="/admin/logo" enctype="multipart/form-data" class="logoup"><input type="hidden" name="c" value="${esc(r.id)}"><span class="muted">${r.logo_type ? 'Has a logo' : 'None'}</span> <input type="file" name="logo" accept="image/png,image/jpeg" required aria-label="Logo for ${esc(r.name)}"><button class="sec" type="submit">Upload</button></form>`}</td></tr>`).join('')}</table>
<p><a href="/admin/acceptances.csv">Download every signed agreement (CSV)</a></p></div>
<div class="card"><h2>Separate organisations</h2><p class="muted">Once someone from a company's email domain has signed up, colleagues from that domain are added by its administrator. To let one address start its own organisation instead (another company or branch on the same domain), add it here before they sign up.</p>
<form method="post" action="/admin/exempt"><label for="xemail">Email address</label><input id="xemail" name="email" type="email" required><button type="submit">Allow a separate organisation</button></form>
${ex.results.length ? `<table style="margin-top:14px"><tr><th>Address</th><th>Added</th><th></th></tr>${ex.results.map(x => `<tr><td>${esc(x.email)}</td><td>${new Date(x.created_at).toLocaleDateString('en-GB')}</td><td><form method="post" action="/admin/exempt"><input type="hidden" name="email" value="${esc(x.email)}"><input type="hidden" name="remove" value="1"><button class="sec" type="submit">Remove</button></form></td></tr>`).join('')}</table>` : ''}</div>`,
    u
  );
}
// TM WerX's own operators set a customer's logo for them (for customers who haven't uploaded their own)
export async function adminLogo(env, M, F, u) {
  if (!u || !u.super || M !== 'POST' || !F) return redirect('/admin');
  const id = String(F.get('c') || '').slice(0, 64);
  const c = await env.DB.prepare('SELECT id FROM companies WHERE id = ? AND closed_at IS NULL').bind(id).first();
  if (!c) return redirect('/admin?logo=none#customers');
  const e = await storeLogo(env, id, F.get('logo'));
  return redirect('/admin?logo=' + (e || 'ok') + '#customers');
}
export async function adminExempt(env, M, f, u) {
  if (!u || !u.super || M !== 'POST') return redirect('/admin');
  const email = f('email').toLowerCase();
  if (emailOk(email)) {
    if (f('remove')) await env.DB.prepare('DELETE FROM domain_exempt WHERE email = ?').bind(email).run();
    else
      await env.DB.prepare('INSERT OR IGNORE INTO domain_exempt (email, created_at) VALUES (?, ?)')
        .bind(email, now())
        .run();
  }
  return redirect('/admin');
}
export async function adminCsv(env, u) {
  if (!u || !u.super) return new Response('Not found', { status: 404 });
  const rows = (await env.DB.prepare('SELECT * FROM acceptances ORDER BY accepted_at').all()).results;
  const q = v => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }; // no spreadsheet formulas
  const csv = ['accepted_at,company,signed_name,email,role,version,doc_hash,ip,user_agent']
    .concat(
      rows.map(r =>
        [
          new Date(r.accepted_at).toISOString(),
          r.company_name,
          r.signed_name,
          r.email,
          r.role,
          r.version,
          r.doc_hash,
          r.ip,
          r.user_agent,
        ]
          .map(q)
          .join(',')
      )
    )
    .join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="acceptances.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
