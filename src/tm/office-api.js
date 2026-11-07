// The office web app's API: jobs, visits, crews, drawings, documents, rules, requests, alerts, time, safety and costs.
import { hashPassword } from '../auth.js';
import { json, now, randToken, readBody, sha256 } from '../lib/core.js';
import { cadwerxIssue, cadwerxSearch } from './cadwerx.js';
import { insertEvent } from './events.js';
import { PDF_MAX, PHOTO_MAX, ext, putOnce, serve, sha256buf, sniff } from './files.js';
import { addIntake, extractRequest, parseEmail } from './intake.js';
import { evidencePack } from './pack.js';
import { pushTo } from './push.js';
import { makeRouter } from './router.js';
import { STARTER, STARTER_RULES, TM_TYPES, VISIT_KINDS, PHOTO_CATS } from './starter.js';
import {
  ukDate,
  DEFAULT_SETTINGS,
  bad,
  body,
  int,
  isDate,
  isTime,
  log,
  logStmt,
  nextJobNumber,
  num,
  officeUser,
  ok,
  pj,
  settings,
  str,
  uid,
} from './util.js';

const R = makeRouter();

// an id the browser sent, kept only if that row is this company's (and, for visits, this job's)
async function own(env, u, table, id, jobId) {
  id = str(id, 64);
  if (!id) return null;
  const r = await env.DB.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? AND company_id = ?${jobId ? ' AND job_id = ?' : ''}`
  )
    .bind(...[id, u.company_id, ...(jobId ? [jobId] : [])])
    .first();
  return r ? id : null;
}

/* ---------- first use: starter documents, photo rules and settings ---------- */
export async function ensureCompany(env, u) {
  const has = await env.DB.prepare('SELECT 1 FROM tm_settings WHERE company_id = ?').bind(u.company_id).first();
  if (has) return;
  const q = [
    env.DB.prepare(
      'INSERT OR IGNORE INTO tm_settings (company_id, data, intake_key, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(
      u.company_id,
      '{}',
      randToken()
        .slice(0, 10)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, 'x'),
      now()
    ),
  ];
  for (const [kind, c] of Object.entries(STARTER))
    q.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO tm_docs (id, company_id, kind, version, title, content, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)'
      ).bind(uid(), u.company_id, kind, c.title, JSON.stringify(c), 'starter', now())
    );
  for (const r of STARTER_RULES)
    q.push(
      env.DB.prepare(
        "INSERT INTO tm_photo_rules (id, company_id, name, scope, trig, event, grace_mins, label, count, escalate_mins, created_at) VALUES (?, ?, ?, 'company', ?, ?, ?, ?, ?, 30, ?)"
      ).bind(uid(), u.company_id, r.name, r.trig, r.event, r.grace_mins, r.label, r.count, now())
    );
  await env.DB.batch(q);
}

const docsNow = async (env, cid) =>
  (
    await env.DB.prepare(
      'SELECT d.*, x.name AS reviewer FROM tm_docs d LEFT JOIN users x ON x.id = d.reviewed_by WHERE d.company_id = ? AND d.version = (SELECT MAX(version) FROM tm_docs y WHERE y.company_id = d.company_id AND y.kind = d.kind)'
    )
      .bind(cid)
      .all()
  ).results.map(d => Object.assign(d, { content: pj(d.content, {}) }));

R.add('GET', '/boot', async (env, u) => {
  await ensureCompany(env, u);
  const [people, vehicles, clients, docs, rules, s, counts, key] = await Promise.all([
    env.DB.prepare(
      'SELECT id, name, email, username, role, phone, day_cost, disabled, installed_at, push_ok, last_seen, created_at FROM users WHERE company_id = ? ORDER BY disabled, role, name'
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_vehicles WHERE company_id = ? ORDER BY reg').bind(u.company_id).all(),
    env.DB.prepare('SELECT * FROM tm_clients WHERE company_id = ? ORDER BY archived, name').bind(u.company_id).all(),
    docsNow(env, u.company_id),
    env.DB.prepare('SELECT * FROM tm_photo_rules WHERE company_id = ? ORDER BY active DESC, created_at')
      .bind(u.company_id)
      .all(),
    settings(env, u.company_id),
    env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM tm_alerts WHERE company_id = ?1 AND ack_at IS NULL) AS alerts, (SELECT COUNT(*) FROM tm_intake WHERE company_id = ?1 AND status = 'new') AS requests"
    )
      .bind(u.company_id)
      .first(),
    env.DB.prepare('SELECT intake_key FROM tm_settings WHERE company_id = ?').bind(u.company_id).first(),
  ]);
  return ok({
    me: { id: u.id, name: u.name, email: u.email, role: u.role, company: u.company_name, logo: !!u.logo_type },
    people: people.results,
    vehicles: vehicles.results,
    clients: clients.results,
    docs,
    rules: rules.results,
    settings: s,
    counts,
    intake_address: key ? `jobs+${key.intake_key}@${env.INTAKE_DOMAIN || 'tmwerx.co.uk'}` : null,
    tm_types: TM_TYPES,
    visit_kinds: VISIT_KINDS,
    photo_cats: PHOTO_CATS,
    cadwerx: !!env.CADWERX,
  });
});

/* ---------- jobs ---------- */
const JOB_FIELDS = {
  title: 200,
  client_ref: 100,
  address: 300,
  town: 100,
  postcode: 12,
  usrn: 20,
  w3w: 80,
  tm_type: 40,
  permit_ref: 60,
  hours: 100,
  site_contact: 200,
  nearest_ae: 300,
  instructions: 4000,
  charge_basis: 10,
};
function jobPatch(b) {
  const o = {};
  for (const [k, max] of Object.entries(JOB_FIELDS)) if (k in b) o[k] = str(b[k], max);
  if ('postcode' in o && o.postcode) o.postcode = o.postcode.toUpperCase();
  if ('charge_basis' in o && !['daily', 'hourly', 'fixed'].includes(o.charge_basis)) delete o.charge_basis;
  for (const k of ['start_date', 'end_date', 'permit_end']) if (k in b) o[k] = isDate(b[k]) ? b[k] : null;
  if ('lat' in b) o.lat = num(b.lat);
  if ('lng' in b) o.lng = num(b.lng);
  if ('client_id' in b) o.client_id = str(b.client_id, 64);
  if ('client_rate' in b)
    o.client_rate = b.client_rate === '' || b.client_rate == null ? null : int(b.client_rate, 0, 1e9);
  if ('hazards' in b)
    o.hazards = JSON.stringify(
      (Array.isArray(b.hazards) ? b.hazards : [])
        .map(h => str(h, 200))
        .filter(Boolean)
        .slice(0, 60)
    );
  return o;
}
// fill in a position for the postcode, if we have none (postcodes.io, open data)
async function locate(o) {
  if (o.postcode && (o.lat == null || o.lng == null)) {
    try {
      const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(o.postcode.replace(/\s+/g, '')));
      if (r.ok) {
        const j = await r.json();
        if (j.result) {
          o.lat = j.result.latitude;
          o.lng = j.result.longitude;
        }
      }
    } catch (e) {
      // offline or not found: the office can still drop a pin
    }
  }
}
R.add('GET', '/jobs', async (env, u, req, p, url) => {
  const st = url.searchParams.get('status') || '',
    q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const where = ['j.company_id = ?'],
    args = [u.company_id];
  if (st === 'open') where.push("j.status IN ('scheduled','in_progress')");
  else if (st) {
    where.push('j.status = ?');
    args.push(st);
  }
  if (q) {
    where.push(
      '(j.number LIKE ?1x OR j.address LIKE ?1x OR j.postcode LIKE ?1x OR j.client_ref LIKE ?1x OR j.title LIKE ?1x OR c.name LIKE ?1x)'.replace(
        /\?1x/g,
        '?'
      )
    );
    for (let i = 0; i < 6; i++) args.push('%' + q + '%');
  }
  const rows = (
    await env.DB.prepare(
      `SELECT j.*, c.name AS client_name, (SELECT MIN(date) FROM tm_visits v WHERE v.job_id = j.id AND v.status <> 'cancelled' AND v.date >= date('now')) AS next_visit,
        (SELECT COUNT(*) FROM tm_alerts a WHERE a.job_id = j.id AND a.ack_at IS NULL) AS alerts
       FROM tm_jobs j LEFT JOIN tm_clients c ON c.id = j.client_id WHERE ${where.join(' AND ')} ORDER BY COALESCE(j.start_date, '9999') DESC, j.created_at DESC LIMIT 300`
    )
      .bind(...args)
      .all()
  ).results;
  return ok({ jobs: rows.map(j => Object.assign(j, { hazards: pj(j.hazards, []) })) });
});
R.add('POST', '/jobs', async (env, u, req) => {
  const b = await body(req);
  if (!b) return bad('bad request');
  const o = jobPatch(b);
  if (!o.address && !o.title) return bad('Give the job a site address or a title.');
  if (
    o.client_id &&
    !(await env.DB.prepare('SELECT 1 FROM tm_clients WHERE id = ? AND company_id = ?')
      .bind(o.client_id, u.company_id)
      .first())
  )
    return bad('unknown client');
  await locate(o);
  const id = uid(),
    number = await nextJobNumber(env, u.company_id);
  const cols = Object.keys(o);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tm_jobs (id, company_id, number, source, intake_id, created_by, created_at, updated_at${cols.map(c => ', ' + c).join('')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?${cols.map(() => ', ?').join('')})`
    ).bind(
      id,
      u.company_id,
      number,
      ['manual', 'request'].includes(b.source) ? b.source : 'manual',
      str(b.intake_id, 64),
      u.id,
      now(),
      now(),
      ...cols.map(c => o[c])
    ),
    logStmt(env, u, 'job created', id, number),
  ]);
  return ok({ id, number });
});
async function getJob(env, u, id) {
  return env.DB.prepare('SELECT * FROM tm_jobs WHERE id = ? AND company_id = ?').bind(id, u.company_id).first();
}
R.add('GET', '/jobs/:id', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const [visits, assign, drawings, events, photos, tasks, alerts, logs, client] = await Promise.all([
    env.DB.prepare('SELECT * FROM tm_visits WHERE job_id = ? AND company_id = ? ORDER BY date, start_time')
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT a.*, x.name, x.role FROM tm_assign a JOIN users x ON x.id = a.user_id JOIN tm_visits v ON v.id = a.visit_id WHERE v.job_id = ? AND a.company_id = ?'
    )
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT d.*, x.name AS by_name FROM tm_drawings d LEFT JOIN users x ON x.id = d.created_by WHERE d.job_id = ? AND d.company_id = ? ORDER BY d.created_at'
    )
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT e.id, e.visit_id, e.vehicle_id, e.user_id, e.kind, e.data, e.signature IS NOT NULL AS signed, e.lat, e.lng, e.acc, e.client_time, e.server_time, e.skew, e.by_office, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.job_id = ? AND e.company_id = ? ORDER BY COALESCE(e.client_time, e.server_time)'
    )
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT p.*, x.name AS user_name FROM tm_photos p JOIN users x ON x.id = p.user_id WHERE p.job_id = ? AND p.company_id = ? ORDER BY p.taken_at'
    )
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_photo_tasks WHERE job_id = ? AND company_id = ? ORDER BY due_at')
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_alerts WHERE job_id = ? AND company_id = ? ORDER BY created_at DESC')
      .bind(j.id, u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT l.*, x.name FROM tm_log l LEFT JOIN users x ON x.id = l.user_id WHERE l.ref = ? AND l.company_id = ? ORDER BY l.at DESC LIMIT 100'
    )
      .bind(j.id, u.company_id)
      .all(),
    j.client_id ? env.DB.prepare('SELECT * FROM tm_clients WHERE id = ?').bind(j.client_id).first() : null,
  ]);
  return ok({
    job: Object.assign(j, {
      hazards: pj(j.hazards, []),
      client_name: client && client.name,
      changed: j.sent_version > 0 && j.version > j.sent_version,
    }),
    visits: visits.results.map(v =>
      Object.assign(v, { vehicle_ids: pj(v.vehicle_ids, []), crew: assign.results.filter(a => a.visit_id === v.id) })
    ),
    drawings: drawings.results.map(d => Object.assign(d, { equipment: pj(d.equipment, []) })),
    events: events.results.map(e => Object.assign(e, { data: pj(e.data, {}) })),
    photos: photos.results,
    tasks: tasks.results,
    alerts: alerts.results,
    log: logs.results,
  });
});
// changes the crew should see bump the version, so the phones show "Updated" once it is sent
const bump = (env, id) =>
  env.DB.prepare('UPDATE tm_jobs SET version = version + 1, updated_at = ? WHERE id = ?').bind(now(), id);
