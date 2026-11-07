// The crew app's API: sign in with a username, download the day's work, send records and photos (made offline
// and sent later), and register the phone for notifications.
import { checkPassword, startSession } from '../auth.js';
import { CK, ipKey, json, now, readBody, sha256, tooMany } from '../lib/core.js';
import { cleanEvent, applyEvent, insertEvent } from './events.js';
import { PHOTO_MAX, ext, putOnce, serve, sha256buf, sniff } from './files.js';
import { makeRouter } from './router.js';
import { matchPhoto, rulesFor } from './tasks.js';
import { bad, body, crewUser, num, ok, pj, settings, str } from './util.js';

const R = makeRouter();

// the jobs this person may see: sent to the phones, with a visit they are on from 14 days ago to 60 days ahead
async function myVisits(env, u) {
  const from = new Date(now() - 14 * 864e5).toISOString().slice(0, 10),
    to = new Date(now() + 60 * 864e5).toISOString().slice(0, 10);
  return (
    await env.DB.prepare(
      `SELECT v.*, a.lead FROM tm_visits v JOIN tm_assign a ON a.visit_id = v.id JOIN tm_jobs j ON j.id = v.job_id
       WHERE a.user_id = ? AND v.company_id = ? AND j.sent_version > 0 AND v.date BETWEEN ? AND ? ORDER BY v.date, v.start_time`
    )
      .bind(u.id, u.company_id, from, to)
      .all()
  ).results;
}
async function mayJob(env, u, jobId) {
  return !!(await env.DB.prepare(
    'SELECT 1 FROM tm_assign a JOIN tm_visits v ON v.id = a.visit_id JOIN tm_jobs j ON j.id = v.job_id WHERE a.user_id = ? AND v.job_id = ? AND j.company_id = ? AND j.sent_version > 0'
  )
    .bind(u.id, jobId, u.company_id)
    .first());
}
const currentDocs = async (env, cid) => {
  const rows = (
    await env.DB.prepare(
      'SELECT d.* FROM tm_docs d WHERE d.company_id = ? AND d.version = (SELECT MAX(version) FROM tm_docs x WHERE x.company_id = d.company_id AND x.kind = d.kind)'
    )
      .bind(cid)
      .all()
  ).results;
  return Object.fromEntries(
    rows.map(d => [
      d.kind,
      { id: d.id, version: d.version, title: d.title, content: pj(d.content, {}), reviewed: !!d.reviewed_at },
    ])
  );
};

