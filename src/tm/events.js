// Records from site: saved exactly as sent (append only), then what they mean for the job, visit, van and office.
import { now, sendEmail, tooMany } from '../lib/core.js';
import { EVENT_KINDS } from './starter.js';
import { onEventTasks } from './tasks.js';
import { metres, num, pj, raiseAlert, settings, str, uid } from './util.js';

const SIG_MAX = 300000;
// a time from the phone, on our clock: corrected by the phone's clock error when that is more than 2 minutes, and
// believed only between a week ago (records kept on a phone with no signal) and now
export function phoneTime(t, skew) {
  t = num(t);
  if (!t) return null;
  if (skew && Math.abs(skew) > 120000) t -= skew;
  const n = now();
  return t > n - 7 * 864e5 && t < n + 300000 ? Math.round(Math.min(t, n)) : null;
}
// the shapes the office and the job pack rely on: lists are lists of plain objects, everything else plain values
const LISTS = ['items', 'mandatory'];
function cleanData(d) {
  const o = {};
  for (const [k, v] of Object.entries(d).slice(0, 40)) {
    if (LISTS.includes(k))
      o[k] = (Array.isArray(v) ? v : [])
        .filter(x => x && typeof x === 'object' && !Array.isArray(x))
        .slice(0, 300)
        .map(x =>
          Object.fromEntries(
            Object.entries(x)
              .slice(0, 12)
              .map(([a, b]) => [a, typeof b === 'object' ? null : b])
          )
        );
    else if (v == null || ['string', 'number', 'boolean'].includes(typeof v))
      o[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
  }
  return o;
}
// check one record from the phone; returns the row to insert, or an error
export function cleanEvent(e, u, offset = null) {
  if (!e || typeof e !== 'object') return { error: 'bad record' };
  const id = String(e.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'bad id' };
  if (!EVENT_KINDS.has(e.kind) || e.kind === 'location') return { error: 'unknown kind' };
  const data = cleanData(e.data && typeof e.data === 'object' && !Array.isArray(e.data) ? e.data : {});
  const dataStr = JSON.stringify(data);
  if (dataStr.length > 20000) return { error: 'record too large' };
  const sig = e.signature == null ? null : String(e.signature);
  if (sig && (sig.length > SIG_MAX || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig)))
    return { error: 'bad signature' };
  return {
    row: {
      id,
      company_id: u.company_id,
      job_id: str(e.job_id, 64),
      visit_id: str(e.visit_id, 64),
      vehicle_id: str(e.vehicle_id, 64),
      user_id: u.id,
      kind: e.kind,
      data: dataStr,
      signature: sig,
      lat: num(e.lat),
      lng: num(e.lng),
      acc: num(e.acc),
      client_time: phoneTime(e.client_time, offset),
      server_time: now(),
      skew: offset, // the phone's clock minus ours when the batch was sent (a wrong clock shows here)
    },
  };
}
export const insertEvent = (env, r) =>
  env.DB.prepare(
    'INSERT OR IGNORE INTO tm_events (id, company_id, job_id, visit_id, vehicle_id, user_id, kind, data, signature, lat, lng, acc, client_time, server_time, skew, by_office) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    r.id,
    r.company_id,
    r.job_id,
    r.visit_id,
    r.vehicle_id,
    r.user_id,
    r.kind,
    r.data,
    r.signature,
    r.lat,
    r.lng,
    r.acc,
    r.client_time,
    r.server_time,
    r.skew,
    r.by_office ? 1 : 0
  );

// the job status only moves forward (never back from completed or cancelled)
const ORDER = { scheduled: 0, in_progress: 1, completed: 2 };
const forward = (env, table, id, cid, to) =>
  env.DB.prepare(
    `UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ? AND company_id = ? AND status IN (${Object.keys(ORDER)
      .filter(k => ORDER[k] < ORDER[to])
      .map(k => `'${k}'`)
      .join(',')})`
  ).bind(to, now(), id, cid);

