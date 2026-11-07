// Photo schedules: which rules apply to a visit, the tasks they create, and matching photos to tasks.
import { now } from '../lib/core.js';

// the site event that starts each kind of event rule
export const TRIGGERS = {
  arrival: 'signin',
  before_work: 'started',
  setup: 'installed',
  removal: 'returned',
  site_clear: 'day_complete',
};
export const TRIGGER_OF = Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [v, k]));

// a wall-clock time in the UK on a date, as a timestamp (BST or GMT)
export function londonTime(date, hhmm) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const shown = new Date(guess).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [h, m] = shown.split(':').map(Number),
    [H, M] = hhmm.split(':').map(Number);
  return guess - ((h * 60 + m - (H * 60 + M) + 1440) % 1440) * 60e3;
}
export async function rulesFor(env, job) {
  const rows = (
    await env.DB.prepare('SELECT * FROM tm_photo_rules WHERE company_id = ? AND active = 1').bind(job.company_id).all()
  ).results;
  const applies = r =>
    r.scope === 'company' ||
    (r.scope === 'client' && r.scope_ref && r.scope_ref === job.client_id) ||
    (r.scope === 'tm_type' && r.scope_ref && r.scope_ref === job.tm_type) ||
    (r.scope === 'job' && r.scope_ref === job.id);
  // overlapping rules for the same moment and photo: shown once, with the strictest (shortest) grace
  const out = new Map();
  for (const r of rows.filter(applies)) {
    const k = [r.trig, r.event || '', r.every_mins || '', r.at_time || '', r.label.toLowerCase()].join('|');
    const o = out.get(k);
    if (!o || r.grace_mins < o.grace_mins || r.count > o.count)
      out.set(
        k,
        o
          ? Object.assign({}, r, {
              count: Math.max(r.count, o.count),
              grace_mins: Math.min(r.grace_mins, o.grace_mins),
            })
          : r
      );
  }
  return [...out.values()];
}
export const taskStmt = (env, job, visit, rule, dueAt) =>
  env.DB.prepare(
    'INSERT OR IGNORE INTO tm_photo_tasks (id, company_id, job_id, visit_id, rule_id, label, count, due_at, grace_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    taskId(visit.id, rule.id, dueAt),
    job.company_id,
    job.id,
    visit.id,
    rule.id,
    rule.label,
    rule.count || 1,
    dueAt,
    dueAt + (rule.grace_mins || 10) * 60e3,
    now()
  );
// the same id on the phone and here, so a photo taken with no signal names its task before the server has made it
export const taskId = (visitId, ruleId, dueAt) => `${visitId}:${ruleId}:${Math.round(dueAt)}`;

