// Job requests: emails forwarded to jobs+<key>@tmwerx.co.uk (Cloudflare Email Routing sends them to this Worker),
// or messages pasted in the office app. Details are pulled out by simple rules for the office to check; nothing
// becomes a job until someone approves it.
import { ACTIVE, now, sha256, tooMany } from '../lib/core.js';
import { TM_TYPES } from './starter.js';
import { uid } from './util.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
function dates(text) {
  const out = new Set(),
    y0 = new Date().getUTCFullYear();
  // 14/11/2026, 14-11-26, 14.11
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)) {
    const d = +m[1],
      mo = +m[2];
    let y = m[3] ? +m[3] : y0;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2020 && y <= 2100) out.add(`${y}-${pad(mo)}-${pad(d)}`);
  }
  // 14th November (2026), Nov 14
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/gi
  )) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    out.add(`${m[3] || y0}-${pad(mo)}-${pad(+m[1])}`);
  }
  return [...out].filter(d => !isNaN(Date.parse(d))).sort();
}
// pull out what we can; anything unclear is left blank for the office to fill in
export function extractRequest(text) {
  const t = String(text || '').slice(0, 50000),
    flat = t.replace(/\s+/g, ' ');
  const pc = flat.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const o = {};
  if (pc) o.postcode = pc[1].toUpperCase().replace(/\s*(\d[A-Z]{2})$/, ' $1');
  // the address: the line holding the postcode, or a line that looks like a street
  const lines = t
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const pcLine = pc ? lines.find(l => l.toUpperCase().includes(pc[1].toUpperCase())) : null;
  const street = lines.find(l =>
    /\b\d*\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Crescent|Grove|Place|Terrace|Hill|Gardens|Court|Walk|Row|Square|Parade)\b/.test(
      l
    )
  );
  const addr = (street || pcLine || '').replace(/^(address|site|location|where)\s*[:-]\s*/i, '');
  if (addr) o.address = addr.slice(0, 300);
  const ds = dates(flat);
  if (ds.length) {
    o.start_date = ds[0];
    o.end_date = ds[ds.length - 1];
  }
  const tm = flat.toLowerCase();
  const type = /\b4[ -]?way\b/.test(tm)
    ? '4-way lights'
    : /\b3[ -]?way\b/.test(tm)
      ? '3-way lights'
      : /\b2[ -]?way\b|two[ -]way|lights|signals/.test(tm)
        ? '2-way lights'
        : /stop[ /-]?go/.test(tm)
          ? 'Stop/Go'
          : /road closure|full closure|close the road/.test(tm)
            ? 'Road closure'
            : /lane closure/.test(tm)
              ? 'Lane closure'
              : /give and take|give & take|priority/.test(tm)
                ? 'Give and take'
                : null;
  if (type && TM_TYPES.includes(type)) o.tm_type = type;
  const time =
    flat.match(/\b(?:start|on site|arrive|from)\D{0,12}(\d{1,2})[:.](\d{2})\s*(am|pm)?/i) ||
    flat.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)\b/i);
  if (time) {
    let h = +time[1];
    if (time[3] && /pm/i.test(time[3]) && h < 12) h += 12;
    if (time[3] && /am/i.test(time[3]) && h === 12) h = 0;
    if (h < 24) o.start_time = `${pad(h)}:${time[2]}`;
  }
  const phone = flat.match(/(\+44\s?\d{3,4}|\b0\d{3,4})[\s-]?\d{3}[\s-]?\d{3,4}\b/);
  const contact = flat.match(
    /\b(?:contact|site contact|ask for|foreman|supervisor)\s*[:-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/
  );
  if (contact || phone) o.site_contact = [contact && contact[1], phone && phone[0]].filter(Boolean).join(' ');
  const ref = flat.match(
    /\b(?:ref(?:erence)?|order|PO|job)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,24})\b/i
  );
  if (ref && !/^\d{1,2}[/.-]\d/.test(ref[1])) o.client_ref = ref[1];
  const permit = flat.match(/\b([A-Z]{2,4}\d{2,}[A-Z0-9-]{4,})\b/);
  if (permit) o.permit_ref = permit[1];
  return o;
}
// add a request to the queue; the same text twice is flagged as a duplicate
export async function addIntake(env, cid, m) {
  const norm = String(m.text).toLowerCase().replace(/\s+/g, ' ').trim();
  const hash = await sha256(norm);
  const dup = await env.DB.prepare(
    "SELECT id FROM tm_intake WHERE company_id = ? AND hash = ? AND status <> 'rejected' ORDER BY created_at LIMIT 1"
  )
    .bind(cid, hash)
    .first();
  const ex = extractRequest(m.text);
  const id = uid();
  await env.DB.prepare(
    'INSERT INTO tm_intake (id, company_id, source, from_addr, subject, body, extracted, hash, duplicate_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      cid,
      m.source,
      m.from || null,
      m.subject || null,
      String(m.text).slice(0, 100000),
      JSON.stringify(ex),
      hash,
      dup ? dup.id : null,
      now()
    )
    .run();
  return { id, extracted: ex, duplicate_of: dup ? dup.id : null };
}

