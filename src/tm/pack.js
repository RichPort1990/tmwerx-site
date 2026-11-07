// The job pack: one printable page (Print, or Save as PDF) with the job, drawing, crew, RAMS, sign-ons, vehicle
// checks, every site record, the photo schedule and the photos. With blank=1 it is the pre-start pack for crews
// working on paper: the same documents with empty sign-on and vehicle check sheets.
import { esc } from '../pages.js';
import { companyLine } from '../lib/core.js';
import { ukDate, pj } from './util.js';

const fmt = t =>
  t
    ? new Date(t).toLocaleString('en-GB', {
        timeZone: 'Europe/London',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const KIND = {
  accepted: 'Accepted the job',
  vehicle_check: 'Vehicle check',
  ra_signoff: 'Signed the RAMS',
  drawing_ack: 'Confirmed the drawing revision',
  signin: 'Signed in on site',
  signout: 'Signed out',
  risk_check: 'On-site check',
  loaded: 'Van loaded',
  started: 'Started work',
  installed: 'Layout set up',
  returned: 'Equipment counted back',
  note: 'Note',
  change_request: 'Change requested',
  day_complete: 'Day complete',
  job_complete: 'Job finished',
  failed_visit: 'Visit could not go ahead',
  near_miss: 'Near miss',
  checkin: 'Lone-working check-in',
  panic: 'PANIC ALARM',
  photo_reason: 'Reason for a missed photo',
  lone_start: 'Lone working started',
  lone_stop: 'Lone working ended',
};
// a list from a phone record: only its objects (a malformed record must never break the pack)
const L = x => (Array.isArray(x) ? x.filter(i => i && typeof i === 'object') : []);
function describe(e) {
  const d = e.data || {};
  switch (e.kind) {
    case 'risk_check':
      return `Site matches the plan: ${d.matches === false ? '<b class="bad">No</b>' : 'Yes'} · Signs and controls in place: ${d.controls === false ? '<b class="bad">No</b>' : 'Yes'} · Weather: ${esc(d.weather || '-')}${d.extra ? ` · Extra hazards: ${esc(d.extra)}` : ''}${d.notes ? ` · ${esc(d.notes)}` : ''}`;
    case 'signin':
      return d.reason ? `Reason for signing in away from the site: ${esc(d.reason)}` : '';
    case 'loaded':
    case 'returned':
      return (
        L(d.items)
          .map(i => `${esc(i.name)} ${esc(i.qty)}${i.left_on_site ? ' (left on site)' : ''}`)
          .join(', ') + (d.notes ? ` · ${esc(d.notes)}` : '')
      );
    case 'day_complete':
    case 'job_complete':
      return `${d.finished === false ? 'Back another day' : e.kind === 'job_complete' ? 'Whole job finished' : 'Day complete'} · Site left clear and safe: ${d.site_clear === false ? '<b class="bad">No</b>' : 'Yes'}${d.notes ? ` · ${esc(d.notes)}` : ''}`;
    case 'vehicle_check':
      return `${d.safe === false ? '<b class="bad">NOT SAFE</b>' : 'Safe to use'}${d.mileage ? ` · ${esc(d.mileage)} miles` : ''}${L(
        d.items
      )
        .filter(i => i.result === 'defect')
        .map(i => ` · Defect: ${esc(i.item)}${i.note ? ' (' + esc(i.note) + ')' : ''}`)
        .join('')}`;
    case 'ra_signoff':
      return `${esc(d.statement || '')}${d.docs ? ` (RA v${esc(d.docs.ra)}, method v${esc(d.docs.method)}${d.drawing_rev ? ', drawing rev ' + esc(d.drawing_rev) : ''})` : ''}`;
    case 'drawing_ack':
      return `Revision ${esc(d.rev || '')}`;
    case 'failed_visit':
      return esc(`${d.reason || ''} ${d.notes || ''}`);
    default:
      return esc(d.text || d.notes || d.reason || '');
  }
}
const CSS = `body{font:13px/1.45 Arial,sans-serif;color:#111;margin:0;background:#fff}main{max-width:900px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0}h2{font-size:17px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid #f26b1d}h3{font-size:14px;margin:14px 0 4px}
table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f3f3f3;width:24%}
.grid th{width:auto}.bad{color:#b00}.muted{color:#666}.draft{border:3px solid #b00;color:#b00;font-weight:700;padding:8px;margin:12px 0;text-align:center}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:4px solid #f26b1d;padding-bottom:10px}.top img{max-height:60px;max-width:220px}
.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}figure{margin:0;break-inside:avoid;border:1px solid #ccc;padding:4px}figure img{width:100%;height:190px;object-fit:cover}figcaption{font-size:11px}
img.sig{height:48px;max-width:200px}.box{height:24px}.page{break-before:page}.bar{position:sticky;top:0;background:#222;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center}
.bar button{font:600 14px Arial;padding:6px 14px;border-radius:999px;border:0;background:#f26b1d;color:#fff;cursor:pointer}
@media print{.bar{display:none}main{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}`;

export async function evidencePack(env, u, j, { blank = false, base = '/api/office', title = null }) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const cid = j.company_id;
  const [visits, assign, drawings, events, photos, tasks, docs, client, co, log, vehicles] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM tm_visits WHERE job_id = ? AND company_id = ? AND status <> 'cancelled' ORDER BY date, start_time"
    )
      .bind(j.id, cid)
      .all(),
    env.DB.prepare(
      'SELECT a.*, x.name FROM tm_assign a JOIN users x ON x.id = a.user_id JOIN tm_visits v ON v.id = a.visit_id WHERE v.job_id = ?'
    )
      .bind(j.id)
      .all(),
    env.DB.prepare('SELECT * FROM tm_drawings WHERE job_id = ? AND company_id = ? ORDER BY created_at')
      .bind(j.id, cid)
      .all(),
    env.DB.prepare(
      'SELECT e.*, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.job_id = ? AND e.company_id = ? ORDER BY COALESCE(e.client_time, e.server_time)'
    )
      .bind(j.id, cid)
      .all(),
    env.DB.prepare(
      'SELECT p.*, x.name AS user_name FROM tm_photos p JOIN users x ON x.id = p.user_id WHERE p.job_id = ? AND p.company_id = ? ORDER BY p.taken_at'
    )
      .bind(j.id, cid)
      .all(),
    env.DB.prepare('SELECT * FROM tm_photo_tasks WHERE job_id = ? AND company_id = ? ORDER BY due_at')
      .bind(j.id, cid)
      .all(),
    env.DB.prepare(
      'SELECT d.* FROM tm_docs d WHERE d.company_id = ? AND d.version = (SELECT MAX(version) FROM tm_docs x WHERE x.company_id = d.company_id AND x.kind = d.kind)'
    )
      .bind(cid)
      .all(),
    j.client_id ? env.DB.prepare('SELECT name FROM tm_clients WHERE id = ?').bind(j.client_id).first() : null,
    env.DB.prepare('SELECT name, logo_type FROM companies WHERE id = ?').bind(cid).first(),
    env.DB.prepare(
      'SELECT l.*, x.name FROM tm_log l LEFT JOIN users x ON x.id = l.user_id WHERE l.ref = ? AND l.company_id = ? ORDER BY l.at'
    )
      .bind(j.id, cid)
      .all(),
    env.DB.prepare('SELECT * FROM tm_vehicles WHERE company_id = ?').bind(cid).all(),
  ]);
  const D = Object.fromEntries(docs.results.map(d => [d.kind, Object.assign(d, { content: pj(d.content, {}) })]));
  const draft = Object.values(D).some(d => !d.reviewed_at);
  const ev = events.results.map(e => Object.assign(e, { data: pj(e.data, {}) }));
  const vehOf = id => vehicles.results.find(v => v.id === id);
  const visitIds = new Set(visits.results.map(v => v.id));
  const vehIds = [...new Set(visits.results.flatMap(v => pj(v.vehicle_ids, [])))];
  const checks = vehIds.length
    ? (
        await env.DB.prepare(
          `SELECT e.*, x.name AS user_name FROM tm_events e JOIN users x ON x.id = e.user_id WHERE e.company_id = ? AND e.kind = 'vehicle_check' AND e.vehicle_id IN (SELECT value FROM json_each(?))`
        )
          .bind(cid, JSON.stringify(vehIds))
          .all()
      ).results
        .map(e => Object.assign(e, { data: pj(e.data, {}) }))
        .filter(e => visits.results.some(v => ukDate(e.client_time || e.server_time) === v.date))
    : [];
  const crewOf = v => assign.results.filter(a => a.visit_id === v.id);
  const latestDrawing = drawings.results[drawings.results.length - 1];
  const sig = e => (e.signature ? `<img class="sig" src="${base}/file/signature/${esc(e.id)}" alt="Signature">` : '');
  const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  const ra = D.ra ? D.ra.content : { rows: [] },
    ms = D.method ? D.method.content : { sections: [] },
    vc = D.vehicle_checks ? D.vehicle_checks.content : { items: [] };
  const signs = ev.filter(e => e.kind === 'ra_signoff');
  let h = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || (blank ? 'Pre-start pack' : 'Job pack'))} ${esc(j.number)}</title><style>${CSS}</style></head><body>
