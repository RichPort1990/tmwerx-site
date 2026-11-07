/* Safety (near misses, actions, audits, lone working), timesheets and working-time limits, costs and invoicing. */
'use strict';
function rangePicker(v, name, from, to) {
  return `<div class="row" style="max-width:520px"><div><label>From</label><input type="date" id="from" value="${esc(from)}"></div><div><label>To</label><input type="date" id="to" value="${esc(to)}"></div><div class="narrow" style="align-self:flex-end"><button class="sec" id="go">Show</button></div></div>`;
}
function wireRange(name) {
  $('#go').onclick = () => (location.hash = `${name}/${val('from')}/${val('to')}`);
}
function csv(rows, name) {
  const s = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + s], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const hrs = ms => (ms / 3600e3).toFixed(2);

SCREENS.time = async (v, from, to) => {
  const ws = weekStart(iso(new Date()));
  const r = await api('GET', `/time?from=${from || ws}&to=${to || addDays(ws, 6)}`);
  const s = r.settings;
  const people = [...new Set(r.shifts.map(x => x.user_id))];
  const tot = id => r.shifts.filter(x => x.user_id === id && x.end).reduce((t, x) => t + (x.end - x.start), 0);
  v.innerHTML = `<div class="head"><div><h1>Timesheets</h1><p class="sub">From sign-in to sign-out (or finishing the day) on the crew app. Limits: ${s.day_hours_limit} hours a day, ${s.week_hours_limit} a week.</p></div><div class="acts"><button class="sec" id="csv">Download CSV</button></div></div>
<div class="card">${rangePicker(v, 'time', r.from, r.to)}</div>
<div class="card"><h2>Totals</h2><table><tr><th>Name</th><th class="n">Shifts</th><th class="n">Hours</th><th></th></tr>${
    people
      .map(id => {
        const t = tot(id) / 3600e3,
          p = r.shifts.find(x => x.user_id === id);
        return `<tr><td>${esc(p.name)}</td><td class="n">${r.shifts.filter(x => x.user_id === id).length}</td><td class="n">${t.toFixed(2)}</td><td>${t > s.week_hours_limit ? '<span class="chip bad">Over the weekly limit</span>' : ''}</td></tr>`;
      })
      .join('') || '<tr><td class="empty" colspan="4">No shifts in this range.</td></tr>'
  }</table></div>
<div class="card"><h2>Shifts</h2><div class="tw"><table><tr><th>Name</th><th>Job</th><th>Signed in</th><th>Finished</th><th class="n">Hours</th></tr>${r.shifts.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.job)}</td><td>${fmtDT(x.start)}</td><td>${x.end ? fmtDT(x.end) : '<span class="chip warn">Still signed in</span>'}</td><td class="n">${x.end ? hrs(x.end - x.start) : ''}${x.end && x.end - x.start > s.day_hours_limit * 3600e3 ? ' <span class="chip bad">long</span>' : ''}</td></tr>`).join('')}</table></div></div>`;
  wireRange('time');
  $('#csv').onclick = () =>
    csv(
      [
        ['Name', 'Job', 'Signed in', 'Finished', 'Hours'],
        ...r.shifts.map(x => [
          x.name,
          x.job,
          new Date(x.start).toLocaleString('en-GB'),
          x.end ? new Date(x.end).toLocaleString('en-GB') : '',
          x.end ? hrs(x.end - x.start) : '',
        ]),
      ],
      `timesheet-${r.from}-${r.to}.csv`
    );
};

SCREENS.costs = async (v, from, to) => {
  const ws = weekStart(iso(new Date()));
  const r = await api('GET', `/costs?from=${from || ws}&to=${to || addDays(ws, 6)}`);
  const sum = k => r.rows.reduce((t, x) => t + (x[k] || 0), 0);
  const jobs = [...new Map(r.rows.map(x => [x.job_id, x])).values()];
  v.innerHTML = `<div class="head"><div><h1>Costs and invoicing</h1><p class="sub">Income from each job's rate (per day, per hour from the timesheets, or a fixed price on the last day), less crew day costs and the client's daily deduction.</p></div><div class="acts"><button class="sec" id="csv">Download CSV</button></div></div>
