// One job as a zip file: its records (JSON), the job pack (HTML), the drawings and every photo, unchanged, so
// their fingerprints still match. Written as it goes (no compression: photos and PDFs are compressed already).
import { esc } from '../pages.js';
import { log, pj } from './util.js';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const enc = new TextEncoder();
function dosTime(d) {
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}
export async function jobZip(env, u, j) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const central = [];
  let offset = 0;
  const add = async (name, data, when = new Date()) => {
    const nm = enc.encode(name),
      crc = crc32(data),
      { time, date } = dosTime(when);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    h.setUint16(28, 0, true);
    await w.write(new Uint8Array(h.buffer));
    await w.write(nm);
    await w.write(data);
    central.push({ nm, crc, size: data.length, offset, time, date });
    offset += 30 + nm.length + data.length;
  };
  const finish = async () => {
    const start = offset;
    for (const c of central) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, c.time, true);
      h.setUint16(14, c.date, true);
      h.setUint32(16, c.crc, true);
      h.setUint32(20, c.size, true);
      h.setUint32(24, c.size, true);
      h.setUint16(28, c.nm.length, true);
      h.setUint32(42, c.offset, true);
      await w.write(new Uint8Array(h.buffer));
      await w.write(c.nm);
      offset += 46 + c.nm.length;
    }
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, central.length, true);
    e.setUint16(10, central.length, true);
    e.setUint32(12, offset - start, true);
    e.setUint32(16, start, true);
    await w.write(new Uint8Array(e.buffer));
    await w.close();
  };
  (async () => {
    try {
      const cid = j.company_id;
      const tables = {};
      for (const [k, sql] of Object.entries({
        visits: 'SELECT * FROM tm_visits WHERE job_id = ? AND company_id = ?',
        drawings: 'SELECT * FROM tm_drawings WHERE job_id = ? AND company_id = ?',
        records:
          'SELECT e.*, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.job_id = ? AND e.company_id = ?',
        photos:
          'SELECT p.*, x.name AS user_name FROM tm_photos p JOIN users x ON x.id = p.user_id WHERE p.job_id = ? AND p.company_id = ?',
        photo_schedule: 'SELECT * FROM tm_photo_tasks WHERE job_id = ? AND company_id = ?',
        office_log: 'SELECT * FROM tm_log WHERE ref = ? AND company_id = ?',
      }))
        tables[k] = (await env.DB.prepare(sql).bind(j.id, cid).all()).results;
      await add(
        'job.json',
        enc.encode(JSON.stringify({ job: Object.assign({}, j, { hazards: pj(j.hazards, []) }), ...tables }, null, 1))
      );
      const list = [];
      for (const d of tables.drawings) {
        const o = await env.FILES.get(d.pdf_key);
        if (!o) continue;
        const name = `drawings/rev-${String(d.rev).replace(/[^\w.-]/g, '_')}-${d.id.slice(0, 8)}.pdf`;
        await add(name, new Uint8Array(await o.arrayBuffer()), new Date(d.created_at));
        list.push(`<li>${esc(name)}: SHA-256 ${esc(d.sha256)}</li>`);
      }
      for (const p of tables.photos) {
        const o = await env.FILES.get(p.r2_key);
        if (!o) continue;
        const name = `photos/${new Date(p.taken_at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${(p.category || 'photo').replace(/\W+/g, '')}-${p.id.slice(0, 8)}.${p.r2_key.split('.').pop()}`;
        await add(name, new Uint8Array(await o.arrayBuffer()), new Date(p.taken_at));
        list.push(`<li>${esc(name)}: SHA-256 ${esc(p.sha256)}</li>`);
      }
      await add(
        'fingerprints.html',
        enc.encode(
          `<!doctype html><meta charset="utf-8"><title>${esc(j.number)} files</title><h1>${esc(j.number)}: files and their fingerprints</h1><p>Each file is exactly as received. Its SHA-256 fingerprint can be checked with any SHA-256 tool.</p><ul>${list.join('')}</ul>`
        )
      );
      await finish();
    } catch (e) {
      console.error('zip ' + j.id + ': ' + e.message);
      await w.abort(e);
    }
  })();
  await log(env, u, 'job downloaded (zip)', j.id, null);
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${j.number}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