R.add('GET', '/sync', async (env, u) => {
  const visits = await myVisits(env, u);
  const jobIds = [...new Set(visits.map(v => v.job_id))];
  const inJ = a => `(${a.map(() => '?').join(',') || "''"})`;
  const [jobs, crew, drawings, events, photos, tasks, vehicles, docs, s, clients] = await Promise.all([
    jobIds.length
      ? env.DB.prepare(`SELECT * FROM tm_jobs WHERE company_id = ? AND id IN ${inJ(jobIds)}`)
          .bind(u.company_id, ...jobIds)
          .all()
      : { results: [] },
    jobIds.length
      ? env.DB.prepare(
          `SELECT a.visit_id, a.user_id, a.lead, x.name, x.phone FROM tm_assign a JOIN tm_visits v ON v.id = a.visit_id JOIN users x ON x.id = a.user_id WHERE v.company_id = ? AND v.job_id IN ${inJ(jobIds)}`
        )
          .bind(u.company_id, ...jobIds)
          .all()
      : { results: [] },
    jobIds.length
      ? env.DB.prepare(
          `SELECT id, job_id, rev, source, drawing_no, approved_by, approved_at, sha256, pages, equipment, note, created_at FROM tm_drawings WHERE company_id = ? AND job_id IN ${inJ(jobIds)} ORDER BY created_at`
        )
          .bind(u.company_id, ...jobIds)
          .all()
      : { results: [] },
    jobIds.length
      ? env.DB.prepare(
          `SELECT e.id, e.job_id, e.visit_id, e.vehicle_id, e.user_id, e.kind, e.data, e.client_time, e.server_time, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id
           WHERE e.company_id = ? AND (e.job_id IN ${inJ(jobIds)} OR e.user_id = ?) AND e.server_time > ? ORDER BY e.server_time DESC LIMIT 600`
        )
          .bind(u.company_id, ...jobIds, u.id, now() - 30 * 864e5)
          .all()
      : env.DB.prepare(
          "SELECT e.id, e.job_id, e.visit_id, e.vehicle_id, e.user_id, e.kind, e.data, e.client_time, e.server_time, '' AS user_name FROM tm_events e WHERE e.company_id = ? AND e.user_id = ? AND e.server_time > ? ORDER BY e.server_time DESC LIMIT 200"
        )
          .bind(u.company_id, u.id, now() - 30 * 864e5)
          .all(),
    jobIds.length
      ? env.DB.prepare(
          `SELECT id, job_id, visit_id, user_id, task_id, category, caption, taken_at, received_at, source FROM tm_photos WHERE company_id = ? AND job_id IN ${inJ(jobIds)} ORDER BY taken_at DESC LIMIT 400`
        )
          .bind(u.company_id, ...jobIds)
          .all()
      : { results: [] },
    visits.length
      ? env.DB.prepare(`SELECT * FROM tm_photo_tasks WHERE visit_id IN ${inJ(visits.map(v => v.id))} ORDER BY due_at`)
          .bind(...visits.map(v => v.id))
          .all()
      : { results: [] },
    env.DB.prepare('SELECT id, reg, model, kind, off_road, unsafe FROM tm_vehicles WHERE company_id = ? ORDER BY reg')
      .bind(u.company_id)
      .all(),
    currentDocs(env, u.company_id),
    settings(env, u.company_id),
    env.DB.prepare('SELECT id, name FROM tm_clients WHERE company_id = ?').bind(u.company_id).all(),
  ]);
  const cname = new Map(clients.results.map(c => [c.id, c.name]));
  const rules = new Map();
  for (const j of jobs.results)
    rules.set(
      j.id,
      (await rulesFor(env, j)).map(r => ({
        id: r.id,
        trig: r.trig,
        event: r.event,
        every_mins: r.every_mins,
        at_time: r.at_time,
        grace_mins: r.grace_mins,
        label: r.label,
        count: r.count,
      }))
    );
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), u.id).run();
  return ok({
    server_time: now(),
    me: { id: u.id, name: u.name, role: u.role, company: u.company_name, logo: !!u.logo_type },
    jobs: jobs.results
      .filter(j => j.sent_version > 0)
      .map(j => ({
        id: j.id,
        number: j.number,
        title: j.title,
        client: cname.get(j.client_id) || '',
        client_ref: j.client_ref,
        address: j.address,
        town: j.town,
        postcode: j.postcode,
        lat: j.lat,
        lng: j.lng,
        w3w: j.w3w,
        usrn: j.usrn,
        tm_type: j.tm_type,
        permit_ref: j.permit_ref,
        start_date: j.start_date,
        end_date: j.end_date,
        hours: j.hours,
        site_contact: j.site_contact,
        nearest_ae: j.nearest_ae,
        instructions: j.instructions,
        hazards: pj(j.hazards, []),
        status: j.status,
        version: j.sent_version,
        removed: !!j.removed_at,
        rules: rules.get(j.id) || [],
      })),
    visits: visits.map(v => ({
      id: v.id,
      job_id: v.job_id,
      date: v.date,
      start_time: v.start_time,
      end_time: v.end_time,
      kind: v.kind,
      status: v.status,
      drawing_id: v.drawing_id,
      vehicle_ids: pj(v.vehicle_ids, []),
      lead: !!v.lead,
      notes: v.notes,
      crew: crew.results
        .filter(c => c.visit_id === v.id)
        .map(c => ({ id: c.user_id, name: c.name, phone: c.phone, lead: !!c.lead })),
    })),
    drawings: drawings.results.map(d => Object.assign(d, { equipment: pj(d.equipment, []) })),
    events: events.results.map(e => Object.assign(e, { data: pj(e.data, {}) })),
    photos: photos.results,
    tasks: tasks.results,
    vehicles: vehicles.results.filter(v => !v.off_road),
    docs,
    settings: {
      start_requires: s.start_requires,
      mandatory_items: s.mandatory_items,
      spares_pct: s.spares_pct,
      allow_gallery: s.allow_gallery,
      geofence_m: s.geofence_m,
      lone_every_mins: s.lone_every_mins,
      pending_limit_hours: s.pending_limit_hours,
    },
    vapid: env.VAPID_PUBLIC_KEY || null,
  });
});