// a site event has happened: tasks for the event rules it starts (once per visit, from when it happened on the phone)
export async function onEventTasks(env, job, visit, kind, at) {
  const trig = TRIGGER_OF[kind] || (kind === 'job_complete' ? 'site_clear' : null);
  if (!visit || (!trig && !['started', 'failed_visit'].includes(kind))) return;
  const all = await rulesFor(env, job);
  // work has started: the timed photos for the shift are set out now, so the phone knows them even without signal
  // only the first start of a visit sets them out (a second Start, or a replayed one, adds nothing)
  const timed = all
    .filter(r => (r.trig === 'repeat' && r.every_mins >= 15) || (r.trig === 'daily' && r.at_time))
    .map(r => r.id);
  const already =
    kind === 'started' &&
    timed.length &&
    (await env.DB.prepare(
      'SELECT 1 FROM tm_photo_tasks WHERE visit_id = ? AND rule_id IN (SELECT value FROM json_each(?)) LIMIT 1'
    )
      .bind(visit.id, JSON.stringify(timed))
      .first());
  if (kind === 'started' && !already) {
    const q = [];
    for (const r of all.filter(r => r.trig === 'repeat' && r.every_mins >= 15))
      for (let t = at + r.every_mins * 60e3; t <= at + 16 * 3600e3; t += r.every_mins * 60e3)
        q.push(taskStmt(env, job, visit, r, t));
    for (const r of all.filter(r => r.trig === 'daily' && r.at_time)) {
      const t = londonTime(visit.date, r.at_time);
      if (t > at) q.push(taskStmt(env, job, visit, r, t));
    }
    if (q.length) await env.DB.batch(q);
  }
  // the visit is over: timed photos after this are no longer owed
  if (['day_complete', 'job_complete', 'failed_visit'].includes(kind))
    await env.DB.prepare(
      "DELETE FROM tm_photo_tasks WHERE visit_id = ? AND status = 'due' AND due_at > ? AND rule_id IN (SELECT id FROM tm_photo_rules WHERE trig IN ('repeat','daily'))"
    )
      .bind(visit.id, at)
      .run();
  const rules = all.filter(r => r.trig === 'event' && r.event === trig);
  if (!rules.length) return;
  const have = new Set(
    (await env.DB.prepare('SELECT rule_id FROM tm_photo_tasks WHERE visit_id = ?').bind(visit.id).all()).results.map(
      r => r.rule_id
    )
  );
  const q = rules.filter(r => !have.has(r.id)).map(r => taskStmt(env, job, visit, r, at));
  if (q.length) await env.DB.batch(q);
}
// a photo has arrived: does it settle a task? (taken in time = on time, even if it arrived later)
export async function matchPhoto(env, photo) {
  if (!photo.task_id) return;
  // only a task of the photo's own visit (the visit was checked as the sender's when the photo arrived)
  if (!photo.visit_id) return;
  let t = await env.DB.prepare('SELECT * FROM tm_photo_tasks WHERE id = ? AND company_id = ? AND visit_id = ?')
    .bind(photo.task_id, photo.company_id, photo.visit_id)
    .first();
  // the phone worked the time out from a different crew member's record than the server did (two people signed
  // in, say): the same visit and rule within half an hour is the same photo
  const m = !t && /^([\w-]{1,64}):([\w-]{1,64}):(\d{13})$/.exec(photo.task_id);
  if (m && m[1] === photo.visit_id)
    t = await env.DB.prepare(
      'SELECT * FROM tm_photo_tasks WHERE company_id = ? AND visit_id = ? AND rule_id = ? AND ABS(due_at - ?) < 1800000 ORDER BY ABS(due_at - ?) LIMIT 1'
    )
      .bind(photo.company_id, m[1], m[2], +m[3], +m[3])
      .first();
  if (t && t.id !== photo.task_id)
    await env.DB.prepare('UPDATE tm_photos SET task_id = ? WHERE id = ? AND company_id = ?')
      .bind(t.id, photo.id, photo.company_id)
      .run();
  // done already, or missed: past the company's limit for photos sent late (a late photo never replaces a missed one)
  if (!t || t.status !== 'due') return;
  const n = // taken from a quarter of an hour before it was due up to the end of its allowance
    (
      await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM tm_photos WHERE task_id = ? AND company_id = ? AND taken_at BETWEEN ? AND ?'
      )
        .bind(t.id, t.company_id, t.due_at - 900000, t.grace_until)
        .first()
    ).n;
  if (n < t.count) return;
  const late = photo.received_at > t.grace_until ? 1 : 0;
  await env.DB.prepare(
    "UPDATE tm_photo_tasks SET status = 'done', done_at = ?, late = ? WHERE id = ? AND status <> 'done'"
  )
    .bind(photo.taken_at, late, t.id)
    .run();
  await env.DB.prepare(
    "UPDATE tm_alerts SET ack_at = ?, ack_by = 'system' WHERE company_id = ? AND kind = 'photo_overdue' AND ref = ? AND ack_at IS NULL"
  )
    .bind(now(), t.company_id, t.id)
    .run();
}
