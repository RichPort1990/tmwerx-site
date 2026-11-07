/* Live: alerts, live jobs (started and not closed), today's visits, photos due, lone workers. Board: the week. Alerts. */
'use strict';
const STEP_ORDER = [
  ['accepted', 'Accepted'],
  ['vehicle_check', 'Van'],
  ['ra_signoff', 'RAMS'],
  ['signin', 'On site'],
  ['risk_check', 'Check'],
  ['started', 'Started'],
  ['installed', 'Set up'],
  ['returned', 'Kit back'],
  ['day_complete', 'Done'],
];
function alertRow(a) {
  return `<div class="alert ${esc(a.level)}"><div><div class="t">${esc(a.title)}</div><div class="muted">${esc(a.detail || '')}</div>
<div class="muted">${fmtDT(a.created_at)}${a.number ? ` · <a href="#job/${esc(a.job_id)}">${esc(a.number)}</a>` : ''}${a.user_name ? ' · ' + esc(a.user_name) : ''}</div></div>
${a.ack_at ? `<span class="muted">Dealt with${a.ack_name ? ' by ' + esc(a.ack_name) : ''}</span>` : `<button class="sec sm" data-ack="${esc(a.id)}">Dealt with</button>`}</div>`;
}
function wireAcks(root, after) {
  $$('[data-ack]', root).forEach(b => {
    b.onclick = async () => {
      b.disabled = true;
      if (await guard(() => api('POST', `/alerts/${b.dataset.ack}/ack`))) {
        B.boot.counts.alerts = Math.max(0, (B.boot.counts.alerts || 1) - 1);
        drawNav();
        after();
      }
    };
  });
}
SCREENS.live = async v => {
  const draw = async () => {
    const L = await api('GET', '/live');
    B.boot.counts.alerts = L.alerts.length;
    drawNav();
    const t = iso(new Date());
    const today = L.visits.filter(x => x.date === t || x.status === 'in_progress');
    // due now, or within the next quarter of an hour (later ones are listed per visit as 'next')
    const due = L.tasks.filter(k => k.status === 'due' && k.due_at <= L.server_time + 15 * 60e3);
    const overdue = due.filter(k => k.grace_until < L.server_time);
    const crewMap = new Map(L.crew.map(c => [c.id, c]));
    v.innerHTML = `<div class="head"><div><h1>Live</h1><p class="sub">Jobs that have started and not closed, today's visits and anything that needs you. Updates every 30 seconds.</p></div>
<div class="acts"><a class="btn" href="#jobs/new">New job</a></div></div>
<div class="stats"><div class="stat"><b>${L.jobs.length}</b><span>Live jobs</span></div><div class="stat"><b>${today.length}</b><span>Visits today</span></div>
<div class="stat"><b style="color:${overdue.length ? 'var(--red)' : ''}">${overdue.length}</b><span>Photos overdue</span></div><div class="stat"><b>${L.alerts.length}</b><span>Alerts to deal with</span></div>
<div class="stat"><b>${L.lone.length}</b><span>Lone working now</span></div></div>
${L.alerts.length ? `<div class="card"><h2>Needs you</h2>${L.alerts.slice(0, 30).map(alertRow).join('')}${L.alerts.length > 30 ? `<p><a href="#alerts">All ${L.alerts.length} alerts</a></p>` : ''}</div>` : ''}
<div class="card"><h2>Visits today and under way</h2>${
      today.length
        ? `<div class="tw"><table><tr><th>Job</th><th>Crew</th><th>Progress</th><th>Photos</th><th>Last contact</th></tr>${today
            .map(x => {
              const tasks = L.tasks.filter(k => k.visit_id === x.id);
              const late = tasks.filter(k => k.status === 'due' && k.grace_until < L.server_time).length;
              const seen = Math.max(0, ...x.crew.map(c => (crewMap.get(c.user_id) || {}).last_seen || 0));
              return `<tr class="click" data-job="${esc(x.job_id)}"><td><b>${esc(x.number)}</b> ${statusChip(x.status)}<div class="muted">${esc(x.address || '')} · ${esc(KIND_LABEL[x.kind] || x.kind)} ${esc(x.start_time || '')}</div></td>
<td>${x.crew.map(c => esc(c.name) + (c.lead ? ' (lead)' : '') + (x.signed_in.includes(c.user_id) ? ' <span class="chip ok">on site</span>' : '')).join('<br>') || '<span class="chip bad">No crew</span>'}</td>
<td><div class="steps">${STEP_ORDER.map(([k, l]) => `<span class="s ${x.steps.includes(k) || (k === 'day_complete' && x.steps.includes('job_complete')) ? 'y' : ''}">${l}</span>`).join('')}</div></td>
<td>${late ? `<span class="chip bad">${late} overdue</span> ` : ''}${tasks.filter(k => k.status === 'due' && k.due_at > L.server_time).length ? `<span class="muted">next ${fmtT(Math.min(...tasks.filter(k => k.status === 'due' && k.due_at > L.server_time).map(k => k.due_at)))}</span>` : ''}${!late && !tasks.some(k => k.status === 'due') ? '<span class="muted">Up to date</span>' : ''}</td>
<td>${seen ? ago(seen) : '<span class="muted">not yet</span>'}</td></tr>`;
            })
            .join('')}</table></div>`
        : '<p class="empty">Nothing on today.</p>'
    }</div>
${due.length ? `<div class="card"><h2>Photos due</h2><table><tr><th>Due</th><th>Job</th><th>Photo</th><th></th></tr>${due.map(k => `<tr><td>${fmtT(k.due_at)}</td><td><a href="#job/${esc(k.job_id)}">${esc(k.number)}</a></td><td>${esc(k.label)}${k.count > 1 ? ' ×' + k.count : ''}</td><td>${k.grace_until < L.server_time ? '<span class="chip bad">Overdue</span>' : '<span class="chip">Due</span>'}</td></tr>`).join('')}</table></div>` : ''}
${L.lone.length ? `<div class="card"><h2>Lone working</h2><table><tr><th>Who</th><th>Last check-in</th><th>Next due</th></tr>${L.lone.map(l => `<tr><td>${esc(person(l.user_id))}</td><td>${l.last_checkin ? fmtT(l.last_checkin) : '-'}</td><td>${fmtT(l.next_due)} ${l.missed ? '<span class="chip bad">Missed</span>' : ''}</td></tr>`).join('')}</table></div>` : ''}
${L.jobs.length ? `<div class="card"><h2>Live jobs</h2><table>${L.jobs.map(j => `<tr class="click" data-job="${esc(j.id)}"><td><b>${esc(j.number)}</b></td><td>${esc(j.address || j.title || '')}</td><td>${esc(j.client_name || '')}</td><td>${esc(j.tm_type || '')}</td></tr>`).join('')}</table></div>` : ''}
${L.locations.length ? `<div class="card"><h2>Crew positions</h2><p class="muted">Only while signed in to a visit, from the crew app.</p><table>${L.locations.map(l => `<tr><td>${esc(person(l.user_id))}</td><td>${fmtT(l.at)}</td><td><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${l.lat},${l.lng}">${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</a> ±${Math.round(l.acc || 0)} m</td></tr>`).join('')}</table></div>` : ''}`;
    $$('[data-job]', v).forEach(r => (r.onclick = () => (location.hash = 'job/' + r.dataset.job)));
    wireAcks(v, draw);
  };
  await draw();
  refreshTimer = setInterval(() => document.visibilityState === 'visible' && draw().catch(() => {}), 30000);
};