R.add('PUT', '/jobs/:id', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const b = await body(req);
  if (!b) return bad('bad request');
  const o = jobPatch(b);
  if (
    o.client_id &&
    !(await env.DB.prepare('SELECT 1 FROM tm_clients WHERE id = ? AND company_id = ?')
      .bind(o.client_id, u.company_id)
      .first())
  )
    return bad('unknown client');
  if (o.postcode && o.postcode !== j.postcode && !('lat' in b)) {
    o.lat = null;
    o.lng = null;
  }
  await locate(o);
  const cols = Object.keys(o).filter(k => String(o[k] ?? '') !== String(j[k] ?? ''));
  if (!cols.length) return ok({ changed: false });
  const crewSees = cols.some(c => !['client_rate', 'charge_basis', 'client_id'].includes(c));
  await env.DB.batch([
    env.DB.prepare(`UPDATE tm_jobs SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(
      ...cols.map(c => o[c]),
      now(),
      j.id
    ),
    ...(crewSees ? [bump(env, j.id)] : []),
    logStmt(env, u, 'job changed', j.id, cols.join(', ')),
  ]);
  return ok({ changed: true });
});
// whose phones a job reaches: everyone on any of its visits
const jobCrew = async (env, jobId) =>
  (
    await env.DB.prepare(
      'SELECT DISTINCT a.user_id FROM tm_assign a JOIN tm_visits v ON v.id = a.visit_id WHERE v.job_id = ?'
    )
      .bind(jobId)
      .all()
  ).results.map(r => r.user_id);
R.add('POST', '/jobs/:id/send', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const crew = await jobCrew(env, j.id);
  if (!crew.length) return bad('Allocate a crew to at least one visit first.');
  const first = !j.sent_version;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE tm_jobs SET sent_version = version, sent_at = ?, removed_at = NULL, status = CASE WHEN status = 'cancelled' THEN 'scheduled' ELSE status END WHERE id = ?"
    ).bind(now(), j.id),
    logStmt(env, u, first ? 'job sent' : 'update sent', j.id, `version ${j.version}`),
  ]);
  const n = await pushTo(env, crew, {
    title: first ? `New job: ${j.number}` : `Job updated: ${j.number}`,
    body: `${j.address || j.title || ''}${j.start_date ? ' · ' + j.start_date : ''}`,
    url: `/crew/#job/${j.id}`,
    tag: 'job-' + j.id,
  });
  return ok({ pushed: n });
});
R.add('POST', '/jobs/:id/remove', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const crew = await jobCrew(env, j.id);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE tm_jobs SET removed_at = ?, status = 'cancelled', version = version + 1, sent_version = version + 1, updated_at = ? WHERE id = ?"
    ).bind(now(), now(), j.id),
    env.DB.prepare(
      "UPDATE tm_visits SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status = 'scheduled'"
    ).bind(now(), j.id),
    logStmt(env, u, 'removed from phones', j.id, null),
  ]);
  await pushTo(env, crew, {
    title: `Job removed: ${j.number}`,
    body: "Don't attend unless the office tells you to.",
    url: `/crew/#job/${j.id}`,
    tag: 'job-' + j.id,
    urgent: true,
  });
  return ok();
});
R.add('POST', '/jobs/:id/status', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  const b = await body(req);
  if (!j || !b || !['scheduled', 'in_progress', 'completed', 'cancelled'].includes(b.status)) return bad('bad request');
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_jobs SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, now(), j.id),
    logStmt(env, u, 'status set', j.id, b.status),
  ]);
  return ok();
});
// a note or correction from the office goes into the job's records (never changes what the crew sent)
R.add('POST', '/jobs/:id/note', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  const b = await body(req);
  if (!j || !b || !str(b.text, 2000)) return bad('bad request');
  await insertEvent(env, {
    id: uid(),
    company_id: u.company_id,
    job_id: j.id,
    visit_id: await own(env, u, 'tm_visits', b.visit_id, j.id),
    vehicle_id: null,
    user_id: u.id,
    kind: 'note',
    data: JSON.stringify({ text: str(b.text, 2000), correction: !!b.correction }),
    signature: null,
    lat: null,
    lng: null,
    acc: null,
    client_time: now(),
    server_time: now(),
    skew: 0,
    by_office: 1,
  }).run();
  return ok();
});
R.add('POST', '/jobs/:id/share', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const b = (await body(req)) || {};
  if (b.off) {
    await env.DB.prepare('UPDATE tm_jobs SET share_hash = NULL, share_expires = NULL WHERE id = ?').bind(j.id).run();
    await log(env, u, 'share link off', j.id);
    return ok();
  }
  const t = randToken(),
    days = Math.max(1, Math.min(90, int(b.days, 1, 90) || 30));
  await env.DB.prepare('UPDATE tm_jobs SET share_hash = ?, share_expires = ? WHERE id = ?')
    .bind(await sha256(t), now() + days * 864e5, j.id)
    .run();
  await log(env, u, 'share link made', j.id, `${days} days`);
  return ok({ url: `/share/${t}`, expires: now() + days * 864e5 });
});

