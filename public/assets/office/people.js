/* Crew logins and qualifications, vehicles and their checks, clients. */
'use strict';
function showPassword(name, username, pw) {
  modal(`<h2>${esc(name)}'s login</h2><p>Give them these. They sign in at <b>${esc(location.host)}/crew</b> on their phone and add it to their home screen.</p>
<label>Username</label><div class="pw">${esc(username)}</div><label>Password</label><div class="pw">${esc(pw)}</div><p class="muted">The password is not shown again. You can reset it at any time.</p><div class="acts"><button data-close>Done</button></div>`);
}
SCREENS.crew = async v => {
  await reboot(); // someone else in the office may have changed these
  const q = await api('GET', '/quals');
  const today = iso(new Date()),
    soon = addDays(today, 30);
  const ppl = B.boot.people;
  const crewL = ppl.filter(p => ['lead', 'engineer'].includes(p.role)),
    office = ppl.filter(p => ['admin', 'office'].includes(p.role));
  v.innerHTML = `<div class="head"><div><h1>Crew</h1><p class="sub">Crew sign in with a username, not an email. Each active login is a seat on your subscription.</p></div><div class="acts"><button id="add">Add crew login</button></div></div>
<div class="card"><div class="tw"><table><tr><th>Name</th><th>Username</th><th>Role</th><th>Phone app</th><th>Qualifications</th><th>Day cost</th><th></th></tr>${
    crewL
      .map(p => {
        const pq = q.quals.filter(x => x.user_id === p.id);
        return `<tr style="${p.disabled ? 'opacity:.5' : ''}"><td><b>${esc(p.name)}</b>${p.phone ? `<div class="muted">${esc(p.phone)}</div>` : ''}</td><td class="mono">${esc(p.username)}</td><td>${p.role === 'lead' ? 'Lead' : 'Operative'}${p.disabled ? ' <span class="chip">Switched off</span>' : ''}</td>
<td>${p.installed_at ? '<span class="chip ok">On home screen</span>' : '<span class="chip">Not installed</span>'} ${p.push_ok ? '<span class="chip ok">Alerts on</span>' : '<span class="chip warn">Alerts off</span>'}<div class="muted">Last seen ${ago(p.last_seen)}</div></td>
<td>${pq.map(x => `${esc(x.name)} ${x.expires ? (x.expires < today ? '<span class="chip bad">expired</span>' : x.expires < soon ? `<span class="chip warn">${esc(x.expires)}</span>` : `<span class="muted">${esc(x.expires)}</span>`) : ''}`).join('<br>') || '<span class="muted">None</span>'}</td>
<td>${money(p.day_cost)}</td><td class="n"><button class="sm sec" data-ed="${esc(p.id)}">Edit</button></td></tr>`;
      })
      .join('') || '<tr><td colspan="7" class="empty">No crew yet.</td></tr>'
  }</table></div></div>
<div class="card"><h2>Office users</h2><p class="muted">Office users sign in with their email. Invite them from <a href="/account">Account</a>.</p><table>${office.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.email || '')}</td><td>${p.role === 'admin' ? 'Administrator' : 'Office user'}</td></tr>`).join('')}</table></div>`;
  $('#add').onclick = () => {
    const d =
      modal(`<h2>Add a crew login</h2><div class="row"><div><label>Name</label><input type="text" id="name"></div><div><label>Username</label><input type="text" id="username" placeholder="e.g. jsmith"></div></div>
