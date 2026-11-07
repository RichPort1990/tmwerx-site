/* Jobs: the list, a new job, and one job (details, visits and crews, drawing and equipment, site record, history). */
'use strict';
const opt = (list, cur, labels = {}) =>
  list
    .map(
      x =>
        `<option value="${esc(x)}" ${String(x) === String(cur ?? '') ? 'selected' : ''}>${esc(labels[x] || x)}</option>`
    )
    .join('');
const clientOpts = cur =>
  `<option value="">None</option>` +
  B.boot.clients
    .filter(c => !c.archived || c.id === cur)
    .map(c => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

SCREENS.jobs = async (v, arg) => {
  if (arg === 'new') return newJob(v);
  const st = sessionGet('jobs.status', 'open');
  const draw = async (q, status) => {
    const r = await api('GET', `/jobs?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    $('#jl').innerHTML = r.jobs.length
      ? `<div class="tw"><table><tr><th>Job</th><th>Site</th><th>Client</th><th>Type</th><th>Dates</th><th>Status</th></tr>${r.jobs
          .map(
            j => `<tr class="click" data-id="${esc(j.id)}"><td><b>${esc(j.number)}</b>${j.alerts ? ` <span class="chip bad">${j.alerts}</span>` : ''}${j.client_ref ? `<div class="muted">${esc(j.client_ref)}</div>` : ''}</td>
<td>${esc(j.address || j.title || '')}<div class="muted">${esc([j.town, j.postcode].filter(Boolean).join(', '))}</div></td><td>${esc(j.client_name || '')}</td><td>${esc(j.tm_type || '')}</td>
<td>${j.start_date ? esc(fmtDate(j.start_date)) : '<span class="muted">No visits</span>'}${j.end_date && j.end_date !== j.start_date ? ' – ' + esc(fmtDate(j.end_date)) : ''}${j.next_visit ? `<div class="muted">Next ${esc(fmtDate(j.next_visit))}</div>` : ''}</td>
<td>${statusChip(j.status)} ${j.sent_version ? (j.version > j.sent_version ? '<span class="chip warn">Changes not sent</span>' : '') : '<span class="chip">Not sent</span>'}</td></tr>`
          )
          .join('')}</table></div>`
      : '<p class="empty">No jobs match.</p>';
    $$('#jl [data-id]').forEach(r => (r.onclick = () => (location.hash = 'job/' + r.dataset.id)));
  };
  v.innerHTML = `<div class="head"><div><h1>Jobs</h1><p class="sub">Every job, newest first. Search by number, address, postcode, client or reference.</p></div><div class="acts"><a class="btn" href="#jobs/new">New job</a></div></div>
<div class="card"><div class="row"><div><input type="search" id="q" placeholder="Search"></div><div class="narrow"><select id="st">${opt(['open', '', 'scheduled', 'in_progress', 'completed', 'cancelled'], st, { open: 'Open', '': 'All', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })}</select></div></div><div id="jl" style="margin-top:12px"><p class="muted">Loading…</p></div></div>`;
  let t;
  $('#q').oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => draw($('#q').value, $('#st').value), 250);
  };
  $('#st').onchange = () => {
    sessionSet('jobs.status', $('#st').value);
    draw($('#q').value, $('#st').value);
  };
  await draw('', st);
};
function sessionGet(k, d) {
  try {
    return sessionStorage.getItem(k) ?? d;
  } catch (e) {
    return d;
  }
}
function sessionSet(k, val) {
  try {
    sessionStorage.setItem(k, val);
  } catch (e) {
    /* private mode */
  }
}

function jobForm(j = {}) {
  return `<div class="row"><div><label>Site address</label><input type="text" id="address" value="${esc(j.address)}"></div><div class="narrow"><label>Town</label><input type="text" id="town" value="${esc(j.town)}"></div><div class="narrow"><label>Postcode</label><input type="text" id="postcode" value="${esc(j.postcode)}"></div></div>
<div class="row"><div><label>Title (optional)</label><input type="text" id="title" value="${esc(j.title)}" placeholder="e.g. Gas main renewal"></div><div><label>Client</label><select id="client_id">${clientOpts(j.client_id)}</select></div><div><label>Client reference</label><input type="text" id="client_ref" value="${esc(j.client_ref)}"></div></div>
<div class="row"><div><label>Traffic management</label><select id="tm_type"><option value="">Choose</option>${opt(B.boot.tm_types, j.tm_type)}</select></div><div><label>Permit reference</label><input type="text" id="permit_ref" value="${esc(j.permit_ref)}"></div><div><label>Permit ends</label><input type="date" id="permit_end" value="${esc(j.permit_end)}"></div></div>
<div class="row"><div><label>Working hours</label><input type="text" id="hours" value="${esc(j.hours)}" placeholder="e.g. 09:30 to 15:30, no weekends"></div><div><label>Site contact</label><input type="text" id="site_contact" value="${esc(j.site_contact)}" placeholder="Name and phone"></div></div>
<div class="row"><div><label>USRN</label><input type="text" id="usrn" value="${esc(j.usrn)}"></div><div><label>what3words</label><input type="text" id="w3w" value="${esc(j.w3w)}"></div><div><label>Latitude</label><input type="text" id="lat" value="${esc(j.lat ?? '')}" placeholder="from the postcode"></div><div><label>Longitude</label><input type="text" id="lng" value="${esc(j.lng ?? '')}"></div></div>
<label>Nearest A&amp;E</label><input type="text" id="nearest_ae" value="${esc(j.nearest_ae)}">
<label>Instructions for the crew</label><textarea id="instructions">${esc(j.instructions)}</textarea>
<label>Site hazards</label><div class="chips" id="hz">${(doc('hazards').content.items || []).map(h => `<label class="chk" style="margin-right:10px"><input type="checkbox" value="${esc(h)}" ${(j.hazards || []).includes(h) ? 'checked' : ''}> ${esc(h)}</label>`).join('')}</div>
<input type="text" id="hz_other" placeholder="Other hazards, separated by semicolons" value="${esc((j.hazards || []).filter(h => !(doc('hazards').content.items || []).includes(h)).join('; '))}" style="margin-top:6px">
<div class="row"><div><label>Charge</label><select id="charge_basis">${opt(['daily', 'hourly', 'fixed'], j.charge_basis || 'daily', { daily: 'Per day', hourly: 'Per hour', fixed: 'Fixed price' })}</select></div><div><label>Rate (£)</label><input type="text" id="client_rate" value="${esc(pounds(j.client_rate))}"></div></div>`;
}
function readJobForm(r) {
  const o = {};
  for (const k of [
    'address',
    'town',
    'postcode',
    'title',
    'client_id',
    'client_ref',
    'tm_type',
    'permit_ref',
    'permit_end',
    'hours',
    'site_contact',
    'usrn',
    'w3w',
    'nearest_ae',
    'instructions',
    'charge_basis',
  ])
    o[k] = val(k, r);
  o.lat = val('lat', r) === '' ? null : val('lat', r);
  o.lng = val('lng', r) === '' ? null : val('lng', r);
  if (o.lat == null) delete o.lat;
  if (o.lng == null) delete o.lng;
  o.client_rate = val('client_rate', r) === '' ? null : pence(val('client_rate', r));
  o.hazards = [
    ...$$('#hz input:checked', r).map(i => i.value),
    ...val('hz_other', r)
      .split(';')
      .map(s => s.trim())
      .filter(Boolean),
  ];
  return o;
}
async function newJob(v, prefill = {}) {
  v.innerHTML = `<div class="head"><div><h1>New job</h1><p class="sub">The job number is given when you save. Add visits, crew and the drawing next.</p></div></div>
<div class="card">${jobForm(prefill)}<div class="acts" style="margin-top:16px;display:flex;gap:8px"><button id="save">Save job</button><a class="btn sec" href="#jobs">Cancel</a></div></div>`;
  $('#save').onclick = async () => {
    const o = readJobForm(v);
    if (prefill.intake_id) Object.assign(o, { source: 'request', intake_id: prefill.intake_id });
    const r = await guard(() => api('POST', '/jobs', o));
    if (!r) return;
    if (prefill.intake_id) await guard(() => api('POST', `/requests/${prefill.intake_id}/approved`, { job_id: r.id }));
    toast(`${r.number} saved`);
    location.hash = 'job/' + r.id;
  };
}
window.newJobFrom = prefill => {
  const v = $('#view');
  newJob(v, prefill);
};

/* ---------- one job ---------- */
SCREENS.job = async (v, id, tab = 'visits') => {
  const J = await api('GET', '/jobs/' + encodeURIComponent(id));
  const j = J.job;
  const TABS = [
    ['visits', 'Visits and crew'],
    ['drawing', 'Drawing and kit'],
    ['record', 'Site record'],
    ['details', 'Details'],
    ['history', 'History'],
  ];
  const pending = J.visits.filter(x => x.review === 'pending').length;
  v.innerHTML = `<div class="head"><div><h1>${esc(j.number)} ${statusChip(j.status)}</h1><p class="sub">${esc(j.address || j.title || '')}${j.postcode ? ', ' + esc(j.postcode) : ''}${j.client_name ? ' · ' + esc(j.client_name) : ''}${j.tm_type ? ' · ' + esc(j.tm_type) : ''}</p></div>
<div class="acts">${j.removed_at ? '<span class="chip bad">Removed from phones</span>' : ''}${j.changed ? '<span class="chip warn">Changes not sent</span>' : ''}
<button id="send">${j.sent_version ? (j.changed ? 'Send changes to crew' : 'Send again') : 'Send to crew'}</button>
<a class="btn sec" target="_blank" href="/api/office/jobs/${esc(j.id)}/pack">Job pack</a><button class="sec" id="more">More ▾</button></div></div>
${pending ? `<div class="msg info">${pending} visit${pending > 1 ? 's' : ''} finished and waiting for your review. <a href="#job/${esc(j.id)}/record">Review</a></div>` : ''}
${J.alerts
  .filter(a => !a.ack_at)
  .map(alertRow)
  .join('')}
<div class="tabs">${TABS.map(([k, t]) => `<a href="#job/${esc(j.id)}/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</div><div id="tab"></div>`;
  wireAcks(v, route);
  $('#send').onclick = async () => {
    const r = await guard(() => api('POST', `/jobs/${j.id}/send`));
    if (r) {
      toast(
        r.pushed
          ? `Sent. ${r.pushed} phone${r.pushed > 1 ? 's' : ''} notified.`
          : 'Sent. The crew will see it next time they open the app.'
      );
      route();
    }
  };
  $('#more').onclick = () => jobMenu(J);
  const t = $('#tab');
  ({ visits: tabVisits, drawing: tabDrawing, record: tabRecord, details: tabDetails, history: tabHistory })[tab]?.(
    t,
    J
  );
};
function jobMenu(J) {
  const j = J.job;
  const d = modal(`<h2>${esc(j.number)}</h2><div style="display:grid;gap:8px">
<a class="btn sec" target="_blank" href="/api/office/jobs/${esc(j.id)}/pack?blank=1">Blank pack to print (paper back-up)</a>
<a class="btn sec" href="/api/office/jobs/${esc(j.id)}/zip">Download job (zip with every photo and drawing)</a>
<button class="sec" id="mShare">Share the job record with the client</button>
<button class="sec" id="mDone">Mark job completed</button>
<button class="sec" id="mReopen">Reopen job</button>
<button class="danger" id="mRemove">Cancel job and remove it from phones</button></div><div class="acts"><button class="sec" data-close>Close</button></div>`);
  $('#mShare', d).onclick = () => {
    d.close();
    shareBox(j);
  };
  $('#mDone', d).onclick = async () => {
    if (await guard(() => api('POST', `/jobs/${j.id}/status`, { status: 'completed' }), 'Job completed'))
      d.close(), route();
  };
  $('#mReopen', d).onclick = async () => {
    if (await guard(() => api('POST', `/jobs/${j.id}/status`, { status: 'scheduled' }), 'Job reopened'))
      d.close(), route();
  };
  $('#mRemove', d).onclick = async () => {
    d.close();
    if (
      await confirmBox(
        'Cancel this job? Scheduled visits are cancelled and the crew are told not to attend.',
        'Cancel job'
      )
    )
      if (await guard(() => api('POST', `/jobs/${j.id}/remove`), 'Job cancelled')) route();
  };
}
function shareBox(j) {
  const d =
    modal(`<h2>Share with the client</h2><p class="muted">A read-only link to the job record: details, drawings, site records and photos. Anyone with the link can open it until it expires.</p>
<div class="row"><div class="narrow"><label>Days</label><input type="number" id="days" value="30" min="1" max="90"></div></div><div id="out"></div>
<div class="acts">${j.share_expires && j.share_expires > Date.now() ? '<button class="danger" id="off">Switch off the current link</button>' : ''}<button class="sec" data-close>Close</button><button id="mk">Make link</button></div>`);
  $('#mk', d).onclick = async () => {
    const r = await guard(() => api('POST', `/jobs/${j.id}/share`, { days: +val('days', d) }));
    if (r)
      $('#out', d).innerHTML =
        `<label>Link (copy it now: it is not shown again)</label><input type="text" readonly value="${esc(location.origin + r.url)}" onfocus="this.select()"><p class="muted">Expires ${fmtDT(r.expires)}. Making a new link switches off the old one.</p>`;
  };
  if ($('#off', d))
    $('#off', d).onclick = async () =>
      (await guard(() => api('POST', `/jobs/${j.id}/share`, { off: true }), 'Link switched off')) && d.close();
}

function tabDetails(t, J) {
  t.innerHTML = `<div class="card">${jobForm(J.job)}<div style="margin-top:16px"><button id="save">Save changes</button></div><p class="muted">Changes the crew can see are marked "Changes not sent" until you send them.</p></div>`;
  $('#save').onclick = async () => {
    const r = await guard(() => api('PUT', '/jobs/' + J.job.id, readJobForm(t)));
    if (r) toast(r.changed ? 'Saved' : 'Nothing changed'), route();
  };
}

function tabVisits(t, J) {
  const dr = id => J.drawings.find(d => d.id === id);
  t.innerHTML = `<div class="card"><div class="head" style="margin:0 0 8px"><h2>Visits</h2><button id="addV">Add visit</button></div>${
    J.visits.length
      ? `<div class="tw"><table><tr><th>Date</th><th>Visit</th><th>Crew</th><th>Vehicles</th><th>Drawing</th><th>Status</th><th></th></tr>${J.visits
          .map(
            x => `<tr><td><b>${esc(fmtDate(x.date))}</b><div class="muted">${esc(x.start_time || '')}${x.end_time ? '–' + esc(x.end_time) : ''}</div></td><td>${esc(KIND_LABEL[x.kind] || x.kind)}${x.notes ? `<div class="muted">${esc(x.notes)}</div>` : ''}</td>
<td>${x.crew.map(c => esc(c.name) + (c.lead ? ' <span class="chip">lead</span>' : '')).join('<br>') || '<span class="chip bad">No crew</span>'}</td><td>${x.vehicle_ids.map(id => esc(vehicle(id).reg || '?')).join(', ') || '<span class="muted">-</span>'}</td>
<td>${x.drawing_id && dr(x.drawing_id) ? 'Rev ' + esc(dr(x.drawing_id).rev) : '<span class="muted">none</span>'}${J.drawings.length && x.drawing_id !== J.drawings[J.drawings.length - 1].id && x.status === 'in_progress' ? ` <button class="sm sec" data-apply="${esc(x.id)}">Use latest</button>` : ''}</td>
<td>${statusChip(x.status)}${x.review === 'pending' ? ' <span class="chip amber">To review</span>' : x.review === 'approved' ? ' <span class="chip ok">Approved</span>' : x.review === 'returned' ? ' <span class="chip warn">Returned</span>' : ''}</td>
<td class="n"><button class="sm sec" data-edit="${esc(x.id)}">Edit</button></td></tr>`
          )
          .join('')}</table></div>`
      : '<p class="empty">No visits yet. Add the first one: the date, the crew and the van.</p>'
  }</div>`;
  $('#addV').onclick = () => visitBox(J, null);
  $$('[data-edit]', t).forEach(
    b =>
      (b.onclick = () =>
        visitBox(
          J,
          J.visits.find(x => x.id === b.dataset.edit)
        ))
  );
  $$('[data-apply]', t).forEach(
    b =>
      (b.onclick = async () => {
        if (
          await guard(
            () =>
              api('POST', `/visits/${b.dataset.apply}/apply-drawing`, {
                drawing_id: J.drawings[J.drawings.length - 1].id,
              }),
            'Applied. The crew must confirm they have seen it.'
          )
        )
          route();
      })
  );
}
function visitBox(J, x) {
  const people = crew();
  const onCrew = id => (x ? x.crew.find(c => c.user_id === id) : null);
  const vans = B.boot.vehicles.filter(vh => !vh.off_road || (x && x.vehicle_ids.includes(vh.id)));
  const d = modal(
    `<h2>${x ? 'Edit visit' : 'Add a visit'}</h2>
<div class="row"><div><label>Date</label><input type="date" id="date" value="${esc(x ? x.date : J.job.start_date || iso(new Date()))}"></div><div class="narrow"><label>Start</label><input type="time" id="start_time" value="${esc(x ? x.start_time : '')}"></div><div class="narrow"><label>Finish</label><input type="time" id="end_time" value="${esc(x ? x.end_time : '')}"></div>
<div><label>Visit</label><select id="kind">${opt(B.boot.visit_kinds, x ? x.kind : 'install', KIND_LABEL)}</select></div></div>
<label>Crew</label>${people.length ? `<table><tr><th>On this visit</th><th>Lead</th><th class="n">Day cost (£)</th></tr>${people.map(p => `<tr><td><label class="chk"><input type="checkbox" class="cw" value="${esc(p.id)}" ${onCrew(p.id) ? 'checked' : ''}> ${esc(p.name)} <span class="muted">${p.role === 'lead' ? 'Lead' : 'Operative'}</span></label></td><td><input type="radio" name="lead" value="${esc(p.id)}" ${onCrew(p.id) && onCrew(p.id).lead ? 'checked' : ''}></td><td class="n"><input type="text" class="cost" data-id="${esc(p.id)}" style="width:90px" value="${esc(pounds(onCrew(p.id) ? onCrew(p.id).cost : p.day_cost))}"></td></tr>`).join('')}</table>` : '<p class="muted">No crew logins yet. Add them under Crew.</p>'}
<label>Vehicles</label><div class="chips">${vans.map(vh => `<label class="chk" style="margin-right:12px"><input type="checkbox" class="vh" value="${esc(vh.id)}" ${x && x.vehicle_ids.includes(vh.id) ? 'checked' : ''} ${vh.unsafe || vh.off_road ? 'disabled' : ''}> ${esc(vh.reg)}${vh.unsafe ? ' <span class="chip bad">not safe</span>' : vh.off_road ? ' <span class="chip">off road</span>' : ''}</label>`).join('') || '<span class="muted">No vehicles yet.</span>'}</div>
<label>Notes for the crew</label><textarea id="notes">${esc(x ? x.notes : '')}</textarea>
<div class="row"><div class="narrow"><label>Rate for this visit (£)</label><input type="text" id="client_rate" value="${esc(x ? pounds(x.client_rate) : '')}" placeholder="job rate"></div>${x ? `<div class="narrow"><label>Status</label><select id="status">${opt(['scheduled', 'in_progress', 'completed', 'failed', 'cancelled'], x.status, Object.fromEntries(Object.entries(STATUS).map(([k, a]) => [k, a[0]])))}</select></div>` : ''}</div>
<div id="warn"></div>
<div class="acts">${x ? '<button class="danger" id="del">Delete visit</button>' : ''}<button class="sec" data-close>Cancel</button><button id="ok">${x ? 'Save' : 'Add visit'}</button></div>`,
    'wide'
  );
  $('#ok', d).onclick = async () => {
    const lead = ($('input[name=lead]:checked', d) || {}).value;
    const b = {
      date: val('date', d),
      start_time: val('start_time', d),
      end_time: val('end_time', d),
      kind: val('kind', d),
      notes: val('notes', d),
      client_rate: val('client_rate', d) === '' ? null : pence(val('client_rate', d)),
      vehicle_ids: $$('.vh:checked', d).map(i => i.value),
      crew: $$('.cw:checked', d).map(i => ({
        user_id: i.value,
        lead: i.value === lead,
        cost: pence($(`.cost[data-id="${i.value}"]`, d).value),
      })),
    };
    if (x) b.status = val('status', d);
    const r = await guard(() => (x ? api('PUT', '/visits/' + x.id, b) : api('POST', `/jobs/${J.job.id}/visits`, b)));
    if (!r) return;
    if (r.warn && r.warn.length) {
      $('#warn', d).innerHTML =
        `<div class="msg warn"><b>Saved, but check:</b><br>${r.warn.map(esc).join('<br>')}</div>`;
      $('#ok', d).textContent = 'Done';
      $('#ok', d).onclick = () => (d.close(), route());
      return;
    }
    d.close();
    toast('Saved');
    route();
  };
  if (x)
    $('#del', d).onclick = async () => {
      const r = await guard(() => api('DELETE', '/visits/' + x.id));
      if (r)
        d.close(),
          toast(
            r.cancelled ? 'The visit has site records, so it was cancelled rather than deleted.' : 'Visit deleted',
            4000
          ),
          route();
    };
}

function equipTable(items, editable) {
  return `<table class="editor"><tr><th>Code</th><th>Item</th><th class="n">Quantity</th>${editable ? '<th></th>' : ''}</tr><tbody id="eq">${(items.length
    ? items
    : editable
      ? [{}]
      : []
  )
    .map(i =>
      editable
        ? eqRow(i)
        : `<tr><td class="mono">${esc(i.code || '')}</td><td>${esc(i.name)}</td><td class="n">${esc(i.qty)}</td></tr>`
    )
    .join(
      ''
    )}</tbody></table>${editable ? '<button class="sm sec" id="eqAdd" style="margin-top:8px">Add a line</button>' : ''}`;
}
const eqRow = i =>
  `<tr><td><input type="text" class="eqc" value="${esc(i.code || '')}" style="max-width:110px"></td><td><input type="text" class="eqn" value="${esc(i.name || '')}"></td><td class="n"><input type="number" class="eqq" min="0" value="${esc(i.qty ?? '')}" style="max-width:90px"></td><td><button class="sm sec eqx" type="button">✕</button></td></tr>`;
function wireEq(root) {
  const add = $('#eqAdd', root);
  if (add) add.onclick = () => $('#eq', root).insertAdjacentHTML('beforeend', eqRow({}));
  root.addEventListener('click', e => e.target.classList.contains('eqx') && e.target.closest('tr').remove());
}
const readEq = root =>
  $$('#eq tr', root)
    .map(r => ({ code: $('.eqc', r).value.trim(), name: $('.eqn', r).value.trim(), qty: +$('.eqq', r).value }))
    .filter(i => i.name && i.qty >= 0);

function tabDrawing(t, J) {
  const cur = J.drawings[J.drawings.length - 1];
  t.innerHTML = `<div class="grid2"><div class="card"><h2>Current drawing</h2>${
    cur
      ? `<p><b>Rev ${esc(cur.rev)}</b>${cur.drawing_no ? ' · ' + esc(cur.drawing_no) : ''} · ${cur.source === 'cadwerx' ? 'from CAD WerX' : 'uploaded PDF'} · ${fmtDT(cur.created_at)}${cur.by_name ? ' by ' + esc(cur.by_name) : ''}</p>
<p class="muted mono">SHA-256 ${esc(cur.sha256)}</p>${cur.note ? `<p>${esc(cur.note)}</p>` : ''}<p><a class="btn sec" target="_blank" href="/api/office/file/drawing/${esc(cur.id)}">Open PDF</a></p>`
      : '<p class="empty">No drawing yet.</p>'
  }
<h3>Add a drawing or new revision</h3><div class="row"><div class="narrow"><label>Revision</label><input type="text" id="rev" value="${cur ? nextRev(cur.rev) : 'A'}"></div><div><label>Drawing number</label><input type="text" id="dno" value="${esc(cur ? cur.drawing_no || '' : '')}"></div></div>
<label>Note</label><input type="text" id="dnote" placeholder="What changed">
<label>PDF (25 MB or smaller)</label><input type="file" id="pdf" accept="application/pdf"><p class="muted">The equipment list below goes with it. Scheduled visits move to the new drawing; visits under way keep theirs until you apply it.</p>
<button id="up">Upload drawing</button>
${B.boot.cadwerx ? `<h3>Or from CAD WerX</h3><div class="row"><div><input type="search" id="cq" placeholder="Search your saved CAD WerX drawings"></div><div class="narrow"><button class="sec" id="cs">Search</button></div></div><div id="cr"></div>` : ''}</div>
<div class="card"><h2>Equipment to load</h2>${cur && cur.source === 'cadwerx' ? `<p class="muted">From CAD WerX. Issue a new revision there to change it.</p>${equipTable(cur.equipment, false)}` : `<p class="muted">The crew count this onto the van and back off at the end. ${B.boot.settings.spares_pct ? `They're asked to add ${B.boot.settings.spares_pct}% spares.` : ''}</p>${equipTable(cur ? cur.equipment : [], true)}${cur ? '<div style="margin-top:12px"><button id="eqSave">Save list</button></div>' : ''}`}</div></div>
${
  J.drawings.length > 1
    ? `<div class="card"><h2>Earlier revisions</h2><table>${J.drawings
        .slice(0, -1)
        .reverse()
        .map(
          d =>
            `<tr><td>Rev ${esc(d.rev)}</td><td>${fmtDT(d.created_at)}</td><td class="mono">${esc(d.sha256.slice(0, 16))}…</td><td><a target="_blank" href="/api/office/file/drawing/${esc(d.id)}">PDF</a></td></tr>`
        )
        .join('')}</table></div>`
    : ''
}`;
  wireEq(t);
  $('#up').onclick = async () => {
    const f = $('#pdf').files[0];
    if (!f) return toast('Choose the PDF first.');
    const eq = readEq(t);
    const q = new URLSearchParams({ rev: val('rev'), no: val('dno'), note: val('dnote') });
    if (
      await guard(
        () =>
          api('POST', `/jobs/${J.job.id}/drawing?${q}`, f, {
            headers: { 'X-Equipment': encodeURIComponent(JSON.stringify(eq)) },
          }),
        'Drawing added'
      )
    )
      route();
  };
  if ($('#eqSave'))
    $('#eqSave').onclick = async () =>
      (await guard(() => api('PUT', `/drawings/${cur.id}/equipment`, { equipment: readEq(t) }), 'List saved')) &&
      route();
  if ($('#cs'))
    $('#cs').onclick = async () => {
      const r = await guard(() => api('GET', '/cadwerx/search?q=' + encodeURIComponent(val('cq'))));
      if (!r) return;
      $('#cr').innerHTML = r.results.length
        ? `<table>${r.results.map(p => `<tr><td><b>${esc(p.name)}</b><div class="muted">${esc(p.address || '')} · ${esc(p.updated || '')}</div></td><td class="n"><button class="sm" data-p="${esc(p.id)}" data-v="${esc(p.version || '')}">Use this</button></td></tr>`).join('')}</table>`
        : `<p class="muted">${esc(r.error || 'Nothing found. Check the CAD WerX link under Settings.')}</p>`;
      $$('[data-p]', t).forEach(
        b =>
          (b.onclick = async () =>
            (await guard(
              () => api('POST', `/jobs/${J.job.id}/cadwerx`, { project: b.dataset.p, version: b.dataset.v }),
              'CAD WerX drawing added'
            )) && route())
      );
    };
}
const nextRev = r =>
  /^[A-Y]$/i.test(r)
    ? String.fromCharCode(r.toUpperCase().charCodeAt(0) + 1)
    : /^\d+$/.test(r)
      ? String(+r + 1)
      : r + '1';

function evSummary(e) {
  const d = e.data || {};
  switch (e.kind) {
    case 'vehicle_check':
      return `${esc(vehicle(e.vehicle_id).reg || '')} ${d.safe === false ? '<span class="chip bad">NOT SAFE</span>' : '<span class="chip ok">Safe</span>'} ${(
        d.items || []
      )
        .filter(i => i.result === 'defect')
        .map(i => esc(i.item))
        .join(', ')}${d.mileage ? ' · ' + esc(d.mileage) + ' miles' : ''}`;
    case 'signin':
      return `${d.reason ? 'Away from site: ' + esc(d.reason) : ''}`;
    case 'risk_check':
      return `${d.matches === false ? '<span class="chip warn">Site differs</span> ' : ''}${d.controls === false ? '<span class="chip warn">Controls not in place</span> ' : ''}${esc(d.extra || '')} ${esc(d.notes || '')}`;
    case 'loaded':
    case 'returned':
      return (d.items || [])
        .map(i => `${esc(i.qty)} × ${esc(i.name)}${i.left_on_site ? ' (left on site)' : ''}`)
        .join(', ');
    case 'day_complete':
    case 'job_complete':
      return `${d.site_clear === false ? '<span class="chip bad">Site NOT clear</span> ' : d.site_clear ? '<span class="chip ok">Site clear</span> ' : ''}${esc(d.notes || '')}`;
    case 'failed_visit':
      return `${esc(d.reason || '')} ${esc(d.notes || '')}`;
    case 'photo_reason':
      return esc(d.reason || '');
    case 'lone_start':
      return `Check in every ${esc(d.every_mins || '')} min`;
    default:
      return esc(d.text || d.notes || '');
  }
}
function tabRecord(t, J) {
  const byVisit = J.visits.filter(
    x =>
      J.events.some(e => e.visit_id === x.id) ||
      J.photos.some(p => p.visit_id === x.id) ||
      J.tasks.some(k => k.visit_id === x.id)
  );
  const loose = J.events.filter(e => !e.visit_id);
  const photoCard = p =>
    `<div class="ph"><img loading="lazy" src="/api/office/file/photo/${esc(p.id)}" data-full="/api/office/file/photo/${esc(p.id)}" data-cap="${esc(`${p.category || ''} ${p.caption || ''} · ${p.user_name} · taken ${fmtDT(p.taken_at)} · received ${fmtDT(p.received_at)} · SHA-256 ${p.sha256}`)}" alt=""><div><b>${esc(p.category || '')}</b> ${esc(p.caption || '')}<br><span class="muted">${esc(p.user_name)} · ${fmtDT(p.taken_at)}${p.source === 'gallery' ? ' · from gallery' : p.source === 'office' ? ' · office' : ''}</span></div></div>`;
  t.innerHTML =
    (byVisit.length || loose.length || J.photos.length
      ? byVisit
          .map(x => {
            const ev = J.events.filter(e => e.visit_id === x.id),
              ph = J.photos.filter(p => p.visit_id === x.id),
              tk = J.tasks.filter(k => k.visit_id === x.id);
            return `<div class="card"><div class="head" style="margin:0 0 8px"><div><h2>${esc(fmtDate(x.date))} · ${esc(KIND_LABEL[x.kind] || x.kind)}</h2>${statusChip(x.status)} ${x.review === 'approved' ? '<span class="chip ok">Approved</span>' : x.review === 'returned' ? `<span class="chip warn">Returned: ${esc(x.review_note || '')}</span>` : ''}</div>
${x.review === 'pending' ? `<div class="acts"><button class="sec" data-ret="${esc(x.id)}">Return to crew</button><button data-appr="${esc(x.id)}">Approve</button></div>` : ''}</div>
${tk.length ? `<h3>Photo schedule</h3><table><tr><th>Due</th><th>Photo</th><th>Result</th></tr>${tk.map(k => `<tr><td>${fmtDT(k.due_at)}</td><td>${esc(k.label)}${k.count > 1 ? ' ×' + k.count : ''}</td><td>${k.status === 'done' ? `<span class="chip ok">Taken ${fmtT(k.done_at)}</span>${k.late ? ' <span class="chip warn">late</span>' : ''}` : k.status === 'missed' ? `<span class="chip bad">Missed</span> ${k.reason ? esc(k.reason) : ''}` : '<span class="chip">Due</span>'}</td></tr>`).join('')}</table>` : ''}
<h3>Records</h3><div class="timeline">${ev.map(e => `<div class="ev"><div class="w">${fmtDT(e.client_time || e.server_time)}${e.client_time && Math.abs(e.server_time - e.client_time) > 15 * 60e3 ? `<br><span class="chip">sent ${fmtDT(e.server_time)}</span>` : ''}${e.skew && Math.abs(e.skew) > 5 * 60e3 ? `<br><span class="chip warn">phone clock ${Math.round(e.skew / 60e3)} min out</span>` : ''}</div><div><b>${esc(EVENT_LABEL[e.kind] || e.kind)}</b> · ${esc(e.user_name)}${e.by_office ? ' (office)' : ''}${e.signed ? ` · <a target="_blank" href="/api/office/file/signature/${esc(e.id)}">signature</a>` : ''}${e.lat != null ? ` · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.lat},${e.lng}">position</a>` : ''}<div>${evSummary(e)}</div></div></div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>
${ph.length ? `<h3>Photos</h3><div class="photos">${ph.map(photoCard).join('')}</div>` : ''}</div>`;
          })
          .join('') +
        (loose.length
          ? `<div class="card"><h2>Other records</h2><div class="timeline">${loose.map(e => `<div class="ev"><div class="w">${fmtDT(e.client_time || e.server_time)}</div><div><b>${esc(EVENT_LABEL[e.kind] || e.kind)}</b> · ${esc(e.user_name)}<div>${evSummary(e)}</div></div></div>`).join('')}</div></div>`
          : '') +
        (J.photos.filter(p => !p.visit_id).length
          ? `<div class="card"><h2>Other photos</h2><div class="photos">${J.photos
              .filter(p => !p.visit_id)
              .map(photoCard)
              .join('')}</div></div>`
          : '')
      : '<div class="card"><p class="empty">Nothing from site yet. Records and photos appear here as the crew send them.</p></div>') +
    `<div class="card"><h2>Add to the record</h2><p class="muted">Office notes and photos are marked as from the office. Nothing the crew sent can be changed.</p><textarea id="nt" placeholder="Note or correction"></textarea>
<div class="row" style="margin-top:8px"><div><label class="chk"><input type="checkbox" id="corr"> This corrects an earlier record</label></div></div><button id="addN">Add note</button>
<h3>Photo for the crew</h3><div class="row"><div><input type="file" id="oph" accept="image/*"></div><div><input type="text" id="ocap" placeholder="Caption"></div><div class="narrow"><button class="sec" id="addP">Upload</button></div></div></div>`;
  $$('[data-appr]', t).forEach(
    b =>
      (b.onclick = async () =>
        (await guard(() => api('POST', `/visits/${b.dataset.appr}/review`, { decision: 'approved' }), 'Approved')) &&
        route())
  );
  $$('[data-ret]', t).forEach(
    b =>
      (b.onclick = () => {
        const d = modal(
          `<h2>Return to crew</h2><label>What needs doing?</label><textarea id="rn"></textarea><div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Return</button></div>`
        );
        $('#go', d).onclick = async () =>
          (await guard(
            () => api('POST', `/visits/${b.dataset.ret}/review`, { decision: 'returned', note: val('rn', d) }),
            'Returned'
          )) && (d.close(), route());
      })
  );
  $('#addN').onclick = async () =>
    (await guard(
      () => api('POST', `/jobs/${J.job.id}/note`, { text: val('nt'), correction: val('corr') }),
      'Note added'
    )) && route();
  $('#addP').onclick = async () => {
    const f = $('#oph').files[0];
    if (!f) return toast('Choose a photo.');
    if (
      await guard(
        () => api('POST', `/jobs/${J.job.id}/photo?caption=${encodeURIComponent(val('ocap'))}`, f),
        'Photo added'
      )
    )
      route();
  };
}
function tabHistory(t, J) {
  t.innerHTML = `<div class="card"><h2>Changes</h2><table>${J.log.map(l => `<tr><td style="white-space:nowrap">${fmtDT(l.at)}</td><td>${esc(l.name || 'System')}</td><td>${esc(l.action)}</td><td class="muted">${esc(l.detail || '')}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</table></div>
${J.alerts.length ? `<div class="card"><h2>All alerts on this job</h2>${J.alerts.map(alertRow).join('')}</div>` : ''}`;
  wireAcks(t, route);
}