/* ---------- drawings: an uploaded PDF, or an issued CAD WerX drawing ---------- */
function cleanEquipment(list) {
  return (Array.isArray(list) ? list : [])
    .map(i => ({ code: str(i.code, 40), name: str(i.name, 120), qty: int(i.qty, 0, 100000) }))
    .filter(i => i.name && i.qty != null)
    .slice(0, 300);
}
R.add('POST', '/jobs/:id/drawing', async (env, u, req, p, url) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const buf = await readBody(req, PDF_MAX);
  if (!buf) return bad('The PDF must be 25 MB or smaller.', 413);
  if (sniff(buf) !== 'application/pdf') return bad('That file is not a PDF.');
  const rev = (str(url.searchParams.get('rev'), 20) || 'A').replace(/[^\w.-]/g, '_');
  let equipment = [];
  try {
    equipment = cleanEquipment(JSON.parse(decodeURIComponent(req.headers.get('X-Equipment') || '[]')));
  } catch (e) {
    equipment = [];
  }
  const id = uid(),
    sha = await sha256buf(buf),
    key = `co/${u.company_id}/drawings/${id}.pdf`;
  await putOnce(env, key, buf, 'application/pdf');
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tm_drawings (id, company_id, job_id, rev, source, drawing_no, pdf_key, sha256, equipment, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      u.company_id,
      j.id,
      rev,
      'pdf',
      str(url.searchParams.get('no'), 60),
      key,
      sha,
      JSON.stringify(equipment),
      str(url.searchParams.get('note'), 300),
      u.id,
      now()
    ),
    // future visits move to the new drawing; visits under way keep theirs until the office applies it to them
    env.DB.prepare(
      "UPDATE tm_visits SET drawing_id = ?, updated_at = ? WHERE job_id = ? AND status = 'scheduled'"
    ).bind(id, now(), j.id),
    bump(env, j.id),
    logStmt(env, u, 'drawing added', j.id, `rev ${rev}, ${sha.slice(0, 12)}`),
  ]);
  return ok({ id, sha256: sha });
});
R.add('PUT', '/drawings/:id/equipment', async (env, u, req, p) => {
  const d = await env.DB.prepare('SELECT * FROM tm_drawings WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const b = await body(req);
  if (!d || !b) return bad('not found', 404);
  if (d.source === 'cadwerx')
    return bad("A CAD WerX drawing's list comes from CAD WerX: issue a new revision there to change it.");
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_drawings SET equipment = ? WHERE id = ?').bind(
      JSON.stringify(cleanEquipment(b.equipment)),
      d.id
    ),
    bump(env, d.job_id),
    logStmt(env, u, 'equipment list changed', d.job_id, `rev ${d.rev}`),
  ]);
  return ok();
});
R.add('POST', '/visits/:id/apply-drawing', async (env, u, req, p) => {
  const b = await body(req);
  const v = await env.DB.prepare('SELECT * FROM tm_visits WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const d =
    b &&
    (await env.DB.prepare('SELECT * FROM tm_drawings WHERE id = ? AND company_id = ? AND job_id = ?')
      .bind(b.drawing_id, u.company_id, v && v.job_id)
      .first());
  if (!v || !d) return bad('not found', 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_visits SET drawing_id = ?, updated_at = ? WHERE id = ?').bind(d.id, now(), v.id),
    bump(env, v.job_id),
    logStmt(env, u, 'drawing applied to visit', v.job_id, `${v.date}: rev ${d.rev}`),
  ]);
  const crew = (await env.DB.prepare('SELECT user_id FROM tm_assign WHERE visit_id = ?').bind(v.id).all()).results.map(
    r => r.user_id
  );
  await pushTo(env, crew, {
    title: 'New drawing revision',
    body: `Rev ${d.rev}: open the job and confirm you've seen it before carrying on.`,
    url: `/crew/#job/${v.job_id}`,
    urgent: true,
    tag: 'drawing-' + v.id,
  });
  return ok();
});
R.add('GET', '/cadwerx/search', async (env, u, req, p, url) => {
  const r = await cadwerxSearch(env, u, url.searchParams.get('q') || '');
  return Array.isArray(r) ? ok({ results: r }) : ok({ results: [], error: r.error });
});
R.add('POST', '/jobs/:id/cadwerx', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  const b = await body(req);
  if (!j || !b) return bad('not found', 404);
  const r = await cadwerxIssue(env, u, j, b.project, b.version);
  if (r.error) return bad(r.error);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE tm_visits SET drawing_id = ?, updated_at = ? WHERE job_id = ? AND status = 'scheduled'"
    ).bind(r.id, now(), j.id),
    env.DB.prepare("UPDATE tm_jobs SET source = 'cadwerx' WHERE id = ?").bind(j.id),
    bump(env, j.id),
    logStmt(env, u, 'CAD WerX drawing added', j.id, `rev ${r.rev}`),
  ]);
  return ok(r);
});

