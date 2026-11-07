/* Company settings (administrators), the intake address, the CAD WerX link and the export. */
'use strict';
const START_REQ = {
  ra_signoff: 'RAMS signed',
  risk_check: 'On-site check done',
  vehicle_check: 'Vehicle check done',
  loaded: 'Van loaded and counted',
  drawing_ack: 'Drawing confirmed',
};
SCREENS.settings = async v => {
  const s = B.boot.settings,
    admin = B.boot.me.role === 'admin';
  const n = (k, label, help, unit = '') =>
    `<div><label>${label}</label><input type="number" id="${k}" value="${esc(s[k])}" ${admin ? '' : 'disabled'}>${help ? `<p class="muted">${help}${unit}</p>` : ''}</div>`;
  v.innerHTML = `<div class="head"><div><h1>Settings</h1><p class="sub">${admin ? 'How TM WerX works for your company.' : 'Only an administrator can change these.'} Your plan, invoices, office users and logo are under <a href="/account">Account</a>.</p></div></div>
<div class="card"><h2>On site</h2>
<label>Before the crew can start work</label><div class="chips">${Object.entries(START_REQ)
    .map(
      ([k, t]) =>
        `<label class="chk" style="margin-right:14px"><input type="checkbox" class="sr" value="${k}" ${s.start_requires.includes(k) ? 'checked' : ''} ${admin ? '' : 'disabled'}> ${t}</label>`
    )
    .join('')}</div>
<div class="row">${n('geofence_m', 'Sign-in distance (metres)', 'Further than this from the site asks for a reason and alerts you.')}${n('lone_every_mins', 'Lone working check-in (minutes)', '')}${n('pending_limit_hours', 'Unsent records warning (hours)', 'The phone warns the crew when records have waited this long for signal.')}</div>
<div class="row">${n('late_photo_hours', 'Late photo allowance (hours)', 'Photos taken on time but sent later than this count as missed.')}${n('spares_pct', 'Spares to load (%)', '')}</div>
<label class="chk"><input type="checkbox" id="allow_gallery" ${s.allow_gallery ? 'checked' : ''} ${admin ? '' : 'disabled'}> Allow photos from the phone's gallery (otherwise camera only)</label>
<label>Items that must be on every van</label><textarea id="mandatory_items" ${admin ? '' : 'disabled'} placeholder="One per line, e.g. First aid kit">${esc((s.mandatory_items || []).join('\n'))}</textarea></div>
<div class="card"><h2>Working time and records</h2><div class="row">${n('day_hours_limit', 'Day limit (hours)', '')}${n('week_hours_limit', 'Week limit (hours)', '')}<div><label>Week starts</label><select id="week_start" ${admin ? '' : 'disabled'}>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${+s.week_start === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>${n('retention_years', 'Keep job records (years)', 'Completed jobs older than this are deleted, with their photos.')}</div></div>
<div class="card"><h2>CAD WerX</h2><p class="muted">Link your CAD WerX account to pick saved, issued drawings straight onto jobs, with their equipment lists. Get the link code from CAD WerX (Account, TM WerX link).</p><label>Link code</label><input type="text" id="cadwerx_link" value="${esc(s.cadwerx_link || '')}" ${admin ? '' : 'disabled'}>${B.boot.cadwerx ? '' : '<p class="muted">The CAD WerX connection is not switched on for this site yet.</p>'}</div>
${admin ? '<div class="card"><button id="save">Save settings</button></div>' : ''}
<div class="card"><h2>Job requests by email</h2><p>Forward job emails to <b class="mono">${esc(B.boot.intake_address || '')}</b>. They appear under Job requests for you to check. Keep this address private.</p></div>
<div class="card"><h2>Your data</h2><p>Download everything in your account (jobs, records, people, documents) as one file. Photos and drawings download per job as a zip.</p><a class="btn sec" href="/api/office/export">Download export</a></div>`;
  if (!admin) return;
  $('#save').onclick = async () => {
    const b = {
      start_requires: $$('.sr:checked').map(i => i.value),
      allow_gallery: val('allow_gallery'),
      mandatory_items: $('#mandatory_items')
        .value.split('\n')
        .map(x => x.trim())
        .filter(Boolean),
      week_start: +val('week_start'),
      cadwerx_link: val('cadwerx_link'),
    };
    for (const k of [
      'geofence_m',
      'lone_every_mins',
      'pending_limit_hours',
      'late_photo_hours',
      'spares_pct',
      'day_hours_limit',
      'week_hours_limit',
      'retention_years',
    ])
      b[k] = +val(k);
    const r = await guard(() => api('PUT', '/settings', b), 'Settings saved');
    if (r) B.boot.settings = r.settings;
  };
};
