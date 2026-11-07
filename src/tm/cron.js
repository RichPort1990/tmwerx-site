// Every minute: photo reminders and overdue photos, lone-working check-ins, crews out of contact; once a day: MOTs,
// services, qualifications and permits running out.
import { now, sendEmail } from '../lib/core.js';
import { pushTo } from './push.js';
import { ukDate, raiseAlert, settings } from './util.js';

const crewOf = async (env, visitId) =>
  (await env.DB.prepare('SELECT user_id FROM tm_assign WHERE visit_id = ?').bind(visitId).all()).results.map(
    r => r.user_id
  );
const fmt = t =>
  new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });

async function photoTasks(env) {
  const t = now();
  // due now: remind the crew (level 0 -> 1)
  const due = (
    await env.DB.prepare(
      // at most 25 a minute for any one company, newest first, so one busy (or misused) account can't hold up the rest
      "SELECT * FROM (SELECT t.*, j.number, ROW_NUMBER() OVER (PARTITION BY t.company_id ORDER BY t.due_at DESC) AS rn FROM tm_photo_tasks t JOIN tm_jobs j ON j.id = t.job_id WHERE t.status = 'due' AND t.alert_level = 0 AND t.due_at <= ?) WHERE rn <= 25 LIMIT 400"
    )
      .bind(t)
      .all()
  ).results;
  for (const k of due) {
    await env.DB.prepare('UPDATE tm_photo_tasks SET alert_level = 1 WHERE id = ?').bind(k.id).run();
    if (k.due_at < t - 2 * 3600e3) continue; // found long after it was due: the office alert below covers it
    await pushTo(env, await crewOf(env, k.visit_id), {
      title: 'Photo due now',
      body: `${k.label}${k.count > 1 ? ' (' + k.count + ')' : ''} · ${k.number}`,
      url: `/crew/#v/${k.visit_id}`,
      tag: 'task-' + k.id,
      urgent: true,
    });
  }
  // past its grace time: tell the office (level 1 -> 2), then escalate (2 -> 3)
  const late = (
    await env.DB.prepare(
      "SELECT * FROM (SELECT t.*, j.number, j.address, r.escalate_mins, ROW_NUMBER() OVER (PARTITION BY t.company_id ORDER BY t.grace_until DESC) AS rn FROM tm_photo_tasks t JOIN tm_jobs j ON j.id = t.job_id LEFT JOIN tm_photo_rules r ON r.id = t.rule_id WHERE t.status = 'due' AND t.alert_level < 3 AND t.grace_until < ?) WHERE rn <= 25 LIMIT 400"
    )
      .bind(t)
      .all()
  ).results;
  for (const k of late) {
    const esc = (k.escalate_mins || 30) * 60e3;
    const level = t > k.grace_until + esc ? 3 : 2;
    if (level <= k.alert_level) continue;
    const crew = await crewOf(env, k.visit_id);
    const seen = crew.length
      ? (
          await env.DB.prepare(`SELECT MAX(last_seen) AS t FROM users WHERE id IN (SELECT value FROM json_each(?))`)
            .bind(JSON.stringify(crew))
            .first()
        ).t
      : null;
    const quiet = !seen || t - seen > 20 * 60e3;
    await raiseAlert(env, {
      company_id: k.company_id,
      kind: 'photo_overdue',
      ref: k.id,
      job_id: k.job_id,
      level: level === 3 ? 'urgent' : 'warn',
      title: `${level === 3 ? 'Still overdue' : 'Photo overdue'}: ${k.label} (due ${fmt(k.due_at)})`,
      detail: `${k.number} ${k.address || ''}.${quiet ? ` No contact from the crew since ${seen ? fmt(seen) : 'they started'}: they may be without signal, in which case the photo arrives when they reconnect.` : ''}`,
    });
    await env.DB.prepare('UPDATE tm_photo_tasks SET alert_level = ? WHERE id = ?').bind(level, k.id).run();
    if (level === 3)
      await pushTo(env, crew, {
        title: 'Photo still overdue',
        body: `${k.label} · ${k.number}. Take it now, or say why it can't be done.`,
        url: `/crew/#v/${k.visit_id}`,
        tag: 'task-' + k.id,
        urgent: true,
      });
  }
  // past the company's limit for photos sent late: missed for good (a later photo never replaces it)
  const cos = (
    await env.DB.prepare("SELECT DISTINCT company_id FROM tm_photo_tasks WHERE status = 'due' AND grace_until < ?")
      .bind(t - 3600e3)
      .all()
  ).results;
  for (const c of cos) {
    const s = await settings(env, c.company_id);
    await env.DB.prepare(
      "UPDATE tm_photo_tasks SET status = 'missed' WHERE company_id = ? AND status = 'due' AND grace_until < ?"
    )
      .bind(c.company_id, t - s.late_photo_hours * 3600e3)
      .run();
  }
}