<div class="bar"><button id="printBtn">Print or save as PDF</button><span>${esc(j.number)} · ${blank ? 'pre-start pack' : 'job pack'}</span></div><main>
<div class="top"><div><h1>${blank ? 'Pre-start pack' : 'Job pack'}: ${esc(j.number)}</h1><div>${esc(co.name)}${client ? ' for ' + esc(client.name) : ''}</div><div class="muted">Produced ${fmt(Date.now())}</div></div>${co.logo_type ? `<img src="${base}/logo" alt="">` : ''}</div>
${draft ? '<div class="draft">DRAFT DOCUMENTS: the risk assessment, method statement or checklists have not been approved by the office yet.</div>' : ''}
<h2>1. Job</h2><table>${row('Site', esc([j.address, j.town, j.postcode].filter(Boolean).join(', ')))}${row('Title', esc(j.title))}${row('Client reference', esc(j.client_ref))}${row('Traffic management', esc(j.tm_type))}
${row('Dates', esc([j.start_date, j.end_date].filter(Boolean).join(' to ')))}${row('Working hours', esc(j.hours))}${row('Permit', esc([j.permit_ref, j.permit_end ? 'ends ' + j.permit_end : ''].filter(Boolean).join(', ')))}
${row('USRN', esc(j.usrn))}${row('what3words', esc(j.w3w))}${row('Grid position', j.lat != null ? `${j.lat.toFixed(5)}, ${j.lng.toFixed(5)}` : '')}${row('Site contact', esc(j.site_contact))}${row('Nearest A&E', esc(j.nearest_ae))}${row('Instructions', esc(j.instructions).replace(/\n/g, '<br>'))}</table>
<h2>2. Drawing</h2>${drawings.results.length ? `<table class="grid"><tr><th>Revision</th><th>Source</th><th>Added</th><th>Fingerprint (SHA-256)</th></tr>${drawings.results.map(d => `<tr><td>${esc(d.rev)}${d === latestDrawing ? ' (current)' : ''}</td><td>${d.source === 'cadwerx' ? 'CAD WerX' + (d.approved_by ? ', approved by ' + esc(d.approved_by) : '') : 'Uploaded PDF'}</td><td>${fmt(d.created_at)}</td><td style="font-size:10px;word-break:break-all">${esc(d.sha256)}</td></tr>`).join('')}</table><p><a href="${base}/file/drawing/${esc(latestDrawing.id)}">Open the current drawing (PDF)</a>. Print it with this pack.</p>` : '<p class="muted">No drawing attached.</p>'}
${
  latestDrawing && pj(latestDrawing.equipment, []).length
    ? `<h3>Equipment on the drawing</h3><table class="grid"><tr><th>Item</th><th>Code</th><th>Quantity</th></tr>${pj(
        latestDrawing.equipment,
        []
      )
        .map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.code || '')}</td><td>${esc(i.qty)}</td></tr>`)
        .join('')}</table>`
    : ''
}
<h2>3. Visits and crew</h2><table class="grid"><tr><th>Date</th><th>Kind</th><th>Crew</th><th>Vehicles</th><th>Status</th><th>Office review</th></tr>${visits.results
    .map(
      v =>
        `<tr><td>${esc(v.date)} ${esc(v.start_time || '')}</td><td>${esc(v.kind)}</td><td>${crewOf(v)
          .map(a => esc(a.name) + (a.lead ? ' (lead)' : ''))
          .join(', ')}</td><td>${pj(v.vehicle_ids, [])
          .map(id => esc((vehOf(id) || {}).reg || ''))
          .join(
            ', '
          )}</td><td>${esc(v.status)}</td><td>${esc(v.review === 'none' ? '' : v.review)}${v.review_note ? ': ' + esc(v.review_note) : ''}</td></tr>`
    )
    .join('')}</table>
<h2>4. Site hazards</h2>${
    pj(j.hazards, []).length
      ? `<ul>${pj(j.hazards, [])
          .map(x => `<li>${esc(x)}</li>`)
          .join('')}</ul>`
      : '<p>None identified when planned. Assess on arrival.</p>'
  }
<h2 class="page">5. ${esc(ra.title || 'Risk assessment')} <span class="muted">(version ${esc(D.ra && D.ra.version)})</span></h2><table class="grid"><tr><th>Hazard</th><th>Who</th><th>Controls</th><th>Residual risk</th></tr>${(ra.rows || []).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
<h2>6. ${esc(ms.title || 'Method statement')} <span class="muted">(version ${esc(D.method && D.method.version)})</span></h2>${(ms.sections || []).map(s => `<h3>${esc(s[0])}</h3><p>${esc(s[1]).replace(/\n/g, '<br>')}</p>`).join('')}
<h2 class="page">7. Crew sign-on</h2><p>I have read and understood the risk assessment, method statement and drawing for this job, and I have been briefed.</p>
<table class="grid"><tr><th>Name</th><th>Date and time</th><th>Signature</th></tr>${blank ? Array.from({ length: 6 }, () => '<tr><td class="box"></td><td></td><td></td></tr>').join('') : signs.map(e => `<tr><td>${esc(e.data.name || e.user_name)}</td><td>${fmt(e.client_time || e.server_time)}</td><td>${sig(e)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No sign-ons yet.</td></tr>'}</table>
<h2>8. Vehicle checks</h2>${
    blank
      ? vehIds
          .concat(vehIds.length ? [] : [''])
          .map(
            id =>
              `<h3>Vehicle: ${esc((vehOf(id) || {}).reg || '________')}</h3><table class="grid"><tr><th>Check</th><th>OK</th><th>Defect</th><th>N/A</th><th>Notes</th></tr>${(vc.items || []).map(i => `<tr><td>${esc(i)}</td><td class="box"></td><td></td><td></td><td></td></tr>`).join('')}</table><p>Mileage: ________ &nbsp; Safe to use: YES ☐ NO ☐ &nbsp; Driver: ____________ Signature: ____________</p>`
          )
          .join('')
      : checks
          .map(
            e =>
              `<h3>${esc((vehOf(e.vehicle_id) || {}).reg || '')}: ${fmt(e.client_time || e.server_time)}, ${esc(e.user_name)}</h3><p>${describe(e)}</p><table class="grid"><tr><th>Check</th><th>Result</th><th>Notes</th></tr>${L(
                e.data.items
              )
                .map(
                  i =>
                    `<tr><td>${esc(i.item)}</td><td class="${i.result === 'defect' ? 'bad' : ''}">${esc({ ok: 'OK', defect: 'DEFECT', na: 'N/A' }[i.result] || '')}</td><td>${esc(i.note || '')}</td></tr>`
                )
                .join('')}</table>${sig(e)}`
          )
          .join('') || '<p class="muted">No vehicle checks recorded for these dates.</p>'
  }`;
  if (!blank) {
    h += `<h2 class="page">9. Site records</h2><p class="muted">Times are as recorded on the phone, and checked against the server's clock when each record arrives. Where a record reached the office more than 10 minutes later (for example, no signal), the time it arrived is shown too.</p>
<table class="grid"><tr><th>When</th><th>Who</th><th>Record</th><th>Where</th></tr>${ev
      .filter(e => e.kind !== 'vehicle_check')
      .map(
        e =>
          `<tr><td>${fmt(e.client_time || e.server_time)}${e.client_time && e.server_time - e.client_time > 600e3 ? `<br><span class="muted">arrived ${fmt(e.server_time)}</span>` : ''}${e.skew != null && Math.abs(e.skew) > 300e3 ? `<br><span class="bad">phone clock ${Math.round(Math.abs(e.skew) / 60e3)} min ${e.skew > 0 ? 'fast' : 'slow'}</span>` : ''}</td><td>${esc(e.user_name)}${e.by_office ? ' (office)' : ''}</td><td><b>${esc(KIND[e.kind] || e.kind)}</b>${describe(e) ? ': ' + describe(e) : ''}${e.kind === 'ra_signoff' || e.kind === 'day_complete' || e.kind === 'job_complete' ? '<br>' + sig(e) : ''}</td><td>${e.lat != null ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}${e.acc ? ` ±${Math.round(e.acc)} m` : ''}` : ''}</td></tr>`
      )
      .join('')}</table>
<h2>10. Photo schedule</h2>${
      tasks.results.length
        ? `<table class="grid"><tr><th>Due</th><th>Photo</th><th>Result</th></tr>${tasks.results
            .filter(t => visitIds.has(t.visit_id))
            .map(
              t =>
                `<tr><td>${fmt(t.due_at)}</td><td>${esc(t.label)}${t.count > 1 ? ' × ' + t.count : ''}</td><td>${t.status === 'done' ? (t.late ? 'Taken on time, sent late (no signal)' : 'On time') : t.status === 'missed' ? `<b class="bad">Missed</b>${t.reason ? ': ' + esc(t.reason) : ''}` : 'Due'}</td></tr>`
            )
            .join('')}</table>`
        : '<p class="muted">No photo schedule applied.</p>'
    }
<h2 class="page">11. Photos</h2><div class="photos">${photos.results.map(p => `<figure><img src="${base}/file/photo/${esc(p.id)}" loading="lazy" alt=""><figcaption><b>${esc(p.category || '')}</b> ${esc(p.caption || '')}<br>${esc(p.user_name)}${p.source !== 'camera' ? ` (${esc(p.source)})` : ''} · taken ${fmt(p.taken_at)}${p.received_at - p.taken_at > 600e3 ? `, arrived ${fmt(p.received_at)}` : ''}${p.lat != null ? `<br>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ''}<br><span class="muted" style="font-size:9px">${esc(p.sha256.slice(0, 24))}…</span></figcaption></figure>`).join('') || '<p class="muted">No photos.</p>'}</div>
<h2>12. Office record of changes</h2><table class="grid"><tr><th>When</th><th>Who</th><th>What</th></tr>${log.results.map(l => `<tr><td>${fmt(l.at)}</td><td>${esc(l.name || '')}</td><td>${esc(l.action)}${l.detail ? ': ' + esc(l.detail) : ''}</td></tr>`).join('')}</table>`;
  }
  h += `<p class="muted" style="margin-top:30px">${esc(companyLine(env))} TM WerX keeps every record as it was sent; corrections are added as new records.</p></main><script nonce="${nonce}">document.getElementById('printBtn').onclick = () => print();</script></body></html>`;
  return new Response(h, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