/* ---------- reading an email: headers, then the plain-text part (or the HTML part as text) ---------- */
function decodeQP(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function bytesToText(bin, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch (e) {
    return bin;
  }
}
function decodePart(headers, body) {
  const te = (/content-transfer-encoding:\s*([\w-]+)/i.exec(headers) || [])[1] || '';
  const cs = (/charset="?([\w-]+)"?/i.exec(headers) || [])[1];
  if (/base64/i.test(te)) {
    try {
      return bytesToText(atob(body.replace(/\s+/g, '')), cs);
    } catch (e) {
      return '';
    }
  }
  if (/quoted-printable/i.test(te)) return bytesToText(decodeQP(body), cs);
  return body;
}
const htmlText = h =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
function header(head, name) {
  const m = new RegExp('^' + name + ':\\s*((?:.*)(?:\\r?\\n[ \\t].*)*)', 'im').exec(head);
  if (!m) return '';
  return m[1]
    .replace(/\r?\n[ \t]+/g, ' ')
    .replace(/=\?([\w-]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, enc, txt) =>
      enc.toUpperCase() === 'B' ? bytesToText(atob(txt), cs) : bytesToText(decodeQP(txt.replace(/_/g, ' ')), cs)
    );
}
export function parseEmail(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  const head = split < 0 ? raw : raw.slice(0, split),
    rest = split < 0 ? '' : raw.slice(split).replace(/^\r?\n\r?\n/, '');
  const subject = header(head, 'Subject'),
    from = header(head, 'From');
  const ctype = header(head, 'Content-Type');
  let text = '',
    html = '';
  const walk = (h, b, ct) => {
    const bnd = (/boundary="?([^";]+)"?/i.exec(ct) || [])[1];
    if (/multipart\//i.test(ct) && bnd) {
      for (const part of b.split('--' + bnd).slice(1)) {
        if (/^--/.test(part)) break;
        const s2 = part.replace(/^\r?\n/, '');
        const sp = s2.search(/\r?\n\r?\n/);
        if (sp < 0) continue;
        const ph = s2.slice(0, sp),
          pb = s2.slice(sp).replace(/^\r?\n\r?\n/, '');
        walk(ph, pb, header(ph, 'Content-Type'));
      }
    } else if (/text\/plain/i.test(ct) || !ct) text += decodePart(h, b) + '\n';
    else if (/text\/html/i.test(ct)) html += decodePart(h, b) + '\n';
  };
  walk(head, rest, ctype);
  return { subject, from, text: (text.trim() || htmlText(html)).trim() };
}
// Cloudflare Email Routing: an email to jobs+<key>@ arrives here
export async function emailIntake(message, env) {
  const to = String(message.to || '').toLowerCase();
  const key = (/^jobs\+([a-z0-9]+)@/.exec(to) || [])[1];
  if (!key) {
    message.setReject('Unknown address');
    return;
  }
  const co = await env.DB.prepare(
    'SELECT s.company_id, c.closed_at, c.sub_status FROM tm_settings s JOIN companies c ON c.id = s.company_id WHERE s.intake_key = ?'
  )
    .bind(key)
    .first();
  if (!co || co.closed_at) {
    message.setReject('Unknown address');
    return;
  }
  if (!ACTIVE.has(co.sub_status)) {
    message.setReject('This TM WerX account is not active.');
    return;
  }
  // 200 requests an hour for a company: plenty for real work, and a leaked address can't fill the database
  if (await tooMany(env, 'intake:' + co.company_id, 200, 60)) {
    message.setReject('Too many job requests to this address just now. Try again later.');
    return;
  }
  if ((message.rawSize || 0) > 5 * 1024 * 1024) {
    message.setReject('Too large: send the job details without large attachments.');
    return;
  }
  const raw = await new Response(message.raw).text();
  const e = parseEmail(raw);
  await addIntake(env, co.company_id, {
    source: 'email',
    from: String(message.from || e.from).slice(0, 200),
    subject: e.subject.slice(0, 300),
    text: `${e.subject}\n\n${e.text}`.slice(0, 100000),
  });
}