/* ---------- visits and crews ---------- */
async function visitPatch(env, u, b, v) {
  const o = {};
  if ('date' in b) {
    if (!isDate(b.date)) return { error: 'Choose a date.' };
    o.date = b.date;
  }
  for (const k of ['start_time', 'end_time']) if (k in b) o[k] = isTime(b[k]) ? b[k] : null;
  if ('kind' in b) o.kind = VISIT_KINDS.includes(b.kind) ? b.kind : 'other';
  if ('notes' in b) o.notes = str(b.notes, 2000);
  if ('client_rate' in b)
    o.client_rate = b.client_rate === '' || b.client_rate == null ? null : int(b.client_rate, 0, 1e9);
  if ('status' in b && ['scheduled', 'in_progress', 'completed', 'cancelled', 'failed'].includes(b.status))
    o.status = b.status;
  if ('vehicle_ids' in b) {
    const ids = (Array.isArray(b.vehicle_ids) ? b.vehicle_ids : []).map(x => String(x)).slice(0, 10);
    if (ids.length) {
      const vs = (
        await env.DB.prepare(
          `SELECT id, reg, unsafe, off_road FROM tm_vehicles WHERE company_id = ? AND id IN (SELECT value FROM json_each(?))`
        )
          .bind(u.company_id, JSON.stringify(ids))
          .all()
      ).results;
      if (vs.length !== ids.length) return { error: 'unknown vehicle' };
      const no = vs.filter(x => x.unsafe || x.off_road);
      if (
        no.length &&
        !(
          v &&
          pj(v.vehicle_ids, []).every(id => ids.includes(id)) &&
          no.every(x => pj(v.vehicle_ids, []).includes(x.id))
        )
      )
        return {
          error: `${no.map(x => x.reg).join(', ')} ${no.length > 1 ? 'are' : 'is'} off road or reported not safe. Clear it under Vehicles first.`,
        };
    }
    o.vehicle_ids = JSON.stringify(ids);
  }
  return { o };
}
// crew for a visit: [{user_id, lead, cost}], with warnings for clashes and missing or expired qualifications
async function setCrew(env, u, visit, crew) {
  const list = (Array.isArray(crew) ? crew : []).slice(0, 20).map(c => ({
    id: String(c.user_id || c.id),
    lead: !!c.lead,
    cost: c.cost === '' || c.cost == null ? null : int(c.cost, 0, 1e8),
  }));
  const ids = list.map(c => c.id);
  const ppl = ids.length
    ? (
        await env.DB.prepare(
          `SELECT id, name, day_cost, role, disabled FROM users WHERE company_id = ? AND id IN (SELECT value FROM json_each(?))`
        )
          .bind(u.company_id, JSON.stringify(ids))
          .all()
      ).results
    : [];
  if (ppl.length !== ids.length || ppl.some(x => x.disabled || !['lead', 'engineer'].includes(x.role)))
    return { error: 'Choose crew from your crew logins.' };
  if (list.length && !list.some(c => c.lead)) list[0].lead = true;
  const q = [env.DB.prepare('DELETE FROM tm_assign WHERE visit_id = ?').bind(visit.id)];
  for (const c of list)
    q.push(
      env.DB.prepare('INSERT INTO tm_assign (visit_id, user_id, company_id, lead, cost) VALUES (?, ?, ?, ?, ?)').bind(
        visit.id,
        c.id,
        u.company_id,
        c.lead ? 1 : 0,
        c.cost != null ? c.cost : ((ppl.find(x => x.id === c.id) || {}).day_cost ?? null)
      )
    );
  await env.DB.batch(q);
  const warn = [];
  if (ids.length) {
    const clash = (
      await env.DB.prepare(
        `SELECT x.name, j.number FROM tm_assign a JOIN tm_visits v ON v.id = a.visit_id JOIN tm_jobs j ON j.id = v.job_id JOIN users x ON x.id = a.user_id
         WHERE a.user_id IN (SELECT value FROM json_each(?)) AND v.date = ? AND v.id <> ? AND v.status NOT IN ('cancelled')`
      )
        .bind(JSON.stringify(ids), visit.date, visit.id)
        .all()
    ).results;
    for (const c of clash) warn.push(`${c.name} is also on ${c.number} that day.`);
    const quals = (
      await env.DB.prepare(
        `SELECT q.*, x.name AS person FROM tm_quals q JOIN users x ON x.id = q.user_id WHERE q.company_id = ? AND q.user_id IN (SELECT value FROM json_each(?))`
      )
        .bind(u.company_id, JSON.stringify(ids))
        .all()
    ).results;
    for (const q2 of quals)
      if (q2.expires && q2.expires < visit.date)
        warn.push(`${q2.person}'s ${q2.name} expired on ${q2.expires}, before this visit.`);
  }
  return { warn };
}
R.add('POST', '/jobs/:id/visits', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  const b = await body(req);
  if (!j || !b) return bad('not found', 404);
  const vp = await visitPatch(env, u, b, null);
  if (vp.error) return bad(vp.error);
  if (!vp.o.date) return bad('Choose a date.');
  const d = await env.DB.prepare('SELECT id FROM tm_drawings WHERE job_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(j.id)
    .first();
  const id = uid(),
    o = Object.assign({ kind: 'install', vehicle_ids: '[]' }, vp.o),
    cols = Object.keys(o);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tm_visits (id, company_id, job_id, drawing_id, created_at, updated_at${cols.map(c => ', ' + c).join('')}) VALUES (?, ?, ?, ?, ?, ?${cols.map(() => ', ?').join('')})`
    ).bind(id, u.company_id, j.id, d ? d.id : null, now(), now(), ...cols.map(c => o[c])),
    env.DB.prepare(
      'UPDATE tm_jobs SET start_date = CASE WHEN start_date IS NULL OR start_date > ? THEN ? ELSE start_date END, end_date = CASE WHEN end_date IS NULL OR end_date < ? THEN ? ELSE end_date END WHERE id = ?'
    ).bind(o.date, o.date, o.date, o.date, j.id),
    bump(env, j.id),
    logStmt(env, u, 'visit added', j.id, `${o.date} ${o.kind}`),
  ]);
  const v = { id, date: o.date };
  const r = b.crew ? await setCrew(env, u, v, b.crew) : { warn: [] };
  if (r.error) return bad(r.error);
  return ok({ id, warn: r.warn });
});
R.add('PUT', '/visits/:id', async (env, u, req, p) => {
  const v = await env.DB.prepare('SELECT * FROM tm_visits WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const b = await body(req);
  if (!v || !b) return bad('not found', 404);
  const vp = await visitPatch(env, u, b, v);
  if (vp.error) return bad(vp.error);
  const cols = Object.keys(vp.o);
  if (cols.length)
    await env.DB.batch([
      env.DB.prepare(`UPDATE tm_visits SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(
        ...cols.map(c => vp.o[c]),
        now(),
        v.id
      ),
      bump(env, v.job_id),
      logStmt(env, u, 'visit changed', v.job_id, `${v.date}: ${cols.join(', ')}`),
    ]);
  let warn = [];
  if (b.crew) {
    const r = await setCrew(env, u, Object.assign({}, v, vp.o), b.crew);
    if (r.error) return bad(r.error);
    warn = r.warn;
    await env.DB.batch([bump(env, v.job_id), logStmt(env, u, 'crew changed', v.job_id, v.date)]);
  }
  return ok({ warn });
});
R.add('DELETE', '/visits/:id', async (env, u, req, p) => {
  const v = await env.DB.prepare('SELECT * FROM tm_visits WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!v) return bad('not found', 404);
  const used = await env.DB.prepare('SELECT 1 FROM tm_events WHERE visit_id = ? LIMIT 1').bind(v.id).first();
  if (used) {
    await env.DB.batch([
      env.DB.prepare("UPDATE tm_visits SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now(), v.id),
      bump(env, v.job_id),
      logStmt(env, u, 'visit cancelled', v.job_id, v.date),
    ]);
    return ok({ cancelled: true });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM tm_assign WHERE visit_id = ?').bind(v.id),
    env.DB.prepare('DELETE FROM tm_photo_tasks WHERE visit_id = ?').bind(v.id),
    env.DB.prepare('DELETE FROM tm_visits WHERE id = ?').bind(v.id),
    bump(env, v.job_id),
    logStmt(env, u, 'visit deleted', v.job_id, v.date),
  ]);
  return ok();
});
R.add('POST', '/visits/:id/review', async (env, u, req, p) => {
  const v = await env.DB.prepare('SELECT * FROM tm_visits WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const b = await body(req);
  if (!v || !b || !['approved', 'returned'].includes(b.decision)) return bad('bad request');
  if (b.decision === 'returned' && !str(b.note, 1000)) return bad('Say what needs doing.');
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE tm_visits SET review = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?'
    ).bind(b.decision, str(b.note, 1000), u.id, now(), v.id),
    logStmt(
      env,
      u,
      b.decision === 'approved' ? 'visit approved' : 'visit returned',
      v.job_id,
      `${v.date}${b.note ? ': ' + b.note : ''}`
    ),
  ]);
  if (b.decision === 'returned') {
    const crew = (
      await env.DB.prepare('SELECT user_id FROM tm_assign WHERE visit_id = ?').bind(v.id).all()
    ).results.map(r => r.user_id);
    await pushTo(env, crew, {
      title: 'The office returned a visit',
      body: str(b.note, 200),
      url: `/crew/#job/${v.job_id}`,
    });
  }
  return ok();
});
R.add('POST', '/jobs/:id/photo', async (env, u, req, p, url) => {
  const j = await getJob(env, u, p.id);
  if (!j) return bad('not found', 404);
  const buf = await readBody(req, PHOTO_MAX);
  if (!buf) return bad('too large', 413);
  const mime = sniff(buf);
  if (!mime || mime === 'application/pdf') return bad('Use a JPEG, PNG or WebP image.');
  const id = uid(),
    key = `co/${u.company_id}/photos/${id}.${ext(mime)}`;
  await putOnce(env, key, buf, mime);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO tm_photos (id, company_id, job_id, user_id, category, caption, r2_key, sha256, size, mime, taken_at, received_at, source) VALUES (?, ?, ?, ?, 'For the crew', ?, ?, ?, ?, ?, ?, ?, 'office')"
    ).bind(
      id,
      u.company_id,
      j.id,
      u.id,
      str(url.searchParams.get('caption'), 300),
      key,
      await sha256buf(buf),
      buf.length,
      mime,
      now(),
      now()
    ),
    bump(env, j.id),
    logStmt(env, u, 'office photo added', j.id, null),
  ]);
  return ok({ id });
});