SCREENS.alerts = async v => {
  const draw = async all => {
    const r = await api('GET', '/alerts' + (all ? '?all=1' : ''));
    v.innerHTML = `<div class="head"><div><h1>Alerts</h1><p class="sub">Overdue photos, unsafe vans, sites that don't match the plan, near misses, check-ins and anything else the system has flagged.</p></div>
<div class="acts"><button class="sec" id="tog">${all ? 'Open alerts only' : 'Include dealt-with'}</button></div></div><div class="card">${r.alerts.map(alertRow).join('') || '<p class="empty">No alerts.</p>'}</div>`;
    $('#tog').onclick = () => draw(!all);
    wireAcks(v, () => draw(all));
  };
  await draw(false);
};

SCREENS.board = async (v, from) => {
  const start = weekStart(from || iso(new Date()));
  const end = addDays(start, 6);
  const r = await api('GET', `/board?from=${start}&to=${end}`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    t = iso(new Date());
  v.innerHTML = `<div class="head"><div><h1>Board</h1><p class="sub">Week of ${fmtDate(start)}. Red edge: no crew allocated. Click a visit to open its job.</p></div>
<div class="acts"><a class="btn sec" href="#board/${addDays(start, -7)}">◀ Previous</a><a class="btn sec" href="#board">This week</a><a class="btn sec" href="#board/${addDays(start, 7)}">Next ▶</a><a class="btn" href="#jobs/new">New job</a></div></div>
<div class="board">${days
    .map(d => {
      const vs = r.visits.filter(x => x.date === d);
      return `<div class="day ${d === t ? 'today' : ''}"><h4>${esc(fmtDate(d))}<span class="muted">${vs.length || ''}</span></h4>${vs
        .map(
          x => `<a class="vcard ${x.status === 'cancelled' ? 'cancel' : !x.crew.length ? 'none' : ['completed'].includes(x.status) ? 'done' : ''}" href="#job/${esc(x.job_id)}"><b>${esc(x.start_time || '')} ${esc(x.number)}</b> ${x.sent_version ? (x.version > x.sent_version ? '<span class="chip warn">Changes not sent</span>' : '') : '<span class="chip">Not sent</span>'}
<div>${esc(x.address || '')}</div><div class="muted">${esc(KIND_LABEL[x.kind] || x.kind)}${x.tm_type ? ' · ' + esc(x.tm_type) : ''}${x.client_name ? ' · ' + esc(x.client_name) : ''}</div>
<div>${x.crew.map(c => esc(c.name)).join(', ') || '<span style="color:var(--red)">No crew</span>'}</div>${x.vehicle_ids.length ? `<div class="muted">${x.vehicle_ids.map(id => esc(vehicle(id).reg || '')).join(', ')}</div>` : ''}</a>`
        )
        .join('')}</div>`;
    })
    .join('')}</div>`;
};
