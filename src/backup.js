// The weekly backup of the database, logos and company documents to R2. Photos and job files are not copied: they are
// written once and never changed in R2, which keeps them itself.
import { NEEDS_MIGRATION } from '../build/release.js';
import { enc, sendEmail } from './lib/core.js';
import { markRun } from './housekeeping.js';

/* ---------- weekly backup: the database and the logos, to R2 (Sunday 03:17 UTC) ----------
   BACKUPS bucket if bound, otherwise backups/ in the logo bucket. Encrypted (AES-256-GCM) when BACKUP_KEY is set.
   Kept: the last 8 weekly copies (so data deleted from the site is gone from the backups within 8 weeks, as the privacy
   notice says; signed agreements are kept in the database itself for 6 years). Restore with scripts/restore.mjs. */
// not backed up: short-lived rows (sign-ins, codes, rate limits, live locations)
export const SKIP_TABLES = new Set([
  'attempts',
  'outbox',
  'sessions',
  'device_codes',
  'd1_migrations',
  '_cf_KV',
  '_cf_METADATA',
  'tm_locations',
]);
export async function backupKey(env) {
  return env.BACKUP_KEY
    ? crypto.subtle.importKey(
        'raw',
        await crypto.subtle.digest('SHA-256', enc.encode('cwx-backup:' + env.BACKUP_KEY)),
        'AES-GCM',
        false,
        ['encrypt']
      )
    : null;
}
export async function backup(env) {
  const B = env.BACKUPS || env.FILES,
    root = env.BACKUPS ? '' : 'backups/';
  if (!B) return;
  try {
    const day = new Date().toISOString().slice(0, 10),
      pre = `${root}weekly/${day}/`;
    const tables = (
      await env.DB.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      ).all()
    ).results.filter(t => !SKIP_TABLES.has(t.name));
    const dump = { v: 1, at: new Date().toISOString(), migration: NEEDS_MIGRATION, tables: {} };
    for (const t of tables) {
      // paged by rowid (steady while rows are written, and no re-scan of earlier pages)
      const rows = [];
      for (let last = -1; ; ) {
        const r = (
          await env.DB.prepare(`SELECT rowid AS _rid, * FROM "${t.name}" WHERE rowid > ? ORDER BY rowid LIMIT 500`)
            .bind(last)
            .all()
        ).results;
        for (const x of r) {
          last = x._rid;
          delete x._rid;
          rows.push(x);
        }
        if (r.length < 500) break;
      }
      dump.tables[t.name] = { sql: t.sql, rows };
    }
    let data = new Uint8Array(
      await new Response(
        new Blob([JSON.stringify(dump)]).stream().pipeThrough(new CompressionStream('gzip'))
      ).arrayBuffer()
    );
    const key = await backupKey(env);
    // never a plain copy (it holds password hashes and customers' details) outside the test server
    if (!key && env.DEV_MODE !== '1')
      throw new Error('BACKUP_KEY is not set, so no backup was written. Set it: npx wrangler secret put BACKUP_KEY');
    if (key) {
      const iv = crypto.getRandomValues(new Uint8Array(12)),
        ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
      data = new Uint8Array(5 + 12 + ct.length);
      data.set(enc.encode('CWXB1'));
      data.set(iv, 5);
      data.set(ct, 17);
    }
    const name = key ? 'database.json.gz.enc' : 'database.json.gz';
    await B.put(pre + name, data);
    // the logos and each company's document library (docs/<company>/...)
    let logos = 0,
      projects = 0;
    for (const prefix of ['logos/', 'docs/']) {
      let cursor;
      do {
        const l = await env.FILES.list({ prefix, cursor });
        for (const o of l.objects) {
          const g = await env.FILES.get(o.key);
          if (g) {
            await B.put(pre + o.key, g.body, { httpMetadata: g.httpMetadata });
            if (prefix === 'logos/') logos++;
            else projects++;
          }
        }
        cursor = l.truncated ? l.cursor : null;
      } while (cursor);
    }
    await B.put(
      pre + 'done.json',
      JSON.stringify({
        at: dump.at,
        tables: Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, v.rows.length])),
        logos,
        projects,
        encrypted: !!key,
      })
    );
    // retention
    const weeks = new Set();
    let c2;
    do {
      const l = await B.list({ prefix: root + 'weekly/', cursor: c2 });
      for (const o of l.objects) {
        const m = o.key.slice(root.length).match(/^weekly\/([\d-]+)\//);
        if (m) weeks.add(m[1]);
      }
      c2 = l.truncated ? l.cursor : null;
    } while (c2);
    const drop = [...weeks]
      .sort()
      .reverse()
      .slice(8)
      .map(w => `${root}weekly/${w}/`);
    for (const d of drop) {
      let c3;
      do {
        const l = await B.list({ prefix: d, cursor: c3 });
        if (l.objects.length) await B.delete(l.objects.map(o => o.key));
        c3 = l.truncated ? l.cursor : null;
      } while (c3);
    }
    console.log(
      `backup ${pre}: ${Object.keys(dump.tables).length} tables, ${logos} logos, ${projects} documents${key ? ', encrypted' : ''}`
    );
    await markRun(env, 'backup');
  } catch (e) {
    console.error('backup failed: ' + ((e && e.stack) || e));
    for (const to of (env.ADMIN_EMAILS || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean))
      await sendEmail(
        env,
        to,
        'TM WerX weekly backup failed',
        'The weekly backup failed: ' + String((e && e.message) || e).slice(0, 500)
      ).catch(() => {});
  }
}
