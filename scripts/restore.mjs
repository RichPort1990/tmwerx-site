// Turn a weekly backup into SQL that reloads the database.
//   1. Download the backup from R2: Cloudflare dashboard -> R2 -> tmwerx-files-eu -> backups/weekly/<date>/database.json.gz(.enc)
//   2. BACKUP_KEY=... node scripts/restore.mjs database.json.gz.enc > restore.sql     (no BACKUP_KEY needed for a .json.gz)
//   3. Try it on a scratch database first:  npx wrangler d1 execute tmwerx --local --file restore.sql
//      Then, only if the live database is lost or damaged:  npx wrangler d1 execute tmwerx --remote --file restore.sql
// The SQL empties each backed-up table and reloads it (sign-ins, codes and rate limits are not backed up: everyone signs in again).
// Tables are created if missing, so it can also rebuild an empty database after: npx wrangler d1 migrations apply tmwerx
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/restore.mjs <database.json.gz[.enc]> > restore.sql');
  process.exit(2);
}
let data = readFileSync(file);
if (data.subarray(0, 5).toString() === 'CWXB1') {
  if (!process.env.BACKUP_KEY) {
    console.error('This backup is encrypted: set BACKUP_KEY to the key the Worker uses.');
    process.exit(2);
  }
  const k = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cwx-backup:' + process.env.BACKUP_KEY)),
    'AES-GCM',
    false,
    ['decrypt']
  );
  try {
    data = Buffer.from(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(5, 17) }, k, data.subarray(17))
    );
  } catch (e) {
    console.error('Could not decrypt: wrong BACKUP_KEY?');
    process.exit(1);
  }
}
const dump = JSON.parse(gunzipSync(data).toString('utf8'));
const lit = v =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? Number.isFinite(v)
        ? String(v)
        : 'NULL'
      : "'" + String(v).replace(/'/g, "''") + "'";
const out = [
  `-- CAD WerX restore from the backup of ${dump.at} (needs migration ${dump.migration})`,
  'PRAGMA defer_foreign_keys = true;',
  'DELETE FROM sessions;',
  'DELETE FROM device_codes;',
]; // everyone signs in again
for (const [t, { sql, rows }] of Object.entries(dump.tables)) {
  out.push(
    sql.replace(/^CREATE TABLE\s+(?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ') + ';',
    `DELETE FROM "${t}";`
  );
  for (const r of rows) {
    const ks = Object.keys(r);
    out.push(`INSERT INTO "${t}" (${ks.map(k => `"${k}"`).join(', ')}) VALUES (${ks.map(k => lit(r[k])).join(', ')});`);
  }
}
process.stdout.write(out.join('\n') + '\n');
console.error(
  `restore.sql: ${Object.keys(dump.tables).length} tables, ${Object.values(dump.tables).reduce((a, t) => a + t.rows.length, 0)} rows`
);