<div class="card">${rangePicker(v, 'costs', r.from, r.to)}</div>
<div class="stats"><div class="stat"><b>${money(sum('income'))}</b><span>Income</span></div><div class="stat"><b>${money(sum('labour'))}</b><span>Crew costs</span></div><div class="stat"><b>${money(sum('deduction'))}</b><span>Deductions</span></div><div class="stat"><b style="color:${sum('margin') < 0 ? 'var(--red)' : 'var(--ok)'}">${money(sum('margin'))}</b><span>Margin</span></div></div>
<div class="card"><h2>Working days</h2><div class="tw"><table><tr><th>Date</th><th>Job</th><th>Client</th><th>Basis</th><th class="n">Income</th><th class="n">Crew</th><th class="n">Deduction</th><th class="n">Margin</th></tr>${r.rows.map(x => `<tr><td>${esc(fmtDate(x.date))}</td><td><a href="#job/${esc(x.job_id)}">${esc(x.number)}</a><div class="muted">${esc(x.address || '')}</div></td><td>${esc(x.client)}</td><td>${esc(x.basis || '')}${x.basis === 'hourly' ? ` · ${x.hours} h` : ''}</td><td class="n">${money(x.income)}</td><td class="n">${money(x.labour)}</td><td class="n">${money(x.deduction)}</td><td class="n" style="color:${x.margin < 0 ? 'var(--red)' : ''}">${money(x.margin)}</td></tr>`).join('') || '<tr><td class="empty" colspan="8">No working days in this range.</td></tr>'}</table></div></div>
${jobs.length ? `<div class="card"><h2>Invoicing</h2><table><tr><th>Job</th><th>Client</th><th>Ready to invoice</th><th>Invoiced</th></tr>${jobs.map(x => `<tr><td>${esc(x.number)}</td><td>${esc(x.client)}</td><td><input type="checkbox" data-ready="${esc(x.job_id)}" ${x.invoice_ready ? 'checked' : ''}></td><td><input type="checkbox" data-inv="${esc(x.job_id)}" ${x.invoiced ? 'checked' : ''}></td></tr>`).join('')}</table></div>` : ''}`;
  wireRange('costs');
  $$('[data-ready]', v).forEach(
    c =>
      (c.onchange = () =>
        guard(() => api('PUT', `/jobs/${c.dataset.ready}/invoice`, { invoice_ready: c.checked }), 'Saved'))
  );
  $$('[data-inv]', v).forEach(
    c =>
      (c.onchange = () => guard(() => api('PUT', `/jobs/${c.dataset.inv}/invoice`, { invoiced: c.checked }), 'Saved'))
  );
  $('#csv').onclick = () =>
    csv(
      [
        ['Date', 'Job', 'Address', 'Client', 'Basis', 'Hours', 'Income', 'Crew', 'Deduction', 'Margin'],
        ...r.rows.map(x => [
          x.date,
          x.number,
          x.address,
          x.client,
          x.basis,
          x.hours,
          pounds(x.income),
          pounds(x.labour),
          pounds(x.deduction),
          pounds(x.margin),
        ]),
      ],
      `costs-${r.from}-${r.to}.csv`
    );
};

const AUDIT_STARTER = [
  'Signs to the drawing and at the right distances',
  'Cones and taper spacing correct',
  'Safety zones kept clear',
  'Pedestrian route the right width and protected',
  'Signals timed and working, or Stop/Go in place',
  'Crew in correct PPE',
  'Vehicle parked safely with beacons',
  'Paperwork and permit on site',
];
SCREENS.safety = async v => {
  const r = await api('GET', '/safety');
  const open = r.actions.filter(a => a.status === 'open');
  v.innerHTML = `<div class="head"><div><h1>Safety</h1><p class="sub">Near misses reported from site, the actions that follow, site audits and who is lone working now.</p></div><div class="acts"><button class="sec" id="addA">Add action</button><button id="audit">Record an audit</button></div></div>
