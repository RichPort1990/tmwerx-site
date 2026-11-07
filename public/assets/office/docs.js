/* Documents (risk assessment, method statement, vehicle checks, hazard list) and photo rules. */
'use strict';
const DOC_KINDS = [
  ['ra', 'Risk assessment'],
  ['method', 'Method statement'],
  ['vehicle_checks', 'Vehicle check items'],
  ['hazards', 'Site hazard list'],
];
SCREENS.docs = async (v, kind = 'ra') => {
  const dd = doc(kind),
    c = dd.content || {};
  const isAdmin = B.boot.me.role === 'admin';
  const vers = await api('GET', `/docs/${kind}/versions`);
  let body;
  if (kind === 'ra')
    body = `<table class="editor"><tr><th>Hazard</th><th>Who</th><th>Controls</th><th>Residual risk</th><th></th></tr><tbody id="rows">${(c.rows || []).map(r => raRow(r)).join('')}</tbody></table><button class="sm sec" id="addRow" style="margin-top:8px">Add a row</button>`;
  else if (kind === 'method')
    body = `<div id="rows">${(c.sections || []).map(s => msRow(s)).join('')}</div><button class="sm sec" id="addRow" style="margin-top:8px">Add a section</button>`;
  else
    body = `<p class="muted">One per line.</p><textarea id="items" style="min-height:320px">${esc((c.items || []).join('\n'))}</textarea>`;
  v.innerHTML = `<div class="head"><div><h1>Documents</h1><p class="sub">What the crew read and sign on their phones, and what goes in every job pack. Each save is a new version; the old ones are kept.</p></div></div>
<div class="tabs">${DOC_KINDS.map(([k, t]) => `<a href="#docs/${k}" class="${k === kind ? 'on' : ''}">${t}</a>`).join('')}</div>
${dd.reviewed_at ? `<div class="msg ok">Version ${dd.version}, approved by ${esc(dd.reviewer || '')} on ${fmtDT(dd.reviewed_at)}.</div>` : `<div class="msg warn"><span class="draft">DRAFT</span> Version ${dd.version || 1}${dd.created_by === 'starter' ? ' is TM WerX starter wording' : ' is not approved yet'}. Phones and packs show it as a draft until an administrator approves it. Check it against your own assessments, the Code of Practice and each job.</div>`}
<div class="card"><label>Title</label><input type="text" id="title" value="${esc(c.title || dd.title || '')}">${body}
<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="sec" id="draft">Save as draft</button>${isAdmin ? '<button id="appr">Save and approve</button>' : '<span class="muted">Only an administrator can approve.</span>'}</div></div>
<div class="card"><h2>Versions</h2><table>${vers.versions.map(x => `<tr><td>v${x.version}</td><td>${fmtDT(x.created_at)}</td><td>${esc(x.by_name || (x.version === 1 ? 'Starter' : ''))}</td><td>${x.reviewed_at ? `<span class="chip ok">Approved by ${esc(x.reviewer || '')}</span>` : '<span class="chip">Draft</span>'}</td></tr>`).join('')}</table></div>`;
  if ($('#addRow'))
    $('#addRow').onclick = () =>
      $('#rows').insertAdjacentHTML('beforeend', kind === 'ra' ? raRow(['', '', '', '']) : msRow(['', '']));
  v.addEventListener('click', e => e.target.classList.contains('rx') && e.target.closest('.r').remove());
  const read = () => {
    const t = val('title');
    if (kind === 'ra')
      return { title: t, rows: $$('#rows .r').map(r => $$('textarea,input', r).map(i => i.value.trim())) };
    if (kind === 'method')
      return {
        title: t,
        sections: $$('#rows .r').map(r => [$('input', r).value.trim(), $('textarea', r).value.trim()]),
      };
    return {
      title: t,
      items: $('#items')
        .value.split('\n')
        .map(s => s.trim())
        .filter(Boolean),
    };
  };
  const save = async reviewed => {
    const r = await guard(
      () => api('POST', '/docs/' + kind, { content: read(), reviewed }),
      reviewed ? 'Saved and approved' : 'Saved as draft'
    );
    if (r) await reboot(), route();
  };
  $('#draft').onclick = () => save(false);
  if ($('#appr')) $('#appr').onclick = () => save(true);
};
const raRow = r =>
  `<tr class="r"><td><textarea>${esc(r[0])}</textarea></td><td><input type="text" value="${esc(r[1])}"></td><td><textarea style="min-width:300px">${esc(r[2])}</textarea></td><td><input type="text" value="${esc(r[3])}" style="max-width:110px"></td><td><button class="sm sec rx" type="button">✕</button></td></tr>`;
const msRow = s =>
  `<div class="r card" style="padding:12px"><div class="row"><div><input type="text" value="${esc(s[0])}" placeholder="Heading"></div><div class="narrow" style="flex:0 0 50px;min-width:50px"><button class="sm sec rx" type="button">✕</button></div></div><textarea style="margin-top:6px">${esc(s[1])}</textarea></div>`;