<div class="row"><div><label>Role</label><select id="role"><option value="engineer">Operative</option><option value="lead">Lead (sees and signs for the crew)</option></select></div><div><label>Mobile</label><input type="tel" id="phone"></div><div class="narrow"><label>Day cost (£)</label><input type="text" id="day_cost"></div></div>
<div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Add</button></div>`);
    $('#name', d).oninput = () => {
      if (!$('#username', d).dataset.touched)
        $('#username', d).value = val('name', d)
          .toLowerCase()
          .replace(/[^a-z ]/g, '')
          .replace(/^(\w)\w*\s+/, '$1')
          .replace(/\s+/g, '');
    };
    $('#username', d).oninput = e => (e.target.dataset.touched = 1);
    $('#go', d).onclick = async () => {
      const r = await guard(() =>
        api('POST', '/people', {
          name: val('name', d),
          username: val('username', d),
          role: val('role', d),
          phone: val('phone', d),
          day_cost: pence(val('day_cost', d)),
        })
      );
      if (!r) return;
      d.close();
      await reboot();
      showPassword(val('name', d), r.username, r.password);
      route();
    };
  };
  $$('[data-ed]', v).forEach(b => (b.onclick = () => personBox(ppl.find(p => p.id === b.dataset.ed))));
};
async function personBox(p) {
  const q = await api('GET', `/people/${p.id}/quals`);
  const d = modal(
    `<h2>${esc(p.name)}</h2><div class="row"><div><label>Name</label><input type="text" id="name" value="${esc(p.name)}"></div><div><label>Role</label><select id="role"><option value="engineer" ${p.role === 'engineer' ? 'selected' : ''}>Operative</option><option value="lead" ${p.role === 'lead' ? 'selected' : ''}>Lead</option></select></div></div>
<div class="row"><div><label>Mobile</label><input type="tel" id="phone" value="${esc(p.phone || '')}"></div><div><label>Day cost (£)</label><input type="text" id="day_cost" value="${esc(pounds(p.day_cost))}"></div></div>
<label class="chk"><input type="checkbox" id="disabled" ${p.disabled ? 'checked' : ''}> Switched off (cannot sign in; frees the seat)</label>
<h3>Qualifications and cards</h3><table id="ql">${q.quals.map(x => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.number || '')}</td><td>${esc(x.expires || '')}</td><td class="n"><button class="sm sec" data-dq="${esc(x.id)}">Remove</button></td></tr>`).join('')}</table>
<div class="row"><div><input type="text" id="qn" placeholder="e.g. NHSS 12D T2, CSCS"></div><div><input type="text" id="qno" placeholder="Card number"></div><div class="narrow"><input type="date" id="qe"></div><div class="narrow"><button class="sec" id="qa">Add</button></div></div>
<div class="acts"><button class="sec" id="reset">Reset password</button><button class="sec" data-close>Cancel</button><button id="go">Save</button></div>`,
    'wide'
  );
  $('#go', d).onclick = async () => {
    if (
      await guard(
        () =>
          api('PUT', '/people/' + p.id, {
            name: val('name', d),
            role: val('role', d),
            phone: val('phone', d),
            day_cost: pence(val('day_cost', d)),
            disabled: val('disabled', d),
          }),
        'Saved'
      )
    )
      d.close(), await reboot(), route();
  };
  $('#reset', d).onclick = async () => {
    if (!(await confirmBox(`Give ${p.name} a new password? They are signed out on every phone.`, 'Reset'))) return;
    const r = await guard(() => api('POST', `/people/${p.id}/reset`));
    if (r) d.close(), showPassword(p.name, r.username, r.password);
  };
  $('#qa', d).onclick = async () =>
    (await guard(
      () => api('POST', `/people/${p.id}/quals`, { name: val('qn', d), number: val('qno', d), expires: val('qe', d) }),
      'Added'
    )) && (d.close(), personBox(p));
  $$('[data-dq]', d).forEach(
    b =>
      (b.onclick = async () =>
        (await guard(() => api('DELETE', '/quals/' + b.dataset.dq))) && (d.close(), personBox(p)))
  );
}

