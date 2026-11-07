// A read-only link the office can give a client: the job pack and its files, until the link expires or is switched off.
import { now, sha256 } from '../lib/core.js';
import { serve } from './files.js';
import { evidencePack } from './pack.js';

export async function shareRoute(env, url) {
  const m = /^\/share\/([A-Za-z0-9_-]{20,100})(\/.*)?$/.exec(url.pathname);
  if (!m) return null;
  const j = await env.DB.prepare('SELECT * FROM tm_jobs WHERE share_hash = ? AND share_expires > ?')
    .bind(await sha256(m[1]), now())
    .first();
  if (!j)
    return new Response('This link has expired or been switched off. Ask the company that sent it for a new one.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  const rest = m[2] || '/',
    base = `/share/${m[1]}`;
  if (rest === '/') return evidencePack(env, { company_id: j.company_id }, j, { base, title: 'Job record' });
  const f = /^\/file\/(photo|drawing|signature)\/([\w-]{1,64})$/.exec(rest);
  if (rest === '/logo') {
    const c = await env.DB.prepare('SELECT logo_type FROM companies WHERE id = ?').bind(j.company_id).first();
    return c && c.logo_type
      ? serve(env, 'logos/' + j.company_id, c.logo_type)
      : new Response('Not found', { status: 404 });
  }
  if (!f) return new Response('Not found', { status: 404 });
  if (f[1] === 'photo') {
    const p = await env.DB.prepare('SELECT * FROM tm_photos WHERE id = ? AND job_id = ? AND company_id = ?')
      .bind(f[2], j.id, j.company_id)
      .first();
    return p ? serve(env, p.r2_key, p.mime) : new Response('Not found', { status: 404 });
  }
  if (f[1] === 'drawing') {
    const d = await env.DB.prepare('SELECT * FROM tm_drawings WHERE id = ? AND job_id = ? AND company_id = ?')
      .bind(f[2], j.id, j.company_id)
      .first();
    return d
      ? serve(env, d.pdf_key, 'application/pdf', `drawing-${d.rev}.pdf`)
      : new Response('Not found', { status: 404 });
  }
  const e = await env.DB.prepare('SELECT signature FROM tm_events WHERE id = ? AND job_id = ? AND company_id = ?')
    .bind(f[2], j.id, j.company_id)
    .first();
  const s = e && /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(e.signature || '');
  return s
    ? new Response(
        Uint8Array.from(atob(s[2]), c => c.charCodeAt(0)),
        { headers: { 'Content-Type': s[1], 'Content-Security-Policy': "default-src 'none'; sandbox" } }
      )
    : new Response('Not found', { status: 404 });
}
