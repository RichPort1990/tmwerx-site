// The half-hourly and daily clean-ups (scheduled).
import { loginRows } from './auth.js';
import { applySubscription, stripe, syncSeats } from './billing.js';
import { DAY, SESSION_DAYS, logErr, now } from './lib/core.js';
import { purgeCompany, tmRetention } from './tm/purge.js';

// when a scheduled job last finished, for the health check (alerts table: k = 'last:<job>')
export const markRun = (env, job) =>
  env.DB.prepare('INSERT INTO alerts (k, at) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at')
    .bind('last:' + job, Date.now())
    .run()
    .catch(e => console.error('mark run: ' + e.message));
export async function housekeeping(env) {
  const failed = [];
  const run = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      console.error('housekeeping ' + what + ': ' + e.message);
      failed.push(what);
    }
  };
  try {
    return await housekeepingRuns(env, run);
  } finally {
    // the health check reports a step that failed, or a run that has not happened
    await markRun(env, 'housekeeping');
    if (failed.length)
      await env.DB.prepare('INSERT INTO alerts (k, at) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at')
        .bind('fail:housekeeping:' + failed.join(','), Date.now())
        .run()
        .catch(() => {});
  }
}
async function housekeepingRuns(env, run) {
  // every half hour: billing; once a day (03:00 UTC run): the clean-ups, each of which reads whole tables
  // (on the test server every run does everything, so the tests need not wait for 3 am)
  const daily = env.DEV_MODE === '1' || (new Date().getUTCHours() === 3 && new Date().getUTCMinutes() < 30);
  await run('seats', async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT c.id FROM companies c WHERE c.closed_at IS NULL AND c.stripe_item IS NOT NULL AND c.sub_status IN ('active','trialing','past_due') AND (c.seats_dirty = 1 OR c.seats_paid <> (SELECT MAX(1, COUNT(*)) FROM users u WHERE u.company_id = c.id AND u.disabled = 0))"
      ).all()
    ).results;
    for (const r of rows) await syncSeats(env, r.id);
  });
  // a renewal date in the past means we missed Stripe's event: ask Stripe how it stands now
  await run('renewals', async () => {
    const rows = (
      await env.DB.prepare(
        "SELECT id, stripe_sub FROM companies WHERE closed_at IS NULL AND stripe_sub IS NOT NULL AND sub_status IN ('active','trialing','past_due') AND period_end < ? LIMIT 50"
      )
        .bind(now() - 3600e3)
        .all()
    ).results;
    for (const r of rows) {
      try {
        await applySubscription(env, await stripe(env, 'GET', `subscriptions/${r.stripe_sub}`), r.id);
      } catch (e) {
        console.error('renewal check ' + r.id + ': ' + e.message);
      }
    }
  });
  // sign-ups never confirmed within 48 hours are removed (the address can then be used again)
  if (daily)
    await run('unverified', async () => {
      const rows = (
        await env.DB.prepare(
          "SELECT u.id, u.company_id FROM users u JOIN companies c ON c.id = u.company_id WHERE u.verified = 0 AND u.role = 'admin' AND u.created_at < ? AND c.stripe_customer IS NULL AND (SELECT COUNT(*) FROM users x WHERE x.company_id = c.id) = 1 LIMIT 200"
        )
          .bind(now() - 2 * DAY)
          .all()
      ).results;
      for (const r of rows)
        await env.DB.batch([
          ...loginRows(env, r.id, { forGood: true }),
          env.DB.prepare('DELETE FROM tokens WHERE user_id = ? OR company_id = ?').bind(r.id, r.company_id),
          env.DB.prepare('DELETE FROM users WHERE id = ?').bind(r.id),
          env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(r.company_id),
        ]);
    });
  // closed accounts: personal data goes 90 days after closing; signed agreements are kept (evidence of the contract)
  if (daily)
    await run('closed', async () => {
      const rows = (
        await env.DB.prepare(
          'SELECT id FROM companies WHERE closed_at IS NOT NULL AND closed_at < ? AND purged_at IS NULL LIMIT 50'
        )
          .bind(now() - 90 * DAY)
          .all()
      ).results;
      for (const r of rows) {
        await env.FILES.delete('logos/' + r.id).catch(logErr('r2'));
        // the company's jobs, records, photos and files
        await purgeCompany(env, r.id);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').bind(
            r.id
          ),
          env.DB.prepare(
            'DELETE FROM tokens WHERE company_id = ? OR user_id IN (SELECT id FROM users WHERE company_id = ?)'
          ).bind(r.id, r.id),
          ...['devices', 'device_codes', 'session_ends'].map(t =>
            env.DB.prepare(`DELETE FROM ${t} WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`).bind(r.id)
          ),
          env.DB.prepare('DELETE FROM users WHERE company_id = ?').bind(r.id),
          env.DB.prepare(
            'UPDATE companies SET logo_type = NULL, domain = NULL, domain_claim = NULL, purged_at = ? WHERE id = ?'
          ).bind(now(), r.id),
        ]);
      }
    });
  // TM WerX records past each company's retention period, and stale live locations
  if (daily) await run('tm retention', () => tmRetention(env));
  if (daily)
    await run('retention', async () =>
      env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
        env.DB.prepare('DELETE FROM tokens WHERE expires_at < ? OR used = 1').bind(now()), // a used or expired link is deleted at the next run
        // signed agreements: kept 6 years after the account closed (the contract's limitation period), then deleted
        env.DB.prepare(
          'DELETE FROM acceptances WHERE company_id IN (SELECT id FROM companies WHERE closed_at IS NOT NULL AND closed_at < ?)'
        ).bind(now() - 6 * 365.25 * DAY),
        env.DB.prepare(
          'DELETE FROM terms_docs WHERE hash NOT IN (SELECT doc_hash FROM acceptances) AND created_at < ?'
        ).bind(now() - 30 * DAY),
        env.DB.prepare('DELETE FROM attempts WHERE at < ?').bind(now() - DAY),
        env.DB.prepare('DELETE FROM device_codes WHERE expires_at < ?').bind(now()),
        env.DB.prepare('DELETE FROM session_ends WHERE at < ?').bind(now() - SESSION_DAYS * DAY),
        env.DB.prepare('DELETE FROM devices WHERE last_seen < ?').bind(now() - 400 * DAY),
        env.DB.prepare('DELETE FROM stripe_events WHERE received_at < ?').bind(now() - 90 * DAY),
        env.DB.prepare('DELETE FROM outbox WHERE created_at < ?').bind(now() - 7 * DAY),
      ])
    );
}
