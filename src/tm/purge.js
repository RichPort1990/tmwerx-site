// Deleting TM WerX data: a closed company's everything (90 days after closing), and records past each company's
// retention period.
import { DAY, now } from '../lib/core.js';
import { settings } from './util.js';

const TABLES = [
  'tm_assign',
  'tm_photo_tasks',
  'tm_events',
  'tm_photos',
  'tm_drawings',
  'tm_visits',
  'tm_jobs',
  'tm_alerts',
  'tm_intake',
  'tm_actions',
  'tm_audits',
  'tm_push',
  'tm_locations',
  'tm_lone',
  'tm_quals',
  'tm_vehicles',
  'tm_clients',
  'tm_docs',
  'tm_photo_rules',
  'tm_log',
  'tm_settings',
];

async function deletePrefix(env, prefix) {
  let cursor;
  for (let k = 0; k < 200; k++) {
    const l = await env.FILES.list({ prefix, cursor, limit: 1000 });
    if (l.objects.length) await env.FILES.delete(l.objects.map(o => o.key));
    if (!l.truncated) break;
    cursor = l.cursor;
  }
}
export async function purgeCompany(env, cid) {
  await deletePrefix(env, `co/${cid}/`);
  await deletePrefix(env, `docs/${cid}/`);
  await env.DB.batch(TABLES.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE company_id = ?`).bind(cid)));
}
// jobs finished more than the company's retention period ago go, with their records, photos and drawings
export async function tmRetention(env) {
  // only the latest position while signed in, and only for two hours (as the privacy policy says)
  await env.DB.prepare('DELETE FROM tm_locations WHERE at < ?')
    .bind(now() - 2 * 3600e3)
    .run();
  await env.DB.prepare("DELETE FROM tm_intake WHERE status = 'rejected' AND decided_at < ?")
    .bind(now() - 90 * DAY)
    .run();
  await env.DB.prepare('DELETE FROM tm_alerts WHERE ack_at IS NOT NULL AND ack_at < ?')
    .bind(now() - 400 * DAY)
    .run();
  const cos = (await env.DB.prepare('SELECT company_id FROM tm_settings').all()).results;
  for (const c of cos) {
    const s = await settings(env, c.company_id);
    const cut = new Date(now() - Math.max(1, s.retention_years) * 365.25 * DAY).toISOString().slice(0, 10);
    const old = (
      await env.DB.prepare(
        "SELECT id FROM tm_jobs WHERE company_id = ? AND status IN ('completed','cancelled') AND COALESCE(end_date, start_date, '0000') < ? LIMIT 100"
      )
        .bind(c.company_id, cut)
        .all()
    ).results;
    for (const j of old) {
      const keys = [
        ...(await env.DB.prepare('SELECT r2_key AS k FROM tm_photos WHERE job_id = ?').bind(j.id).all()).results,
        ...(await env.DB.prepare('SELECT pdf_key AS k FROM tm_drawings WHERE job_id = ?').bind(j.id).all()).results,
      ].map(r => r.k);
      for (let i = 0; i < keys.length; i += 1000) await env.FILES.delete(keys.slice(i, i + 1000));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM tm_assign WHERE visit_id IN (SELECT id FROM tm_visits WHERE job_id = ?)').bind(
          j.id
        ),
        ...['tm_photo_tasks', 'tm_events', 'tm_photos', 'tm_drawings', 'tm_visits', 'tm_alerts'].map(t =>
          env.DB.prepare(`DELETE FROM ${t} WHERE job_id = ?`).bind(j.id)
        ),
        env.DB.prepare('DELETE FROM tm_jobs WHERE id = ?').bind(j.id),
      ]);
    }
  }
}
