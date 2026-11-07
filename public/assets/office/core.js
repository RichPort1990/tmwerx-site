/* TM WerX office app: shared helpers, the data loaded at start, and the page router. Each screen is a function in
   SCREENS that draws into #view. No framework. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const B = { boot: null }; // what /boot returned: me, people, vehicles, clients, docs, rules, settings, counts
const SCREENS = {};
let refreshTimer = null;

async function api(method, path, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array) {
    init.body = body;
    Object.assign(init.headers, opts.headers || {});
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const r = await fetch('/api/office' + path, init);
  if (r.status === 401) {
    location.href = '/login';
    throw new Error('Signed out');
  }
  const j = await r
    .json()
    .catch(() => ({ ok: false, error: 'The server did not answer properly (' + r.status + ').' }));
  if (!j.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
function toast(m, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = m;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
async function guard(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 5000);
    return null;
  }
}
// a modal: html inside a <dialog>; returns the dialog. Buttons with data-close close it.
function modal(html, cls = '') {
  const d = document.createElement('dialog');
  d.className = cls;
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) d.close();
  });
  d.showModal();
  return d;
}
function confirmBox(text, yes = 'Yes') {
  return new Promise(res => {
    const d = modal(
      `<p>${esc(text)}</p><div class="acts"><button class="sec" data-close>Cancel</button><button id="cbYes">${esc(yes)}</button></div>`
    );
    $('#cbYes', d).onclick = () => {
      d.close();
      res(true);
    };
    d.addEventListener('close', () => res(false));
  });
}
const fmtDate = d =>
  d
    ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : '';
const fmtDT = t =>
  t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const fmtT = t => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const ago = t => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1
    ? 'just now'
    : m < 60
      ? m + ' min ago'
      : m < 1440
        ? Math.round(m / 60) + ' h ago'
        : Math.round(m / 1440) + ' days ago';
};
const money = p =>
  p == null ? '' : '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pence = v => (v === '' || v == null ? null : Math.round(parseFloat(String(v).replace(/[£,\s]/g, '')) * 100));
const pounds = p => (p == null ? '' : (p / 100).toFixed(2));
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
const weekStart = s => {
  const d = new Date(s + 'T12:00:00'),
    ws = (B.boot && B.boot.settings.week_start) ?? 1;
  d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7));
  return iso(d);
};
const val = (id, r = document) => {
  const e = r.querySelector('#' + id);
  return e ? (e.type === 'checkbox' ? e.checked : e.value.trim()) : undefined;
};
const person = id => (B.boot.people.find(p => p.id === id) || {}).name || '';
const crew = () => B.boot.people.filter(p => ['lead', 'engineer'].includes(p.role) && !p.disabled);
const vehicle = id => B.boot.vehicles.find(v => v.id === id) || {};
const client = id => B.boot.clients.find(c => c.id === id) || {};
const doc = k => B.boot.docs.find(d => d.kind === k) || { content: {} };
const STATUS = {
  scheduled: ['Scheduled', ''],
  in_progress: ['In progress', 'amber'],
  completed: ['Completed', 'ok'],
  cancelled: ['Cancelled', 'bad'],
  failed: ['Could not go ahead', 'bad'],
};
const statusChip = s => `<span class="chip ${(STATUS[s] || ['', ''])[1]}">${esc((STATUS[s] || [s])[0])}</span>`;
const KIND_LABEL = {
  install: 'Install',
  check: 'Check',
  removal: 'Removal',
  install_remove: 'Install and remove',
  other: 'Other',
};
const EVENT_LABEL = {
  accepted: 'Accepted the job',
  vehicle_check: 'Vehicle check',
  ra_signoff: 'Signed the RAMS',
  drawing_ack: 'Confirmed the drawing',
  signin: 'Signed in on site',
  signout: 'Signed out',
  risk_check: 'On-site check',
  loaded: 'Van loaded',
  started: 'Started work',
  installed: 'Layout set up',
  returned: 'Kit counted back',
  note: 'Note',
  change_request: 'Change requested',
  day_complete: 'Day complete',
  job_complete: 'Job finished',
  failed_visit: 'Visit could not go ahead',
  near_miss: 'Near miss',
  checkin: 'Check-in',
  panic: 'PANIC ALARM',
  photo_reason: 'Reason for a missed photo',
  lone_start: 'Lone working started',
  lone_stop: 'Lone working ended',
};

async function reboot() {
  const j = await api('GET', '/boot');
  B.boot = j;
  drawNav();
}
const NAV = [
  [
    'Today',
    [
      ['live', 'Live'],
      ['board', 'Board'],
      ['jobs', 'Jobs'],
      ['requests', 'Job requests', 'requests'],
    ],
  ],
  [
    'Resources',
    [
      ['crew', 'Crew'],
      ['vehicles', 'Vehicles'],
      ['clients', 'Clients'],
    ],
  ],
  [
    'Compliance',
    [
      ['docs', 'Documents'],
      ['rules', 'Photo rules'],
      ['safety', 'Safety'],
      ['alerts', 'Alerts', 'alerts'],
    ],
  ],
  [
    'Business',
    [
      ['time', 'Timesheets'],
      ['costs', 'Costs and invoicing'],
      ['settings', 'Settings'],
    ],
  ],
];
function drawShell() {
  const b = B.boot;
  document.getElementById('app').innerHTML =
    `<div class="top"><a class="brand" href="#live">TM Wer<span>X</span></a><span class="co">${esc(b.me.company)}</span>
<div class="right"><span class="muted">${esc(b.me.name)}</span><a href="/account">Account</a><form method="post" action="/logout" style="margin:0"><button class="link" type="submit">Sign out</button></form></div></div>
<div class="shell"><nav class="side" id="nav"></nav><main id="view"></main></div>`;
  drawNav();
}
function drawNav() {
  const cur = (location.hash.slice(1) || 'live').split('/')[0],
    c = B.boot.counts || {};
  const n = $('#nav');
  if (!n) return;
  n.innerHTML = NAV.map(
    ([g, items]) =>
      `<div class="grp">${esc(g)}</div>` +
      items
        .map(
          ([k, t, cnt]) =>
            `<a href="#${k}" class="${cur === k || (cur === 'job' && k === 'jobs') ? 'on' : ''}">${esc(t)}${cnt && c[cnt] ? `<span class="badge${cnt === 'requests' ? ' amber' : ''}">${c[cnt]}</span>` : ''}</a>`
        )
        .join('')
  ).join('');
}
async function route() {
  clearInterval(refreshTimer);
  const [name, ...args] = (location.hash.slice(1) || 'live').split('/');
  drawNav();
  const v = $('#view');
  const fn = SCREENS[name] || SCREENS.live;
  v.innerHTML = '<p class="muted">Loading…</p>';
  try {
    await fn(v, ...args.map(decodeURIComponent));
  } catch (e) {
    v.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
// photo viewer
document.addEventListener('click', e => {
  const im = e.target.closest('img[data-full]');
  if (im)
    modal(
      `<img class="big-img" src="${esc(im.dataset.full)}" alt=""><p class="muted">${esc(im.dataset.cap || '')}</p><div class="acts"><a class="btn sec" href="${esc(im.dataset.full)}" target="_blank" rel="noopener">Open full size</a><button data-close>Close</button></div>`,
      'wide'
    );
});