// urgent emails to the office. The alert itself is always raised; the emails are capped (3 in 10 minutes from one
// person, 30 an hour for a company) so a stuck or misused phone can't flood inboxes or use up the sending quota
async function emailAdmins(env, cid, uid, subject, text) {
  if ((await tooMany(env, 'alertmail:' + uid, 3, 10)) || (await tooMany(env, 'alertmailco:' + cid, 30, 60))) return;
  const rows = (
    await env.DB.prepare(
      "SELECT email FROM users WHERE company_id = ? AND role IN ('admin','office') AND disabled = 0 AND email IS NOT NULL"
    )
      .bind(cid)
      .all()
  ).results;
  for (const r of rows)
    await sendEmail(env, r.email, subject, text).catch(e => console.error('alert email: ' + e.message));
}
// what a new record means; runs once, only for records not seen before
export async function applyEvent(env, u, r) {
  const d = pj(r.data, {}),
    at = r.client_time || r.server_time,
    cid = u.company_id;
  const job = r.job_id
    ? await env.DB.prepare('SELECT * FROM tm_jobs WHERE id = ? AND company_id = ?').bind(r.job_id, cid).first()
    : null;
  const visit = r.visit_id
    ? await env.DB.prepare('SELECT * FROM tm_visits WHERE id = ? AND company_id = ?').bind(r.visit_id, cid).first()
    : null;
  const who = u.name,
    where = job ? `${job.number} ${job.address || ''}`.trim() : '';
  switch (r.kind) {
    case 'signin': {
      if (job && job.lat != null && r.lat != null) {
        const s = await settings(env, cid);
        const m = metres({ lat: job.lat, lng: job.lng }, { lat: r.lat, lng: r.lng });
        if (m > s.geofence_m)
          await raiseAlert(env, {
            company_id: cid,
            kind: 'off_site',
            ref: r.id,
            job_id: job.id,
            user_id: u.id,
            level: 'warn',
            title: `${who} signed in ${Math.round(m)} m from the site`,
            detail: `${where}. Reason given: ${d.reason || 'none'}`,
          });
      }
      break;
    }
    case 'started':
      if (visit) await forward(env, 'tm_visits', visit.id, cid, 'in_progress').run();
      if (job) await forward(env, 'tm_jobs', job.id, cid, 'in_progress').run();
      break;
    case 'risk_check':
      if (d.matches === false || d.controls === false || (d.extra && String(d.extra).trim()))
        await raiseAlert(env, {
          company_id: cid,
          kind: 'site_differs',
          ref: r.visit_id || r.id,
          job_id: r.job_id,
          user_id: u.id,
          level: 'warn',
          title: `Site check: ${d.matches === false ? 'site differs from the plan' : d.controls === false ? 'controls not all in place' : 'extra hazards'}`,
          detail: `${where}. ${who}: ${d.extra || ''} ${d.notes || ''}`.trim(),
        });
      break;
    case 'vehicle_check': {
      const defects = (d.items || []).filter(i => i && i.result === 'defect');
      if (r.vehicle_id) {
        const v = await env.DB.prepare('SELECT * FROM tm_vehicles WHERE id = ? AND company_id = ?')
          .bind(r.vehicle_id, cid)
          .first();
        if (v && d.safe === false) {
          await env.DB.prepare('UPDATE tm_vehicles SET unsafe = 1 WHERE id = ?').bind(v.id).run();
          await raiseAlert(env, {
            company_id: cid,
            kind: 'vehicle_unsafe',
            ref: v.id,
            user_id: u.id,
            level: 'urgent',
            title: `${v.reg} reported NOT safe to use`,
            detail: `${who}: ${defects.map(i => `${i.item}${i.note ? ' (' + i.note + ')' : ''}`).join('; ') || d.notes || 'no details'}`,
          });
          await emailAdmins(
            env,
            cid,
            u.id,
            `TM WerX: ${v.reg} reported not safe`,
            `${who} has reported ${v.reg} as NOT safe to use.\n\nDefects: ${defects.map(i => i.item).join(', ') || 'see the check'}\n\nIt cannot be put on a job until it is cleared in the office app (Vehicles).`
          );
        } else if (v && defects.length)
          await raiseAlert(env, {
            company_id: cid,
            kind: 'vehicle_defect',
            ref: r.id,
            user_id: u.id,
            level: 'warn',
            title: `${v.reg}: ${defects.length} defect${defects.length > 1 ? 's' : ''} reported`,
            detail: `${who}: ${defects.map(i => `${i.item}${i.note ? ' (' + i.note + ')' : ''}`).join('; ')}`,
          });
      }
      break;
    }
    case 'returned': {
      // compare what came back with what went out on this visit
      const out = await env.DB.prepare(
        "SELECT data FROM tm_events WHERE company_id = ? AND visit_id = ? AND kind = 'loaded' ORDER BY server_time DESC LIMIT 1"
      )
        .bind(cid, r.visit_id || '')
        .first();
      const loaded = new Map((pj(out && out.data, {}).items || []).map(i => [i.code || i.name, i]));
      const short = (d.items || [])
        .map(i => ({ i, l: loaded.get(i.code || i.name) }))
        .filter(x => x.l && (+x.i.qty || 0) < (+x.l.qty || 0))
        .map(x => `${(+x.l.qty || 0) - (+x.i.qty || 0)} × ${x.l.name}${x.i.left_on_site ? ' (left on site)' : ''}`);
      if (short.length)
        await raiseAlert(env, {
          company_id: cid,
          kind: 'kit_missing',
          ref: r.visit_id || r.id,
          job_id: r.job_id,
          user_id: u.id,
          level: 'warn',
          title: `Equipment not back: ${short.length} item${short.length > 1 ? 's' : ''}`,
          detail: `${where}. ${short.join('; ')}`,
        });
      break;
    }
    case 'day_complete':
    case 'job_complete':
    case 'failed_visit': {
      if (visit)
        await env.DB.prepare(
          "UPDATE tm_visits SET status = ?, review = 'pending', updated_at = ? WHERE id = ? AND status NOT IN ('cancelled')"
        )
          .bind(r.kind === 'failed_visit' ? 'failed' : 'completed', now(), visit.id)
          .run();
      if (job && r.kind === 'job_complete' && d.finished !== false)
        await forward(env, 'tm_jobs', job.id, cid, 'completed').run();
      if (r.kind === 'failed_visit' || d.site_clear === false)
        await raiseAlert(env, {
          company_id: cid,
          kind: r.kind === 'failed_visit' ? 'visit_failed' : 'site_not_clear',
          ref: r.visit_id || r.id,
          job_id: r.job_id,
          user_id: u.id,
          level: 'warn',
          title:
            r.kind === 'failed_visit'
              ? `Visit could not go ahead: ${d.reason || 'no reason given'}`
              : 'Site NOT left clear and safe',
          detail: `${where}. ${who}: ${d.notes || ''}`,
        });
      await env.DB.prepare('DELETE FROM tm_lone WHERE user_id = ?').bind(u.id).run();
      break;
    }
    case 'change_request':
      await raiseAlert(env, {
        company_id: cid,
        kind: 'change_request',
        ref: r.id,
        job_id: r.job_id,
        user_id: u.id,
        level: 'warn',
        title: 'Site differs from the drawing: change requested',
        detail: `${where}. ${who}: ${d.text || ''}${d.measure ? ' Measured: ' + d.measure : ''}`,
      });
      break;
    case 'near_miss':
      await raiseAlert(env, {
        company_id: cid,
        kind: 'near_miss',
        ref: r.id,
        job_id: r.job_id,
        user_id: u.id,
        level: 'warn',
        title: `Near miss reported by ${who}`,
        detail: `${where}. ${d.text || ''}`,
      });
      await env.DB.prepare(
        'INSERT OR IGNORE INTO tm_actions (id, company_id, source, ref, title, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(uid(), cid, 'near_miss', r.id, `Review near miss: ${String(d.text || '').slice(0, 120)}`, 'open', now())
        .run();
      break;
    case 'panic':
      await raiseAlert(env, {
        company_id: cid,
        kind: 'panic',
        ref: r.id,
        job_id: r.job_id,
        user_id: u.id,
        level: 'urgent',
        title: `PANIC ALARM: ${who}`,
        detail: `${where}. Position: ${r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} (±${Math.round(r.acc || 0)} m)` : 'not known'}. Phone ${u.phone || 'not on file'}. Raised ${new Date(at).toISOString()}.`,
      });
      await emailAdmins(
        env,
        cid,
        u.id,
        `URGENT: panic alarm from ${who}`,
        `${who} raised a panic alarm at ${new Date(at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}.\n\n${where}\nPosition: ${r.lat != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : 'not known'}\nPhone: ${u.phone || 'not on file'}\n\nCall them now. If you cannot reach them, call 999.`
      );
      break;
    case 'lone_start': {
      const s = await settings(env, cid),
        every = Math.max(15, Math.min(240, +d.every_mins || s.lone_every_mins));
      await env.DB.prepare(
        'INSERT INTO tm_lone (user_id, company_id, visit_id, every_mins, next_due, last_checkin, missed, started_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(user_id) DO UPDATE SET visit_id = excluded.visit_id, every_mins = excluded.every_mins, next_due = excluded.next_due, last_checkin = excluded.last_checkin, missed = 0'
      )
        .bind(u.id, cid, r.visit_id, every, at + every * 60e3, at, at)
        .run();
      break;
    }
    case 'checkin':
      await env.DB.prepare(
        'UPDATE tm_lone SET last_checkin = ?, next_due = ? + every_mins * 60000, missed = 0 WHERE user_id = ?'
      )
        .bind(at, Math.max(at, now() - 60e3), u.id)
        .run();
      await env.DB.prepare(
        "UPDATE tm_alerts SET ack_at = ?, ack_by = 'system' WHERE company_id = ? AND kind = 'checkin_missed' AND ref = ? AND ack_at IS NULL"
      )
        .bind(now(), cid, u.id)
        .run();
      break;
    case 'lone_stop':
    case 'signout':
      await env.DB.prepare('DELETE FROM tm_lone WHERE user_id = ?').bind(u.id).run();
      break;
    case 'photo_reason':
      if (d.task_id)
        await env.DB.prepare('UPDATE tm_photo_tasks SET reason = ? WHERE id = ? AND company_id = ?')
          .bind(str(d.reason, 300), d.task_id, cid)
          .run();
      break;
  }
  if (job && visit) await onEventTasks(env, job, visit, r.kind, at);
}