/* ---------- the board and the live view ---------- */
R.add('GET', '/board', async (env, u, req, p, url) => {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : ukDate();
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : from;
  const visits = (
    await env.DB.prepare(
      `SELECT v.*, j.number, j.address, j.town, j.postcode, j.tm_type, j.status AS job_status, j.sent_version, j.version, j.removed_at, c.name AS client_name
       FROM tm_visits v JOIN tm_jobs j ON j.id = v.job_id LEFT JOIN tm_clients c ON c.id = j.client_id WHERE v.company_id = ? AND v.date BETWEEN ? AND ? ORDER BY v.date, v.start_time`
    )
      .bind(u.company_id, from, to)
      .all()
  ).results;
  const assign = visits.length
    ? (
        await env.DB.prepare(
          `SELECT a.*, x.name FROM tm_assign a JOIN users x ON x.id = a.user_id WHERE a.visit_id IN (SELECT value FROM json_each(?))`
        )
          .bind(JSON.stringify(visits.map(v => v.id)))
          .all()
      ).results
    : [];
  return ok({
    visits: visits.map(v =>
      Object.assign(v, { vehicle_ids: pj(v.vehicle_ids, []), crew: assign.filter(a => a.visit_id === v.id) })
    ),
  });
});
R.add('GET', '/live', async (env, u) => {
  const t = ukDate();
  const [jobs, visits, tasks, alerts, crew, locs, lone] = await Promise.all([
    env.DB.prepare(
      "SELECT j.*, c.name AS client_name FROM tm_jobs j LEFT JOIN tm_clients c ON c.id = j.client_id WHERE j.company_id = ? AND j.status = 'in_progress' ORDER BY j.number"
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare(
      "SELECT v.*, j.number, j.address FROM tm_visits v JOIN tm_jobs j ON j.id = v.job_id WHERE v.company_id = ? AND (v.status = 'in_progress' OR (v.date = ? AND v.status NOT IN ('cancelled'))) ORDER BY v.start_time"
    )
      .bind(u.company_id, t)
      .all(),
    env.DB.prepare(
      "SELECT t.*, j.number FROM tm_photo_tasks t JOIN tm_jobs j ON j.id = t.job_id WHERE t.company_id = ? AND (t.status = 'due' OR (t.status = 'missed' AND t.grace_until > ?)) ORDER BY t.due_at"
    )
      .bind(u.company_id, Date.now() - 864e5)
      .all(),
    env.DB.prepare(
      "SELECT a.*, x.name AS user_name, j.number FROM tm_alerts a LEFT JOIN users x ON x.id = a.user_id LEFT JOIN tm_jobs j ON j.id = a.job_id WHERE a.company_id = ? AND a.ack_at IS NULL ORDER BY CASE a.level WHEN 'urgent' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.created_at DESC LIMIT 200"
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare(
      "SELECT id, name, role, last_seen, installed_at, push_ok FROM users WHERE company_id = ? AND role IN ('lead','engineer') AND disabled = 0"
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_locations WHERE company_id = ? AND at > ?')
      .bind(u.company_id, Date.now() - 2 * 3600e3)
      .all(),
    env.DB.prepare('SELECT * FROM tm_lone WHERE company_id = ?').bind(u.company_id).all(),
  ]);
  const vids = visits.results.map(v => v.id);
  const [assign, ev] = vids.length
    ? await Promise.all([
        env.DB.prepare(
          `SELECT a.*, x.name FROM tm_assign a JOIN users x ON x.id = a.user_id WHERE a.visit_id IN (SELECT value FROM json_each(?))`
        )
          .bind(JSON.stringify(vids))
          .all(),
        env.DB.prepare(
          `SELECT visit_id, user_id, kind, client_time, server_time FROM tm_events WHERE company_id = ? AND visit_id IN (SELECT value FROM json_each(?)) ORDER BY server_time`
        )
          .bind(u.company_id, JSON.stringify(vids))
          .all(),
      ])
    : [{ results: [] }, { results: [] }];
  return ok({
    jobs: jobs.results,
    visits: visits.results.map(v =>
      Object.assign(v, {
        crew: assign.results.filter(a => a.visit_id === v.id),
        steps: [...new Set(ev.results.filter(e => e.visit_id === v.id).map(e => e.kind))],
        signed_in: [...new Set(ev.results.filter(e => e.visit_id === v.id && e.kind === 'signin').map(e => e.user_id))],
      })
    ),
    tasks: tasks.results,
    alerts: alerts.results,
    crew: crew.results,
    locations: locs.results,
    lone: lone.results,
    server_time: now(),
  });
});
R.add('POST', '/alerts/:id/ack', async (env, u, req, p) => {
  const a = await env.DB.prepare('SELECT * FROM tm_alerts WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!a) return bad('not found', 404);
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_alerts SET ack_at = ?, ack_by = ? WHERE id = ?').bind(now(), u.id, a.id),
    logStmt(env, u, 'alert dealt with', a.job_id || a.ref, a.title),
  ]);
  return ok();
});
R.add('GET', '/alerts', async (env, u, req, p, url) => {
  const all = url.searchParams.get('all') === '1';
  const rows = (
    await env.DB.prepare(
      `SELECT a.*, x.name AS user_name, y.name AS ack_name, j.number FROM tm_alerts a LEFT JOIN users x ON x.id = a.user_id LEFT JOIN users y ON y.id = a.ack_by LEFT JOIN tm_jobs j ON j.id = a.job_id WHERE a.company_id = ? ${all ? '' : 'AND a.ack_at IS NULL'} ORDER BY a.created_at DESC LIMIT 300`
    )
      .bind(u.company_id)
      .all()
  ).results;
  return ok({ alerts: rows });
});

/* ---------- job requests (forwarded emails and pasted messages) ---------- */
R.add('GET', '/requests', async (env, u, req, p, url) => {
  const st = ['new', 'approved', 'rejected'].includes(url.searchParams.get('status'))
    ? url.searchParams.get('status')
    : 'new';
  const rows = (
    await env.DB.prepare(
      'SELECT * FROM tm_intake WHERE company_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200'
    )
      .bind(u.company_id, st)
      .all()
  ).results;
  return ok({ requests: rows.map(r => Object.assign(r, { extracted: pj(r.extracted, {}) })) });
});
R.add('POST', '/requests', async (env, u, req) => {
  const b = await body(req, 600000);
  let text = b && str(b.text, 500000);
  if (!text) return bad('Paste the message first.');
  let subject = str(b.subject, 300),
    from = str(b.from, 200);
  if (b.source === 'eml') {
    const e = parseEmail(text);
    subject = e.subject.slice(0, 300);
    from = from || e.from.slice(0, 200);
    text = `${e.subject}\n\n${e.text}`;
  }
  const r = await addIntake(env, u.company_id, {
    source: ['whatsapp', 'eml', 'paste', 'email'].includes(b.source) ? b.source : 'paste',
    from,
    subject,
    text: text.slice(0, 100000),
  });
  return ok(r);
});
R.add('POST', '/requests/:id/reject', async (env, u, req, p) => {
  const r = await env.DB.prepare(
    "UPDATE tm_intake SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ? AND company_id = ? AND status = 'new'"
  )
    .bind(u.id, now(), p.id, u.company_id)
    .run();
  return r.meta.changes ? ok() : bad('not found', 404);
});
R.add('POST', '/requests/:id/approved', async (env, u, req, p) => {
  const b = await body(req);
  const r = await env.DB.prepare(
    "UPDATE tm_intake SET status = 'approved', job_id = ?, decided_by = ?, decided_at = ? WHERE id = ? AND company_id = ? AND status = 'new'"
  )
    .bind(await own(env, u, 'tm_jobs', b && b.job_id), u.id, now(), p.id, u.company_id)
    .run();
  return r.meta.changes ? ok() : bad('not found', 404);
});
R.add('POST', '/requests/extract', async (env, u, req) => {
  const b = await body(req, 300000);
  return ok({ extracted: extractRequest(String((b && b.text) || '')) });
});

/* ---------- people: office users (invited by email on the Account page) and crew logins ---------- */
// three words and three digits (about 28 bits), easy to read out over the phone; sign-in is rate limited
const WORDS = (
  'amber anchor badger beacon bridge cedar cobalt copper delta ember falcon flint granite harbour heron hollow ' +
  'island ivory juniper kestrel lantern larch maple marble meadow nimbus oak orchid otter pebble pepper pine quarry ' +
  'raven ridge river robin saddle salmon shale sparrow spruce stone summit thistle timber tundra umber valley ' +
  'velvet violet walnut willow winter wren yarrow zephyr birch canyon cliff comet coral dune fern'
).split(' ');
const crewPassword = () => {
  const r = crypto.getRandomValues(new Uint32Array(4));
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${WORDS[r[2] % WORDS.length]}-${100 + (r[3] % 900)}`;
};
R.add('POST', '/people', async (env, u, req) => {
  const b = await body(req);
  if (!b) return bad('bad request');
  const name = str(b.name, 80),
    username = String(b.username || '')
      .trim()
      .toLowerCase();
  if (!name) return bad('Enter their name.');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
    return bad('Usernames use 3 to 40 letters, numbers, dots or dashes.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first())
    return bad('That username is taken: add something, such as your company name.');
  const role = b.role === 'lead' ? 'lead' : 'engineer',
    pw = crewPassword(),
    id = uid();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, company_id, username, name, pass_hash, role, verified, created_at, phone, day_cost) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)'
    ).bind(
      id,
      u.company_id,
      username,
      name,
      await hashPassword(pw),
      role,
      now(),
      str(b.phone, 30),
      b.day_cost === '' || b.day_cost == null ? null : int(b.day_cost, 0, 1e8)
    ),
    env.DB.prepare('UPDATE companies SET seats_dirty = 1 WHERE id = ?').bind(u.company_id),
    logStmt(env, u, 'crew login created', id, username),
  ]);
  return ok({ id, username, password: pw });
});
R.add('PUT', '/people/:id', async (env, u, req, p) => {
  const x = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const b = await body(req);
  if (!x || !b) return bad('not found', 404);
  const crew = ['lead', 'engineer'].includes(x.role);
  const o = {};
  if ('name' in b && str(b.name, 80)) o.name = str(b.name, 80);
  if ('phone' in b) o.phone = str(b.phone, 30);
  if ('day_cost' in b) o.day_cost = b.day_cost === '' || b.day_cost == null ? null : int(b.day_cost, 0, 1e8);
  if (crew && 'role' in b) o.role = b.role === 'lead' ? 'lead' : 'engineer';
  if ('disabled' in b && x.id !== u.id && crew) o.disabled = b.disabled ? 1 : 0;
  const cols = Object.keys(o);
  if (!cols.length) return ok();
  const q = [
    env.DB.prepare(`UPDATE users SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).bind(
      ...cols.map(c => o[c]),
      x.id
    ),
    logStmt(env, u, 'person changed', x.id, cols.join(', ')),
  ];
  if ('disabled' in o) {
    q.push(env.DB.prepare('UPDATE companies SET seats_dirty = 1 WHERE id = ?').bind(u.company_id));
    if (o.disabled)
      q.push(
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(x.id),
        env.DB.prepare('DELETE FROM tm_push WHERE user_id = ?').bind(x.id)
      );
  }
  await env.DB.batch(q);
  return ok();
});
R.add('POST', '/people/:id/reset', async (env, u, req, p) => {
  const x = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND company_id = ? AND role IN ('lead','engineer')")
    .bind(p.id, u.company_id)
    .first();
  if (!x) return bad('Office users reset their own password from the sign-in page.', 404);
  const pw = crewPassword();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(await hashPassword(pw), x.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(x.id),
    logStmt(env, u, 'crew password reset', x.id, null),
  ]);
  return ok({ username: x.username, password: pw });
});
R.add('GET', '/people/:id/quals', async (env, u, req, p) =>
  ok({
    quals: (
      await env.DB.prepare('SELECT * FROM tm_quals WHERE company_id = ? AND user_id = ? ORDER BY expires')
        .bind(u.company_id, p.id)
        .all()
    ).results,
  })
);
R.add('POST', '/people/:id/quals', async (env, u, req, p) => {
  const b = await body(req);
  const x = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!x || !b || !str(b.name, 100)) return bad('Name the qualification.');
  await env.DB.prepare(
    'INSERT INTO tm_quals (id, company_id, user_id, name, number, expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(uid(), u.company_id, x.id, str(b.name, 100), str(b.number, 60), isDate(b.expires) ? b.expires : null, now())
    .run();
  return ok();
});
R.add('DELETE', '/quals/:id', async (env, u, req, p) => {
  await env.DB.prepare('DELETE FROM tm_quals WHERE id = ? AND company_id = ?').bind(p.id, u.company_id).run();
  return ok();
});
R.add('GET', '/quals', async (env, u) =>
  ok({
    quals: (
      await env.DB.prepare(
        'SELECT q.*, x.name AS person FROM tm_quals q JOIN users x ON x.id = q.user_id WHERE q.company_id = ? AND x.disabled = 0 ORDER BY q.expires'
      )
        .bind(u.company_id)
        .all()
    ).results,
  })
);