// a batch of records from the outbox; each is saved once (ids come from the phone), then acted on
R.add('POST', '/events', async (env, u, req) => {
  const b = await body(req, 3000000);
  if (!b || !Array.isArray(b.events) || b.events.length > 100) return bad('bad batch');
  const done = [],
    failed = [];
  const offset = num(b.client_now) ? Math.round(b.client_now - now()) : null;
  for (const e of b.events) {
    const c = cleanEvent(e, u, offset);
    if (c.error) {
      failed.push({ id: e && e.id, error: c.error });
      continue;
    }
    const r = c.row;
    if (r.job_id && !(await mayJob(env, u, r.job_id))) {
      failed.push({ id: r.id, error: 'This job is not on your list any more.' });
      continue;
    }
    if (
      r.vehicle_id &&
      !(await env.DB.prepare('SELECT 1 FROM tm_vehicles WHERE id = ? AND company_id = ?')
        .bind(r.vehicle_id, u.company_id)
        .first())
    ) {
      failed.push({ id: r.id, error: 'unknown vehicle' });
      continue;
    }
    const ins = await insertEvent(env, r).run();
    if (ins.meta && ins.meta.changes) await applyEvent(env, u, r);
    done.push(r.id);
  }
  await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), u.id).run();
  return ok({ done, failed, server_time: now() });
});