SCREENS.vehicles = async v => {
  await reboot(); // someone else in the office may have changed these
  const today = iso(new Date()),
    soon = addDays(today, 30);
  const due = x =>
    !x
      ? '<span class="muted">-</span>'
      : x < today
        ? `<span class="chip bad">${esc(x)}</span>`
        : x < soon
          ? `<span class="chip warn">${esc(x)}</span>`
          : esc(x);
  v.innerHTML = `<div class="head"><div><h1>Vehicles</h1><p class="sub">A van reported not safe on its daily check can't go on a job until you clear it here.</p></div><div class="acts"><button id="add">Add vehicle</button></div></div>
<div class="card"><div class="tw"><table><tr><th>Registration</th><th>State</th><th>MOT</th><th>Tax</th><th>Service</th><th>Insurance</th><th></th></tr>${
    B.boot.vehicles
      .map(
        x => `<tr><td><b>${esc(x.reg)}</b><div class="muted">${esc([x.model, x.kind].filter(Boolean).join(' · '))}</div></td><td>${x.unsafe ? '<span class="chip bad">Reported not safe</span>' : x.off_road ? '<span class="chip">Off road</span>' : '<span class="chip ok">In use</span>'}</td>
<td>${due(x.mot_due)}</td><td>${due(x.tax_due)}</td><td>${due(x.service_due)}</td><td>${due(x.insurance_due)}</td><td class="n"><button class="sm sec" data-ck="${esc(x.id)}">Checks</button> <button class="sm sec" data-ed="${esc(x.id)}">Edit</button></td></tr>`
      )
      .join('') || '<tr><td colspan="7" class="empty">No vehicles yet.</td></tr>'
  }</table></div></div>`;
  $('#add').onclick = () => vehBox(null);
  $$('[data-ed]', v).forEach(b => (b.onclick = () => vehBox(vehicle(b.dataset.ed))));
  $$('[data-ck]', v).forEach(b => (b.onclick = () => vehChecks(vehicle(b.dataset.ck))));
};
function vehBox(x) {
  const d = modal(
    `<h2>${x ? esc(x.reg) : 'Add a vehicle'}</h2><div class="row"><div><label>Registration</label><input type="text" id="reg" value="${esc(x ? x.reg : '')}"></div><div><label>Make and model</label><input type="text" id="model" value="${esc(x ? x.model || '' : '')}"></div><div><label>Kind</label><input type="text" id="kind" value="${esc(x ? x.kind || '' : '')}" placeholder="e.g. 3.5t crew cab"></div></div>
<div class="row"><div><label>MOT due</label><input type="date" id="mot_due" value="${esc(x ? x.mot_due || '' : '')}"></div><div><label>Tax due</label><input type="date" id="tax_due" value="${esc(x ? x.tax_due || '' : '')}"></div><div><label>Service due</label><input type="date" id="service_due" value="${esc(x ? x.service_due || '' : '')}"></div><div><label>Insurance due</label><input type="date" id="insurance_due" value="${esc(x ? x.insurance_due || '' : '')}"></div></div>
<label>Notes</label><textarea id="notes">${esc(x ? x.notes || '' : '')}</textarea><label class="chk"><input type="checkbox" id="off_road" ${x && x.off_road ? 'checked' : ''}> Off road</label>
${x && x.unsafe ? `<div class="msg err">Reported not safe. Once it is repaired, say what was done and clear it.</div><input type="text" id="fix" placeholder="What was done"><button class="sec" id="clr" style="margin-top:8px">Clear for use</button>` : ''}
<div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Save</button></div>`,
    'wide'
  );
  const b = () =>
    Object.fromEntries(
      ['reg', 'model', 'kind', 'mot_due', 'tax_due', 'service_due', 'insurance_due', 'notes', 'off_road'].map(k => [
        k,
        val(k, d),
      ])
    );
  $('#go', d).onclick = async () =>
    (await guard(() => (x ? api('PUT', '/vehicles/' + x.id, b()) : api('POST', '/vehicles', b())), 'Saved')) &&
    (d.close(), await reboot(), route());
  if ($('#clr', d))
    $('#clr', d).onclick = async () => {
      if (!val('fix', d)) return toast('Say what was done first.');
      if (
        await guard(
          () => api('PUT', '/vehicles/' + x.id, { clear_unsafe: true, note: val('fix', d) }),
          'Cleared for use'
        )
      )
        d.close(), await reboot(), route();
    };
}
async function vehChecks(x) {
  const r = await api('GET', `/vehicles/${x.id}/checks`);
  modal(
    `<h2>${esc(x.reg)}: daily checks</h2>${
      r.checks
        .map(
          c => `<div class="card"><b>${fmtDT(c.client_time || c.server_time)}</b> · ${esc(c.user_name)} ${c.data.safe === false ? '<span class="chip bad">NOT SAFE</span>' : '<span class="chip ok">Safe</span>'}${c.data.mileage ? ' · ' + esc(c.data.mileage) + ' miles' : ''}
<div>${
            (c.data.items || [])
              .filter(i => i.result === 'defect')
              .map(i => `<span class="chip warn">${esc(i.item)}${i.note ? ': ' + esc(i.note) : ''}</span>`)
              .join(' ') || '<span class="muted">No defects</span>'
          }</div>
${c.photos.length ? `<div class="photos" style="margin-top:8px">${c.photos.map(p => `<div class="ph"><img src="/api/office/file/photo/${esc(p.id)}" data-full="/api/office/file/photo/${esc(p.id)}" alt=""><div>${esc(p.caption || '')}</div></div>`).join('')}</div>` : ''}</div>`
        )
        .join('') || '<p class="empty">No checks yet.</p>'
    }<div class="acts"><button data-close>Close</button></div>`,
    'wide'
  );
}