/* ---------- vehicles ---------- */
function vehPatch(b) {
  const o = {};
  if ('reg' in b) o.reg = (str(b.reg, 12) || '').toUpperCase();
  for (const k of ['model', 'kind', 'notes']) if (k in b) o[k] = str(b[k], k === 'notes' ? 1000 : 80);
  for (const k of ['mot_due', 'tax_due', 'service_due', 'insurance_due']) if (k in b) o[k] = isDate(b[k]) ? b[k] : null;
  if ('off_road' in b) o.off_road = b.off_road ? 1 : 0;
  return o;
}
R.add('POST', '/vehicles', async (env, u, req) => {
  const b = await body(req);
  const o = vehPatch(b || {});
  if (!o.reg) return bad('Enter the registration.');
  const id = uid(),
    cols = Object.keys(o);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tm_vehicles (id, company_id, created_at${cols.map(c => ', ' + c).join('')}) VALUES (?, ?, ?${cols.map(() => ', ?').join('')})`
    ).bind(id, u.company_id, now(), ...cols.map(c => o[c])),
    logStmt(env, u, 'vehicle added', id, o.reg),
  ]);
  return ok({ id });
});
R.add('PUT', '/vehicles/:id', async (env, u, req, p) => {
  const v = await env.DB.prepare('SELECT * FROM tm_vehicles WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  const b = await body(req);
  if (!v || !b) return bad('not found', 404);
  const o = vehPatch(b);
  if (b.clear_unsafe) o.unsafe = 0;
  const cols = Object.keys(o);
  if (!cols.length) return ok();
  await env.DB.batch([
    env.DB.prepare(`UPDATE tm_vehicles SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).bind(
      ...cols.map(c => o[c]),
      v.id
    ),
    logStmt(
      env,
      u,
      b.clear_unsafe ? 'vehicle cleared for use' : 'vehicle changed',
      v.id,
      b.clear_unsafe ? `${v.reg}: ${str(b.note, 300) || ''}` : cols.join(', ')
    ),
    ...(b.clear_unsafe
      ? [
          env.DB.prepare(
            "UPDATE tm_alerts SET ack_at = ?, ack_by = ? WHERE company_id = ? AND kind = 'vehicle_unsafe' AND ref = ? AND ack_at IS NULL"
          ).bind(now(), u.id, u.company_id, v.id),
        ]
      : []),
  ]);
  return ok();
});
R.add('GET', '/vehicles/:id/checks', async (env, u, req, p) => {
  const rows = (
    await env.DB.prepare(
      "SELECT e.id, e.data, e.client_time, e.server_time, e.signature IS NOT NULL AS signed, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.company_id = ? AND e.vehicle_id = ? AND e.kind = 'vehicle_check' ORDER BY e.server_time DESC LIMIT 100"
    )
      .bind(u.company_id, p.id)
      .all()
  ).results;
  const photos = (
    await env.DB.prepare(
      'SELECT id, event_id, caption FROM tm_photos WHERE company_id = ? AND vehicle_id = ? ORDER BY taken_at DESC LIMIT 200'
    )
      .bind(u.company_id, p.id)
      .all()
  ).results;
  return ok({
    checks: rows.map(r => Object.assign(r, { data: pj(r.data, {}), photos: photos.filter(x => x.event_id === r.id) })),
  });
});

/* ---------- clients ---------- */
function clientPatch(b) {
  const o = {};
  for (const [k, m] of Object.entries({ name: 120, contact: 120, email: 200, phone: 30, notes: 2000 }))
    if (k in b) o[k] = str(b[k], m);
  if ('deduction_per_day' in b) o.deduction_per_day = int(b.deduction_per_day, 0, 1e7) || 0;
  if ('archived' in b) o.archived = b.archived ? 1 : 0;
  return o;
}
R.add('POST', '/clients', async (env, u, req) => {
  const o = clientPatch((await body(req)) || {});
  if (!o.name) return bad('Enter the client name.');
  const id = uid(),
    cols = Object.keys(o);
  await env.DB.prepare(
    `INSERT INTO tm_clients (id, company_id, created_at${cols.map(c => ', ' + c).join('')}) VALUES (?, ?, ?${cols.map(() => ', ?').join('')})`
  )
    .bind(id, u.company_id, now(), ...cols.map(c => o[c]))
    .run();
  return ok({ id });
});
R.add('PUT', '/clients/:id', async (env, u, req, p) => {
  const o = clientPatch((await body(req)) || {}),
    cols = Object.keys(o);
  if (!cols.length) return ok();
  const r = await env.DB.prepare(
    `UPDATE tm_clients SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ? AND company_id = ?`
  )
    .bind(...cols.map(c => o[c]), p.id, u.company_id)
    .run();
  return r.meta.changes ? ok() : bad('not found', 404);
});

/* ---------- documents: each save is a new version; reviewing marks it approved ---------- */
function cleanDoc(kind, c) {
  if (kind === 'ra')
    return {
      title: str(c.title, 200),
      rows: (c.rows || [])
        .slice(0, 80)
        .map(r => [0, 1, 2, 3].map(i => str(r[i], 1500) || ''))
        .filter(r => r[0]),
    };
  if (kind === 'method')
    return {
      title: str(c.title, 200),
      sections: (c.sections || [])
        .slice(0, 60)
        .map(r => [str(r[0], 200) || '', str(r[1], 4000) || ''])
        .filter(r => r[0] || r[1]),
    };
  return {
    title: str(c.title, 200),
    items: (c.items || [])
      .slice(0, 120)
      .map(x => str(x, 200))
      .filter(Boolean),
  };
}
R.add('POST', '/docs/:kind', async (env, u, req, p) => {
  if (!['ra', 'method', 'vehicle_checks', 'hazards'].includes(p.kind)) return bad('unknown document');
  const b = await body(req, 400000);
  if (!b || !b.content) return bad('bad request');
  if (b.reviewed && u.role !== 'admin') return bad('Only an administrator can mark documents as reviewed.', 403);
  const c = cleanDoc(p.kind, b.content);
  const cur = await env.DB.prepare('SELECT MAX(version) AS v FROM tm_docs WHERE company_id = ? AND kind = ?')
    .bind(u.company_id, p.kind)
    .first();
  const v = ((cur && cur.v) || 0) + 1;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tm_docs (id, company_id, kind, version, title, content, created_by, created_at, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      uid(),
      u.company_id,
      p.kind,
      v,
      c.title,
      JSON.stringify(c),
      u.id,
      now(),
      b.reviewed ? u.id : null,
      b.reviewed ? now() : null
    ),
    logStmt(env, u, b.reviewed ? 'document approved' : 'document saved as draft', p.kind, `version ${v}`),
  ]);
  return ok({ version: v });
});
R.add('GET', '/docs/:kind/versions', async (env, u, req, p) =>
  ok({
    versions: (
      await env.DB.prepare(
        'SELECT d.id, d.version, d.title, d.created_at, d.reviewed_at, x.name AS by_name, y.name AS reviewer FROM tm_docs d LEFT JOIN users x ON x.id = d.created_by LEFT JOIN users y ON y.id = d.reviewed_by WHERE d.company_id = ? AND d.kind = ? ORDER BY d.version DESC'
      )
        .bind(u.company_id, p.kind)
        .all()
    ).results,
  })
);