// one photo: the JPEG as the body, its details in the X-Photo header (JSON). Retries keep the first copy.
R.add('PUT', '/photo/:id', async (env, u, req, p) => {
  if (!/^[0-9a-f-]{36}$/i.test(p.id)) return bad('bad id');
  if (req.headers.get('X-Photo') && req.headers.get('X-Photo').length > 4000) return bad('bad details');
  const had = await env.DB.prepare('SELECT id FROM tm_photos WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (had) return ok({ id: p.id, duplicate: true });
  let m;
  try {
    m = JSON.parse(decodeURIComponent(req.headers.get('X-Photo') || '{}'));
  } catch (e) {
    return bad('bad details');
  }
  const jobId = str(m.job_id, 64);
  if (jobId && !(await mayJob(env, u, jobId))) return bad('This job is not on your list any more.', 403);
  if (!jobId && !m.vehicle_id) return bad('photo of what?');
  const buf = await readBody(req, PHOTO_MAX);
  if (!buf) return bad('too large', 413);
  const mime = sniff(buf);
  if (!mime || mime === 'application/pdf') return bad('not an image');
  const s = await settings(env, u.company_id);
  const source = m.source === 'gallery' ? (s.allow_gallery ? 'gallery' : null) : 'camera';
  if (!source) return bad('Photos from the gallery are not allowed by your company.');
  const sha = await sha256buf(buf);
  const key = `co/${u.company_id}/photos/${p.id}.${ext(mime)}`;
  await putOnce(env, key, buf, mime);
  const taken = num(m.taken_at),
    row = {
      id: p.id,
      company_id: u.company_id,
      job_id: jobId,
      visit_id: str(m.visit_id, 64),
      vehicle_id: str(m.vehicle_id, 64),
      event_id: str(m.event_id, 64),
      user_id: u.id,
      task_id: str(m.task_id, 140),
      category: str(m.category, 40),
      caption: str(m.caption, 300),
      r2_key: key,
      sha256: sha,
      size: buf.length,
      mime,
      lat: num(m.lat),
      lng: num(m.lng),
      acc: num(m.acc),
      taken_at: taken && taken > 1.5e12 && taken < now() + 864e5 ? Math.round(taken) : now(),
      received_at: now(),
      skew: num(m.client_now) ? Math.round(m.client_now - now()) : null,
      source,
    };
  await env.DB.prepare(
    'INSERT OR IGNORE INTO tm_photos (id, company_id, job_id, visit_id, vehicle_id, event_id, user_id, task_id, category, caption, r2_key, sha256, size, mime, lat, lng, acc, taken_at, received_at, skew, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(...Object.values(row))
    .run();
  await matchPhoto(env, row);
  return ok({ id: p.id, sha256: sha });
});

R.add('GET', '/file/drawing/:id', async (env, u, req, p) => {
  const d = await env.DB.prepare('SELECT * FROM tm_drawings WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!d || !(await mayJob(env, u, d.job_id))) return new Response('Not found', { status: 404 });
  return serve(env, d.pdf_key, 'application/pdf', `drawing-${d.rev}.pdf`);
});
R.add('GET', '/file/photo/:id', async (env, u, req, p) => {
  const ph = await env.DB.prepare('SELECT * FROM tm_photos WHERE id = ? AND company_id = ?')
    .bind(p.id, u.company_id)
    .first();
  if (!ph || (ph.job_id ? !(await mayJob(env, u, ph.job_id)) : ph.user_id !== u.id))
    return new Response('Not found', { status: 404 });
  return serve(env, ph.r2_key, ph.mime);
});
R.add('GET', '/logo', async (env, u) => {
  if (!u.logo_type) return new Response('Not found', { status: 404 });
  return serve(env, 'logos/' + u.company_id, u.logo_type);
});

R.add('POST', '/push', async (env, u, req) => {
  const b = await body(req, 5000);
  const s = b && b.subscription;
  if (
    !s ||
    typeof s.endpoint !== 'string' ||
    !/^https:\/\//.test(s.endpoint) ||
    !s.keys ||
    !s.keys.p256dh ||
    !s.keys.auth
  )
    return bad('bad subscription');
  if (s.endpoint.length > 1000) return bad('bad subscription');
  const id = await sha256(s.endpoint);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tm_push (id, user_id, company_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, company_id = excluded.company_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0'
    ).bind(
      id,
      u.id,
      u.company_id,
      s.endpoint,
      String(s.keys.p256dh).slice(0, 200),
      String(s.keys.auth).slice(0, 100),
      now()
    ),
    env.DB.prepare('UPDATE users SET push_ok = 1 WHERE id = ?').bind(u.id),
  ]);
  return ok();
});
// the app reports how it is running: from the home screen, and whether notifications are allowed
R.add('POST', '/state', async (env, u, req) => {
  const b = (await body(req, 2000)) || {};
  await env.DB.prepare(
    'UPDATE users SET installed_at = CASE WHEN ? THEN COALESCE(installed_at, ?) ELSE installed_at END, push_ok = CASE WHEN ? IS NULL THEN push_ok ELSE ? END, last_seen = ? WHERE id = ?'
  )
    .bind(b.standalone ? 1 : 0, now(), b.push == null ? null : 1, b.push ? 1 : 0, now(), u.id)
    .run();
  return ok();
});
// the latest position while signed in to a visit (working time only; never stored as a history)
R.add('POST', '/location', async (env, u, req) => {
  const b = (await body(req, 1000)) || {};
  const lat = num(b.lat),
    lng = num(b.lng);
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return bad('bad position');
  const on = await env.DB.prepare(
    "SELECT 1 FROM tm_events e WHERE e.user_id = ? AND e.kind = 'signin' AND e.server_time > ? AND NOT EXISTS (SELECT 1 FROM tm_events o WHERE o.user_id = e.user_id AND o.kind IN ('signout','day_complete','job_complete','failed_visit') AND o.server_time > e.server_time)"
  )
    .bind(u.id, now() - 18 * 3600e3)
    .first();
  if (!on) return ok({ stored: false });
  await env.DB.prepare(
    'INSERT INTO tm_locations (user_id, company_id, lat, lng, acc, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = excluded.at'
  )
    .bind(u.id, u.company_id, lat, lng, num(b.acc), now())
    .run();
  return ok({ stored: true });
});

/* ---------- sign-in with a username (crew have no email address on file) ---------- */
export async function crewLogin(req, env, ipk) {
  const b = await body(req, 2000);
  if (!b) return bad('bad request');
  const un = String(b.username || '')
      .trim()
      .toLowerCase(),
    pw = String(b.password || '');
  if (!un || !pw) return bad('Enter your username and password.');
  if ((await tooMany(env, 'crew:ip:' + ipk, 30, 15)) || (await tooMany(env, 'crew:u:' + un, 8, 15)))
    return bad('Too many tries. Wait 15 minutes and try again.', 429);
  const usr = await env.DB.prepare(
    "SELECT u.*, c.closed_at FROM users u JOIN companies c ON c.id = u.company_id WHERE u.username = ? AND u.role IN ('lead','engineer')"
  )
    .bind(un)
    .first();
  if (!usr || usr.disabled || usr.closed_at || !(await checkPassword(pw, usr.pass_hash)))
    return bad(
      "That username and password don't match. Ask your office to reset your password if you've forgotten it.",
      401
    );
  const ck = await startSession(env, usr.id);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': ck },
  });
}

export async function crewApi(req, env, u, url, M) {
  const path = url.pathname.slice('/api/crew'.length) || '/';
  if (path === '/login' && M === 'POST') return crewLogin(req, env, ipKey(req.headers.get('CF-Connecting-IP') || ''));
  if (path === '/logout' && M === 'POST') {
    const t = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + CK + '=([^;]+)'));
    if (t)
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
        .bind(await sha256(t[1]))
        .run();
    return new Response('{"ok":true}', {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${CK}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    });
  }
  const cu = crewUser(u);
  if (!cu)
    return json({ ok: false, error: u ? 'This login cannot use the crew app. Ask your office.' : 'signed-out' }, 401);
  const hit = R.find(M, path);
  if (!hit) return bad('not found', 404);
  return hit.fn(env, cu, req, hit.params, url);
}
