// Issued drawings from CAD WerX, through the private service binding CADWERX (never a public address).
// CAD WerX answers only for a company whose administrator made a link code there and pasted it into TM WerX
// (Settings, CAD WerX link), and every call also carries the shared CADWERX_LINK_SECRET.
// The endpoints CAD WerX needs to provide are listed in README.md (Linking CAD WerX).
import { now } from '../lib/core.js';
import { putOnce, sha256buf, sniff } from './files.js';
import { pj, str, uid } from './util.js';

async function linkCode(env, cid) {
  const r = await env.DB.prepare('SELECT data FROM tm_settings WHERE company_id = ?').bind(cid).first();
  return pj(r && r.data, {}).cadwerx_link || null;
}
async function call(env, cid, path, payload) {
  if (!env.CADWERX || !env.CADWERX_LINK_SECRET) return { error: 'CAD WerX is not linked to TM WerX yet.' };
  const code = await linkCode(env, cid);
  if (!code) return { error: 'Link your CAD WerX account first: Settings, CAD WerX link.' };
  const r = await env.CADWERX.fetch('https://cadwerx.internal/internal/tm' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TM-Secret': env.CADWERX_LINK_SECRET, 'X-TM-Link': code },
    body: JSON.stringify(payload || {}),
  });
  if (r.status === 402)
    return {
      error:
        "Your company's CAD WerX subscription isn't active, so drawings can't be taken from CAD WerX. Drawings already on jobs are kept.",
    };
  if (r.status === 403)
    return {
      error:
        'CAD WerX refused the link code. Ask your CAD WerX administrator for a new one (CAD WerX, Account, TM WerX link).',
    };
  if (!r.ok) return { error: `CAD WerX did not answer (${r.status}).` };
  return r;
}
// issued projects matching a search (title, street, town, postcode, client ref or drawing number)
export async function cadwerxSearch(env, u, q) {
  const r = await call(env, u.company_id, '/search', { q: String(q).slice(0, 80) });
  if (r.error) return { error: r.error };
  const j = await r.json();
  return (j.results || []).slice(0, 50);
}
// copy an issued revision into TM WerX: the fixed PDF and its equipment list. The job keeps working even if the
// project is later changed or deleted in CAD WerX.
export async function cadwerxIssue(env, u, job, project, version) {
  const meta = await call(env, u.company_id, '/issue', { project: str(project, 64), version: str(version, 64) });
  if (meta.error) return meta;
  const m = await meta.json();
  if (!m.issued) return { error: 'That revision has not been issued for use in CAD WerX.' };
  const html = m.format === 'html';
  const file = await call(env, u.company_id, html ? '/file' : '/pdf', {
    project: str(project, 64),
    version: str(version, 64),
  });
  if (file.error) return file;
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) return { error: 'The drawing from CAD WerX is too large.' };
  const head = new TextDecoder().decode(buf.slice(0, 15)).toLowerCase();
  if (html ? head !== '<!doctype html>' : sniff(buf) !== 'application/pdf')
    return { error: 'CAD WerX sent something that is not a drawing.' };
  const sha = await sha256buf(buf);
  if (m.sha256 && m.sha256 !== sha)
    return { error: "The drawing changed on its way from CAD WerX (the fingerprints don't match). Try again." };
  const id = uid(),
    key = `co/${u.company_id}/drawings/${id}.${html ? 'html' : 'pdf'}`;
  await putOnce(env, key, buf, html ? 'text/html; charset=utf-8' : 'application/pdf');
  const equipment = (m.equipment || [])
    .map(i => ({ code: str(i.code, 40), name: str(i.name, 120), qty: Math.max(0, Math.round(+i.qty || 0)) }))
    .filter(i => i.name);
  await env.DB.prepare(
    "INSERT INTO tm_drawings (id, company_id, job_id, rev, source, cad_project, cad_version, drawing_no, approved_by, approved_at, pdf_key, sha256, pages, equipment, created_by, created_at) VALUES (?, ?, ?, ?, 'cadwerx', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      u.company_id,
      job.id,
      str(m.rev, 20) || '?',
      str(project, 64),
      str(version, 64),
      str(m.drawing_no, 60),
      str(m.approved_by, 120),
      m.approved_at || null,
      key,
      sha,
      m.pages || null,
      JSON.stringify(equipment),
      u.id,
      now()
    )
    .run();
  // fill in what the job doesn't have yet from the drawing's details
  const fill = {
    address: m.street,
    town: m.town,
    postcode: m.postcode,
    usrn: m.usrn,
    client_ref: m.client_ref,
    hours: m.hours,
    w3w: m.w3w,
    tm_type: m.tm_type,
    start_date: m.start_date,
    end_date: m.end_date,
    lat: m.lat,
    lng: m.lng,
  };
  const cols = Object.keys(fill).filter(k => fill[k] != null && fill[k] !== '' && (job[k] == null || job[k] === ''));
  if (cols.length)
    await env.DB.prepare(`UPDATE tm_jobs SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`)
      .bind(...cols.map(c => (typeof fill[c] === 'number' ? fill[c] : str(fill[c], 300))), job.id)
      .run();
  return { id, rev: m.rev, sha256: sha, equipment };
}