/* ---------- photo rules ---------- */
function rulePatch(b) {
  const o = {};
  if ('name' in b) o.name = str(b.name, 80);
  if ('label' in b) o.label = str(b.label, 160);
  if ('scope' in b) o.scope = ['company', 'client', 'tm_type', 'job'].includes(b.scope) ? b.scope : 'company';
  if ('scope_ref' in b) o.scope_ref = str(b.scope_ref, 80);
  if ('trig' in b) o.trig = ['event', 'repeat', 'daily'].includes(b.trig) ? b.trig : 'event';
  if ('event' in b)
    o.event = ['arrival', 'before_work', 'setup', 'removal', 'site_clear'].includes(b.event) ? b.event : null;
  if ('every_mins' in b) o.every_mins = int(b.every_mins, 15, 1440);
  if ('at_time' in b) o.at_time = isTime(b.at_time) ? b.at_time : null;
  if ('grace_mins' in b) o.grace_mins = int(b.grace_mins, 0, 240) ?? 10;
  if ('count' in b) o.count = int(b.count, 1, 10) || 1;
  if ('escalate_mins' in b) o.escalate_mins = int(b.escalate_mins, 5, 600) || 30;
  if ('active' in b) o.active = b.active ? 1 : 0;
  return o;
}
const ruleOk = o =>
  !o.name || !o.label
    ? 'Give the rule a name and say what the photo should show.'
    : o.trig === 'event' && !o.event
      ? 'Choose the moment that triggers the photo.'
      : o.trig === 'repeat' && !o.every_mins
        ? 'Say how often, in minutes (15 or more).'
        : o.trig === 'daily' && !o.at_time
          ? 'Choose the time of day.'
          : null;
R.add('POST', '/rules', async (env, u, req) => {
  const o = Object.assign(
    { scope: 'company', trig: 'event', grace_mins: 10, count: 1, escalate_mins: 30 },
    rulePatch((await body(req)) || {})
  );
  const e = ruleOk(o);
  if (e) return bad(e);
  const id = uid(),
    cols = Object.keys(o);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tm_photo_rules (id, company_id, created_at${cols.map(c => ', ' + c).join('')}) VALUES (?, ?, ?${cols.map(() => ', ?').join('')})`
    ).bind(id, u.company_id, now(), ...cols.map(c => o[c])),
    logStmt(env, u, 'photo rule added', id, o.name),
  ]);
  return ok({ id });
});
R.add('PUT', '/rules/:id', async (env, u, req, p) => {
  const r0 = await env.DB.prepare('SELECT * FROM tm_photo_rules WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!r0) return bad('not found', 404);
  const o = rulePatch((await body(req)) || {});
  const e = ruleOk(Object.assign({}, r0, o));
  if (e) return bad(e);
  const cols = Object.keys(o);
  if (cols.length)
    await env.DB.batch([
      env.DB.prepare(`UPDATE tm_photo_rules SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).bind(
        ...cols.map(c => o[c]),
        r0.id
      ),
      logStmt(env, u, 'photo rule changed', r0.id, cols.join(', ')),
    ]);
  return ok();
});

/* ---------- settings ---------- */
// a new job request address (the old one stops working at once): for when it has been passed around too widely
R.add('POST', '/settings/intake-key', async (env, u) => {
  if (u.role !== 'admin') return bad('Only an administrator can change the job request address.', 403);
  const key = randToken()
    .slice(0, 12)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, 'x');
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_settings SET intake_key = ?, updated_at = ? WHERE company_id = ?').bind(
      key,
      now(),
      u.company_id
    ),
    logStmt(env, u, 'job request address changed', 'settings', null),
  ]);
  return ok({ intake_address: `jobs+${key}@${env.INTAKE_DOMAIN || 'tmwerx.co.uk'}` });
});
R.add('PUT', '/settings', async (env, u, req) => {
  if (u.role !== 'admin') return bad('Only an administrator can change settings.', 403);
  const b = (await body(req)) || {};
  const cur = await settings(env, u.company_id),
    o = {};
  for (const [k, d] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in b)) continue;
    if (typeof d === 'number') {
      const n = num(b[k]);
      if (n != null && n >= 0 && n < 100000) o[k] = n;
    } else if (typeof d === 'boolean') o[k] = !!b[k];
    else if (Array.isArray(d))
      o[k] = (Array.isArray(b[k]) ? b[k] : [])
        .map(x => str(x, 60))
        .filter(Boolean)
        .slice(0, 50);
    else if (typeof d === 'string') o[k] = str(b[k], 200) || '';
  }
  if ('start_requires' in o)
    o.start_requires = o.start_requires.filter(x =>
      ['ra_signoff', 'risk_check', 'vehicle_check', 'loaded', 'drawing_ack'].includes(x)
    );
  if ('week_start' in o) o.week_start = Math.max(0, Math.min(6, Math.round(o.week_start)));
  const next = Object.assign({}, cur, o);
  await env.DB.batch([
    env.DB.prepare('UPDATE tm_settings SET data = ?, updated_at = ? WHERE company_id = ?').bind(
      JSON.stringify(next),
      now(),
      u.company_id
    ),
    logStmt(env, u, 'settings changed', 'settings', Object.keys(o).join(', ')),
  ]);
  return ok({ settings: next });
});

/* ---------- timesheets and working time (from sign-in and sign-out records) ---------- */
export async function timesheet(env, cid, from, to) {
  const ev = (
    await env.DB.prepare(
      "SELECT e.user_id, e.kind, e.visit_id, COALESCE(e.client_time, e.server_time) AS t, x.name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.company_id = ? AND e.kind IN ('signin','signout','day_complete','job_complete','failed_visit') AND COALESCE(e.client_time, e.server_time) BETWEEN ? AND ? ORDER BY e.user_id, t"
    )
      .bind(cid, Date.parse(from + 'T00:00:00Z') - 864e5, Date.parse(to + 'T23:59:59Z') + 864e5)
      .all()
  ).results;
  const shifts = [];
  const open = new Map();
  for (const e of ev) {
    if (e.kind === 'signin') {
      if (!open.has(e.user_id)) open.set(e.user_id, e);
    } else {
      const s = open.get(e.user_id);
      if (s) {
        shifts.push({ user_id: e.user_id, name: e.name, start: s.t, end: e.t, visit_id: s.visit_id });
        open.delete(e.user_id);
      }
    }
  }
  for (const s of open.values())
    shifts.push({ user_id: s.user_id, name: s.name, start: s.t, end: null, visit_id: s.visit_id });
  const inRange = shifts.filter(s => {
    const d = ukDate(s.start);
    return d >= from && d <= to;
  });
  return inRange;
}
R.add('GET', '/time', async (env, u, req, p, url) => {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : ukDate(Date.now() - 6 * 864e5);
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : ukDate();
  const shifts = await timesheet(env, u.company_id, from, to);
  const visits = shifts.length
    ? (
        await env.DB.prepare(
          `SELECT v.id, j.number, j.address FROM tm_visits v JOIN tm_jobs j ON j.id = v.job_id WHERE v.company_id = ? AND v.id IN (SELECT value FROM json_each(?))`
        )
          .bind(u.company_id, JSON.stringify([...new Set(shifts.map(s => s.visit_id).filter(Boolean))]))
          .all()
      ).results
    : [];
  return ok({
    from,
    to,
    shifts: shifts.map(s => Object.assign(s, { job: (visits.find(v => v.id === s.visit_id) || {}).number || '' })),
    settings: await settings(env, u.company_id),
  });
});