SCREENS.clients = async v => {
  await reboot(); // someone else in the office may have changed these
  v.innerHTML = `<div class="head"><div><h1>Clients</h1><p class="sub">Clients can have their own photo rules (under Photo rules) and a daily deduction, such as a lane rental or admin charge, used in Costs.</p></div><div class="acts"><button id="add">Add client</button></div></div>
<div class="card"><table><tr><th>Client</th><th>Contact</th><th>Deduction per day</th><th></th></tr>${B.boot.clients.map(c => `<tr style="${c.archived ? 'opacity:.5' : ''}"><td><b>${esc(c.name)}</b>${c.archived ? ' <span class="chip">archived</span>' : ''}</td><td>${esc([c.contact, c.email, c.phone].filter(Boolean).join(' · '))}</td><td>${money(c.deduction_per_day)}</td><td class="n"><button class="sm sec" data-ed="${esc(c.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No clients yet.</td></tr>'}</table></div>`;
  const box = c => {
    const d =
      modal(`<h2>${c ? esc(c.name) : 'Add a client'}</h2><label>Name</label><input type="text" id="name" value="${esc(c ? c.name : '')}"><div class="row"><div><label>Contact</label><input type="text" id="contact" value="${esc(c ? c.contact || '' : '')}"></div><div><label>Email</label><input type="email" id="email" value="${esc(c ? c.email || '' : '')}"></div><div><label>Phone</label><input type="tel" id="phone" value="${esc(c ? c.phone || '' : '')}"></div></div>
<div class="row"><div class="narrow"><label>Deduction per day (£)</label><input type="text" id="ded" value="${esc(c ? pounds(c.deduction_per_day) : '')}"></div></div><label>Notes</label><textarea id="notes">${esc(c ? c.notes || '' : '')}</textarea>${c ? `<label class="chk"><input type="checkbox" id="archived" ${c.archived ? 'checked' : ''}> Archived</label>` : ''}
<div class="acts"><button class="sec" data-close>Cancel</button><button id="go">Save</button></div>`);
    $('#go', d).onclick = async () => {
      const b = {
        name: val('name', d),
        contact: val('contact', d),
        email: val('email', d),
        phone: val('phone', d),
        notes: val('notes', d),
        deduction_per_day: pence(val('ded', d)) || 0,
      };
      if (c) b.archived = val('archived', d);
      if (await guard(() => (c ? api('PUT', '/clients/' + c.id, b) : api('POST', '/clients', b)), 'Saved'))
        d.close(), await reboot(), route();
    };
  };
  $('#add').onclick = () => box(null);
  $$('[data-ed]', v).forEach(b => (b.onclick = () => box(client(b.dataset.ed))));
};