${r.lone.length ? `<div class="card"><h2>Lone working now</h2><table>${r.lone.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.phone || '')}</td><td>Last check-in ${l.last_checkin ? fmtT(l.last_checkin) : '-'}</td><td>Next due ${fmtT(l.next_due)} ${l.missed ? '<span class="chip bad">Missed</span>' : ''}</td></tr>`).join('')}</table></div>` : ''}
<div class="card"><h2>Open actions (${open.length})</h2><table><tr><th>Action</th><th>From</th><th>Owner</th><th>Due</th><th></th></tr>${open.map(a => `<tr><td>${esc(a.title)}</td><td>${esc(a.source || '')}</td><td>${esc(a.owner || '')}</td><td>${a.due ? (a.due < iso(new Date()) ? `<span class="chip bad">${esc(a.due)}</span>` : esc(a.due)) : ''}</td><td class="n"><button class="sm sec" data-act="${esc(a.id)}">Update</button></td></tr>`).join('') || '<tr><td class="empty" colspan="5">No open actions.</td></tr>'}</table></div>
<div class="card"><h2>Near misses</h2><table>${r.near_misses.map(n => `<tr><td style="white-space:nowrap">${fmtDT(n.client_time || n.server_time)}</td><td>${esc(n.user_name)}</td><td>${n.number ? `<a href="#job/${esc(n.job_id)}">${esc(n.number)}</a>` : ''}</td><td>${esc(n.data.text || '')}</td></tr>`).join('') || '<tr><td class="empty">None reported.</td></tr>'}</table></div>
<div class="card"><h2>Audits</h2><table>${
    r.audits
      .map(
        a =>
          `<tr><td>${fmtDT(a.created_at)}</td><td>${esc(a.auditor_name)}</td><td>${a.number ? esc(a.number) : ''}</td><td>${a.score != null ? `<span class="chip ${a.score >= 90 ? 'ok' : a.score >= 70 ? 'warn' : 'bad'}">${a.score}%</span>` : ''}</td><td class="muted">${esc(
            (a.data.items || [])
              .filter(i => i.result === 'fail')
              .map(i => i.q)
              .join('; ')
          )}</td></tr>`
      )
      .join('') || '<tr><td class="empty">No audits yet.</td></tr>'
  }</table>
<h3>Closed actions</h3><table>${
    r.actions
      .filter(a => a.status === 'closed')
      .slice(0, 30)
      .map(
        a =>
          `<tr><td>${esc(a.title)}</td><td class="muted">${esc(a.note || '')}</td><td>${fmtDT(a.closed_at)}</td></tr>`
      )
      .join('') || '<tr><td class="muted">None.</td></tr>'
  }</table></div>`;
  $('#addA').onclick = () => {
    const d = modal(
      `<h2>Add an action</h2><label>Action</label><input type="text" id="t"><div class="row"><div><label>Owner</label><input type="text" id="o"></div><div><label>Due</label><input type="date" id="du"></div></div><div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Add</button></div>`
    );
    $('#go', d).onclick = async () =>
      (await guard(
        () => api('POST', '/actions', { title: val('t', d), owner: val('o', d), due: val('du', d) }),
        'Added'
      )) && (d.close(), route());
  };
  $$('[data-act]', v).forEach(
    b =>
      (b.onclick = () => {
        const a = r.actions.find(x => x.id === b.dataset.act);
        const d = modal(
          `<h2>Action</h2><p>${esc(a.title)}</p><div class="row"><div><label>Owner</label><input type="text" id="o" value="${esc(a.owner || '')}"></div><div><label>Due</label><input type="date" id="du" value="${esc(a.due || '')}"></div></div><label>Note</label><textarea id="n">${esc(a.note || '')}</textarea><label class="chk"><input type="checkbox" id="cl"> Done: close it</label><div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Save</button></div>`
        );
        $('#go', d).onclick = async () =>
          (await guard(
            () =>
              api('PUT', '/actions/' + a.id, {
                owner: val('o', d),
                due: val('du', d),
                note: val('n', d),
                status: val('cl', d) ? 'closed' : 'open',
              }),
            'Saved'
          )) && (d.close(), route());
      })
  );
  $('#audit').onclick = async () => {
    const jobs = (await api('GET', '/jobs?status=open')).jobs;
    const d = modal(
      `<h2>Site audit</h2><label>Job</label><select id="job"><option value="">None</option>${jobs.map(j => `<option value="${esc(j.id)}">${esc(j.number)} ${esc(j.address || '')}</option>`).join('')}</select>
<table class="editor" style="margin-top:12px"><tr><th>Check</th><th>Pass</th><th>Fail</th><th>N/A</th><th>Note</th></tr><tbody id="ai">${AUDIT_STARTER.map((q, i) => auditRow(q, i)).join('')}</tbody></table><button class="sm sec" id="aadd" style="margin-top:6px">Add a check</button>
<label>Notes</label><textarea id="an"></textarea><p class="muted">Each fail becomes an open action.</p><div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Save audit</button></div>`,
      'wide'
    );
    let n = AUDIT_STARTER.length;
    $('#aadd', d).onclick = () => $('#ai', d).insertAdjacentHTML('beforeend', auditRow('', n++));
    $('#go', d).onclick = async () => {
      const items = $$('#ai tr', d).map(tr => ({
        q: $('.q', tr).value.trim(),
        result: ($('input[type=radio]:checked', tr) || {}).value || 'na',
        note: $('.nt', tr).value.trim(),
      }));
      const x = await guard(() => api('POST', '/audits', { job_id: val('job', d), items, notes: val('an', d) }));
      if (x) d.close(), toast(`Saved${x.score != null ? ': ' + x.score + '%' : ''}`), route();
    };
  };
};
const auditRow = (q, i) =>
  `<tr><td><input type="text" class="q" value="${esc(q)}"></td><td><input type="radio" name="a${i}" value="pass"></td><td><input type="radio" name="a${i}" value="fail"></td><td><input type="radio" name="a${i}" value="na" checked></td><td><input type="text" class="nt"></td></tr>`;