/* ---------- safety: near misses, actions, audits, lone working ---------- */
R.add('GET', '/safety', async (env, u) => {
  const [nm, actions, audits, lone] = await Promise.all([
    env.DB.prepare(
      "SELECT e.id, e.job_id, e.data, e.client_time, e.server_time, e.lat, e.lng, x.name AS user_name, j.number FROM tm_events e JOIN users x ON x.id = e.user_id LEFT JOIN tm_jobs j ON j.id = e.job_id WHERE e.company_id = ? AND e.kind = 'near_miss' ORDER BY e.server_time DESC LIMIT 200"
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_actions WHERE company_id = ? ORDER BY status, due, created_at DESC LIMIT 300')
      .bind(u.company_id)
      .all(),
    env.DB.prepare(
      'SELECT a.*, x.name AS auditor_name, j.number FROM tm_audits a JOIN users x ON x.id = a.auditor LEFT JOIN tm_jobs j ON j.id = a.job_id WHERE a.company_id = ? ORDER BY a.created_at DESC LIMIT 100'
    )
      .bind(u.company_id)
      .all(),
    env.DB.prepare('SELECT l.*, x.name, x.phone FROM tm_lone l JOIN users x ON x.id = l.user_id WHERE l.company_id = ?')
      .bind(u.company_id)
      .all(),
  ]);
  return ok({
    near_misses: nm.results.map(r => Object.assign(r, { data: pj(r.data, {}) })),
    actions: actions.results,
    audits: audits.results.map(r => Object.assign(r, { data: pj(r.data, {}) })),
    lone: lone.results,
  });
});
R.add('POST', '/actions', async (env, u, req) => {
  const b = (await body(req)) || {};
  if (!str(b.title, 300)) return bad('Describe the action.');
  await env.DB.prepare(
    'INSERT INTO tm_actions (id, company_id, source, ref, title, owner, due, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      uid(),
      u.company_id,
      str(b.source, 20) || 'office',
      str(b.ref, 64),
      str(b.title, 300),
      str(b.owner, 80),
      isDate(b.due) ? b.due : null,
      'open',
      now()
    )
    .run();
  return ok();
});
R.add('PUT', '/actions/:id', async (env, u, req, p) => {
  const b = (await body(req)) || {};
  const o = {};
  if ('owner' in b) o.owner = str(b.owner, 80);
  if ('due' in b) o.due = isDate(b.due) ? b.due : null;
  if ('note' in b) o.note = str(b.note, 2000);
  if ('status' in b) {
    o.status = b.status === 'closed' ? 'closed' : 'open';
    o.closed_at = o.status === 'closed' ? now() : null;
  }
  const cols = Object.keys(o);
  if (cols.length)
    await env.DB.prepare(
      `UPDATE tm_actions SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ? AND company_id = ?`
    )
      .bind(...cols.map(c => o[c]), p.id, u.company_id)
      .run();
  return ok();
});
R.add('POST', '/audits', async (env, u, req) => {
  const b = (await body(req)) || {};
  const items = (Array.isArray(b.items) ? b.items : [])
    .slice(0, 60)
    .map(i => ({
      q: str(i.q, 200),
      result: ['pass', 'fail', 'na'].includes(i.result) ? i.result : 'na',
      note: str(i.note, 500),
    }))
    .filter(i => i.q);
  if (!items.length) return bad('Add at least one check.');
  const scored = items.filter(i => i.result !== 'na'),
    score = scored.length ? Math.round((100 * scored.filter(i => i.result === 'pass').length) / scored.length) : null;
  const id = uid();
  const q = [
    env.DB.prepare(
      'INSERT INTO tm_audits (id, company_id, job_id, visit_id, auditor, data, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      u.company_id,
      await own(env, u, 'tm_jobs', b.job_id),
      await own(env, u, 'tm_visits', b.visit_id),
      u.id,
      JSON.stringify({ items, notes: str(b.notes, 2000) }),
      score,
      now()
    ),
  ];
  for (const i of items.filter(i => i.result === 'fail'))
    q.push(
      env.DB.prepare(
        "INSERT INTO tm_actions (id, company_id, source, ref, title, status, created_at) VALUES (?, ?, 'audit', ?, ?, 'open', ?)"
      ).bind(uid(), u.company_id, id, `Audit: ${i.q}${i.note ? ' (' + i.note + ')' : ''}`.slice(0, 300), now())
    );
  await env.DB.batch(q);
  return ok({ id, score });
});

/* ---------- costs and invoicing ---------- */
R.add('GET', '/costs', async (env, u, req, p, url) => {
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : ukDate(Date.now() - 6 * 864e5);
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : ukDate();
  const visits = (
    await env.DB.prepare(
      `SELECT v.id, v.job_id, v.date, v.kind, v.status, v.client_rate AS visit_rate, j.number, j.address, j.client_id, j.client_rate, j.charge_basis, j.invoice_ready, j.invoiced_at, j.tm_type,
        c.name AS client_name, c.deduction_per_day FROM tm_visits v JOIN tm_jobs j ON j.id = v.job_id LEFT JOIN tm_clients c ON c.id = j.client_id
       WHERE v.company_id = ? AND v.date BETWEEN ? AND ? AND v.status NOT IN ('cancelled') ORDER BY v.date, j.number`
    )
      .bind(u.company_id, from, to)
      .all()
  ).results;
  const assign = visits.length
    ? (
        await env.DB.prepare(
          `SELECT a.visit_id, a.cost, x.name FROM tm_assign a JOIN users x ON x.id = a.user_id WHERE a.visit_id IN (SELECT value FROM json_each(?))`
        )
          .bind(JSON.stringify(visits.map(v => v.id)))
          .all()
      ).results
    : [];
  const shifts = await timesheet(env, u.company_id, from, to);
  const rows = visits.map(v => {
    const crew = assign.filter(a => a.visit_id === v.id);
    const labour = crew.reduce((t, a) => t + (a.cost || 0), 0);
    const hrs = shifts
      .filter(s => s.visit_id === v.id && s.end)
      .reduce((t, s) => Math.max(t, (s.end - s.start) / 3600e3), 0);
    const rate = v.visit_rate != null ? v.visit_rate : v.client_rate || 0;
    const income = v.charge_basis === 'hourly' ? Math.round(rate * hrs) : v.charge_basis === 'fixed' ? 0 : rate;
    return {
      visit_id: v.id,
      job_id: v.job_id,
      date: v.date,
      number: v.number,
      address: v.address,
      client: v.client_name || '',
      tm_type: v.tm_type,
      status: v.status,
      basis: v.charge_basis,
      rate,
      hours: Math.round(hrs * 100) / 100,
      income,
      labour,
      deduction: v.deduction_per_day || 0,
      margin: income - labour - (v.deduction_per_day || 0),
      crew: crew.map(a => a.name),
      invoice_ready: !!v.invoice_ready,
      invoiced: !!v.invoiced_at,
    };
  });
  // fixed-price jobs: the price counts once, on the job's last working day in the range
  const fixed = [...new Set(visits.filter(v => v.charge_basis === 'fixed').map(v => v.job_id))];
  for (const id of fixed) {
    const rs = rows.filter(r => r.job_id === id);
    const last = rs[rs.length - 1];
    last.income = (visits.find(v => v.job_id === id) || {}).client_rate || 0;
    last.margin = last.income - last.labour - last.deduction;
  }
  return ok({ from, to, rows });
});
R.add('PUT', '/jobs/:id/invoice', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  const b = await body(req);
  if (!j || !b) return bad('not found', 404);
  const o = {};
  if ('invoice_ready' in b) o.invoice_ready = b.invoice_ready ? 1 : 0;
  if ('invoiced' in b) o.invoiced_at = b.invoiced ? now() : null;
  const cols = Object.keys(o);
  if (cols.length)
    await env.DB.batch([
      env.DB.prepare(`UPDATE tm_jobs SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`).bind(
        ...cols.map(c => o[c]),
        j.id
      ),
      logStmt(env, u, 'invoice status', j.id, JSON.stringify(b)),
    ]);
  return ok();
});

/* ---------- files and packs ---------- */
R.add('GET', '/file/photo/:id', async (env, u, req, p) => {
  const ph = await env.DB.prepare('SELECT * FROM tm_photos WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  return ph ? serve(env, ph.r2_key, ph.mime) : new Response('Not found', { status: 404 });
});
R.add('GET', '/file/drawing/:id', async (env, u, req, p) => {
  const d = await env.DB.prepare('SELECT * FROM tm_drawings WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  return d
    ? serve(env, d.pdf_key, 'application/pdf', `drawing-${d.rev}.pdf`)
    : new Response('Not found', { status: 404 });
});
R.add('GET', '/file/signature/:id', async (env, u, req, p) => {
  const e = await env.DB.prepare('SELECT signature FROM tm_events WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!e || !e.signature) return new Response('Not found', { status: 404 });
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(e.signature);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(
    Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)),
    {
      headers: {
        'Content-Type': m[1],
        'Cache-Control': 'private, max-age=86400',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    }
  );
});
R.add('GET', '/logo', async (env, u) =>
  u.logo_type ? serve(env, 'logos/' + u.company_id, u.logo_type) : new Response('Not found', { status: 404 })
);
R.add('GET', '/jobs/:id/pack', async (env, u, req, p, url) => {
  const j = await getJob(env, u, p.id);
  if (!j) return new Response('Not found', { status: 404 });
  return evidencePack(env, u, j, { blank: url.searchParams.get('blank') === '1', base: '/api/office' });
});
R.add('GET', '/export', async (env, u) => {
  if (u.role !== 'admin') return bad('Only an administrator can download all the company data.', 403);
  const tables = [
    'tm_jobs',
    'tm_visits',
    'tm_assign',
    'tm_drawings',
    'tm_events',
    'tm_photos',
    'tm_photo_tasks',
    'tm_alerts',
    'tm_intake',
    'tm_clients',
    'tm_vehicles',
    'tm_quals',
    'tm_docs',
    'tm_photo_rules',
    'tm_actions',
    'tm_audits',
    'tm_log',
  ];
  const out = {
    exported_at: new Date().toISOString(),
    company: u.company_name,
    note: 'Photos and drawings: each job has a "Download job (zip)" button, and every file is listed here with its SHA-256 fingerprint.',
    tables: {},
  };
  for (const t of tables)
    out.tables[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE company_id = ?`).bind(u.company_id).all()).results;
  await log(env, u, 'company export', 'export', null);
  return new Response(JSON.stringify(out, null, 1), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="tmwerx-export.json"',
      'Cache-Control': 'no-store',
    },
  });
});
R.add('GET', '/jobs/:id/zip', async (env, u, req, p) => {
  const j = await getJob(env, u, p.id);
  if (!j) return new Response('Not found', { status: 404 });
  const { jobZip } = await import('./zip.js');
  return jobZip(env, u, j);
});

export async function officeApi(req, env, u, url, M) {
  const ou = await officeUser(env, u);
  if (!ou) return json({ ok: false, error: u ? 'This login cannot use the office app.' : 'signed-out' }, 401);
  const path = url.pathname.slice('/api/office'.length) || '/';
  const hit = R.find(M, path);
  if (!hit) return bad('not found', 404);
  return hit.fn(env, ou, req, hit.params, url);
}