const TRIG_EVENTS = {
  arrival: 'On arrival (sign in)',
  before_work: 'Before work starts',
  setup: 'Layout set up',
  removal: 'After removal',
  site_clear: 'Site left clear',
};
function ruleWhen(r) {
  return r.trig === 'event'
    ? TRIG_EVENTS[r.event] || r.event
    : r.trig === 'repeat'
      ? `Every ${r.every_mins} minutes while working`
      : `Daily at ${r.at_time}`;
}
function ruleScope(r) {
  if (r.scope === 'company') return 'Every job';
  if (r.scope === 'client') return 'Client: ' + (client(r.scope_ref).name || '?');
  if (r.scope === 'tm_type') return 'Type: ' + r.scope_ref;
  return 'One job';
}
SCREENS.rules = async v => {
  await reboot(); // someone else in the office may have changed these
  v.innerHTML = `<div class="head"><div><h1>Photo rules</h1><p class="sub">Which photos the crew must take, and when. Company rules apply to every job; a client's rules are added on top for that client's jobs. The phone shows each photo when it falls due, and you're alerted if it's missed.</p></div><div class="acts"><button id="add">Add rule</button></div></div>
<div class="card"><table><tr><th>Rule</th><th>When</th><th>Applies to</th><th>Photo</th><th>Allowance</th><th></th></tr>${B.boot.rules.map(r => `<tr style="${r.active ? '' : 'opacity:.5'}"><td><b>${esc(r.name)}</b>${r.active ? '' : ' <span class="chip">off</span>'}</td><td>${esc(ruleWhen(r))}</td><td>${esc(ruleScope(r))}</td><td>${esc(r.label)}${r.count > 1 ? ' ×' + r.count : ''}</td><td>${r.grace_mins} min, office alerted after ${r.escalate_mins}</td><td class="n"><button class="sm sec" data-ed="${esc(r.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No rules.</td></tr>'}</table>
<p class="muted">A photo taken on time but sent late (no signal) still counts as on time if it arrives within ${B.boot.settings.late_photo_hours} hours. Change this under Settings.</p></div>`;
  $('#add').onclick = () => ruleBox(null);
  $$('[data-ed]', v).forEach(b => (b.onclick = () => ruleBox(B.boot.rules.find(r => r.id === b.dataset.ed))));
};
function ruleBox(r) {
  r = r || {
    scope: 'company',
    trig: 'event',
    event: 'arrival',
    grace_mins: 10,
    count: 1,
    escalate_mins: 30,
    active: 1,
  };
  const d = modal(
    `<h2>${r.id ? 'Edit rule' : 'Add a photo rule'}</h2><div class="row"><div><label>Name</label><input type="text" id="name" value="${esc(r.name || '')}" placeholder="e.g. Hourly layout check"></div><div><label>The photo should show</label><input type="text" id="label" value="${esc(r.label || '')}" placeholder="e.g. Whole layout from the advance sign"></div></div>
<div class="row"><div><label>Applies to</label><select id="scope">${opt(['company', 'client', 'tm_type'], r.scope, { company: 'Every job', client: 'One client', tm_type: 'A type of TM' })}</select></div><div id="refBox"></div></div>
<div class="row"><div><label>When</label><select id="trig">${opt(['event', 'repeat', 'daily'], r.trig, { event: 'At a moment in the job', repeat: 'Repeating while working', daily: 'At a time each day' })}</select></div><div id="whenBox"></div></div>
<div class="row"><div class="narrow"><label>Photos</label><input type="number" id="count" min="1" max="10" value="${esc(r.count)}"></div><div class="narrow"><label>Allowance (min)</label><input type="number" id="grace_mins" min="0" max="240" value="${esc(r.grace_mins)}"></div><div class="narrow"><label>Alert office after (min)</label><input type="number" id="escalate_mins" min="5" max="600" value="${esc(r.escalate_mins)}"></div></div>
<label class="chk"><input type="checkbox" id="active" ${r.active ? 'checked' : ''}> Rule is on</label><div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Save</button></div>`,
    'wide'
  );
  const drawRef = () => {
    const s = val('scope', d);
    $('#refBox', d).innerHTML =
      s === 'client'
        ? `<label>Client</label><select id="scope_ref">${B.boot.clients
            .filter(c => !c.archived)
            .map(c => `<option value="${esc(c.id)}" ${c.id === r.scope_ref ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}</select>`
        : s === 'tm_type'
          ? `<label>Type</label><select id="scope_ref">${opt(B.boot.tm_types, r.scope_ref)}</select>`
          : '';
  };
  const drawWhen = () => {
    const t = val('trig', d);
    $('#whenBox', d).innerHTML =
      t === 'event'
        ? `<label>Moment</label><select id="event">${opt(Object.keys(TRIG_EVENTS), r.event, TRIG_EVENTS)}</select>`
        : t === 'repeat'
          ? `<label>Every (minutes)</label><input type="number" id="every_mins" min="15" max="1440" value="${esc(r.every_mins || 60)}">`
          : `<label>Time</label><input type="time" id="at_time" value="${esc(r.at_time || '12:00')}">`;
  };
  $('#scope', d).onchange = drawRef;
  $('#trig', d).onchange = drawWhen;
  drawRef();
  drawWhen();
  $('#go', d).onclick = async () => {
    const b = {
      name: val('name', d),
      label: val('label', d),
      scope: val('scope', d),
      scope_ref: val('scope_ref', d) || null,
      trig: val('trig', d),
      count: +val('count', d),
      grace_mins: +val('grace_mins', d),
      escalate_mins: +val('escalate_mins', d),
      active: val('active', d),
    };
    if (b.trig === 'event') b.event = val('event', d);
    if (b.trig === 'repeat') b.every_mins = +val('every_mins', d);
    if (b.trig === 'daily') b.at_time = val('at_time', d);
    if (await guard(() => (r.id ? api('PUT', '/rules/' + r.id, b) : api('POST', '/rules', b)), 'Saved'))
      d.close(), await reboot(), route();
  };
}