async function loneWorking(env) {
  const t = now();
  const rows = (
    await env.DB.prepare(
      'SELECT l.*, x.name, x.phone, x.company_id FROM tm_lone l JOIN users x ON x.id = l.user_id WHERE l.next_due <= ?'
    )
      .bind(t)
      .all()
  ).results;
  for (const l of rows) {
    if (!l.missed) {
      await env.DB.prepare('UPDATE tm_lone SET missed = 1 WHERE user_id = ?').bind(l.user_id).run();
      await pushTo(env, [l.user_id], {
        title: 'Check in now',
        body: 'Tap to confirm you are safe.',
        url: l.visit_id ? `/crew/#v/${l.visit_id}` : '/crew/',
        tag: 'checkin',
        urgent: true,
      });
    } else if (l.missed === 1 && t > l.next_due + 10 * 60e3) {
      await env.DB.prepare('UPDATE tm_lone SET missed = 2 WHERE user_id = ?').bind(l.user_id).run();
      const loc = await env.DB.prepare('SELECT * FROM tm_locations WHERE user_id = ?').bind(l.user_id).first();
      const detail = `Last check-in ${l.last_checkin ? fmt(l.last_checkin) : 'none'}. Phone ${l.phone || 'not on file'}.${loc ? ` Last known position ${fmt(loc.at)}: https://www.google.com/maps?q=${loc.lat},${loc.lng}` : ''}`;
      await raiseAlert(env, {
        company_id: l.company_id,
        kind: 'checkin_missed',
        ref: l.user_id,
        user_id: l.user_id,
        level: 'urgent',
        title: `${l.name} missed a lone-working check-in`,
        detail,
      });
      const office = (
        await env.DB.prepare(
          "SELECT email FROM users WHERE company_id = ? AND role IN ('admin','office') AND disabled = 0 AND email IS NOT NULL"
        )
          .bind(l.company_id)
          .all()
      ).results;
      for (const o of office)
        await sendEmail(
          env,
          o.email,
          `URGENT: ${l.name} missed a check-in`,
          `${l.name} was due to check in at ${fmt(l.next_due)} and has not.\n\n${detail}\n\nTry to call them now. They may be without signal. If you cannot reach them, follow your lone-working procedure.`
        ).catch(e => console.error('lone email: ' + e.message));
    }
  }
}

async function outOfContact(env) {
  const t = now();
  const rows = (
    await env.DB.prepare(
      "SELECT DISTINCT x.id, x.name, x.company_id, x.last_seen FROM tm_visits v JOIN tm_assign a ON a.visit_id = v.id JOIN users x ON x.id = a.user_id WHERE v.status = 'in_progress' AND x.disabled = 0 AND x.last_seen IS NOT NULL AND x.last_seen < ?"
    )
      .bind(t - 3600e3)
      .all()
  ).results;
  for (const r of rows) {
    const s = await settings(env, r.company_id);
    if (t - r.last_seen < s.pending_limit_hours * 3600e3) continue;
    await raiseAlert(env, {
      company_id: r.company_id,
      kind: 'no_contact',
      ref: `${r.id}:${new Date(r.last_seen).toISOString().slice(0, 13)}`,
      user_id: r.id,
      level: 'warn',
      title: `No contact from ${r.name} since ${fmt(r.last_seen)}`,
      detail: 'Their records and photos are kept on the phone until it has signal. If this goes on, call them.',
    });
  }
}

// once a day, about 06:00 UK time: things running out
async function daily(env) {
  const day = ukDate(),
    soon = ukDate(now() + 14 * 864e5),
    month = ukDate(now() + 30 * 864e5);
  const v = (await env.DB.prepare('SELECT * FROM tm_vehicles WHERE off_road = 0').all()).results;
  for (const x of v)
    for (const [k, label] of [
      ['mot_due', 'MOT'],
      ['tax_due', 'Road tax'],
      ['service_due', 'Service'],
      ['insurance_due', 'Insurance'],
    ])
      if (x[k] && x[k] <= soon)
        await raiseAlert(env, {
          company_id: x.company_id,
          kind: 'vehicle_due',
          ref: `${x.id}:${k}:${x[k]}`,
          level: x[k] < day ? 'urgent' : 'warn',
          title: `${x.reg}: ${label} ${x[k] < day ? 'overdue since' : 'due'} ${x[k]}`,
        });
  const q = (
    await env.DB.prepare(
      'SELECT q.*, x.name AS person FROM tm_quals q JOIN users x ON x.id = q.user_id WHERE x.disabled = 0 AND q.expires IS NOT NULL AND q.expires <= ?'
    )
      .bind(month)
      .all()
  ).results;
  for (const x of q)
    await raiseAlert(env, {
      company_id: x.company_id,
      kind: 'qual_expiry',
      ref: `${x.id}:${x.expires}`,
      user_id: x.user_id,
      level: x.expires < day ? 'urgent' : 'warn',
      title: `${x.person}: ${x.name} ${x.expires < day ? 'expired' : 'expires'} ${x.expires}`,
    });
  const p = (
    await env.DB.prepare(
      "SELECT j.* FROM tm_jobs j WHERE j.status IN ('scheduled','in_progress') AND j.permit_end IS NOT NULL AND j.permit_end <= ? AND EXISTS (SELECT 1 FROM tm_visits v WHERE v.job_id = j.id AND v.status IN ('scheduled','in_progress'))"
    )
      .bind(ukDate(now() + 2 * 864e5))
      .all()
  ).results;
  for (const j of p)
    await raiseAlert(env, {
      company_id: j.company_id,
      kind: 'permit_ending',
      ref: `${j.id}:${j.permit_end}`,
      job_id: j.id,
      level: 'urgent',
      title: `${j.number}: permit ${j.permit_ref || ''} ends ${j.permit_end} with work still to do`,
      detail: 'Extend the permit or bring the removal forward to avoid an overrun charge.',
    });
}

export async function tmTick(env) {
  const run = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error('tm ' + what + ': ' + e.message);
    }
  };
  await run('photos', () => photoTasks(env));
  await run('lone', () => loneWorking(env));
  await run('contact', () => outOfContact(env));
  await run('positions', () =>
    env.DB.prepare('DELETE FROM tm_locations WHERE at < ?')
      .bind(Date.now() - 2 * 3600e3)
      .run()
  );
  const uk = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (uk === '06:00' || env.DEV_MODE === '1') await run('daily', () => daily(env));
}
