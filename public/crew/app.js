/* TM WerX crew app. Works without signal: the day's jobs, drawings and documents are kept on the phone, and every
   check, signature and photo is saved here first and sent when there is signal (see outbox.js). */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const uuid = () => crypto.randomUUID();
const S = { data: null, outbox: [], photos: [], seen: {}, signedOut: false, installEvt: null, notified: new Set() };
const KIND = {
  install: 'Install',
  check: 'Check',
  removal: 'Removal',
  install_remove: 'Install and remove',
  other: 'Visit',
};
const LABEL = {
  accepted: 'Accepted',
  vehicle_check: 'Vehicle check',
  ra_signoff: 'RAMS signed',
  drawing_ack: 'Drawing confirmed',
  signin: 'Signed in',
  signout: 'Signed out',
  risk_check: 'Site check',
  loaded: 'Van loaded',
  started: 'Work started',
  installed: 'Layout set up',
  returned: 'Kit counted back',
  note: 'Note',
  change_request: 'Change request',
  day_complete: 'Day complete',
  job_complete: 'Job finished',
  failed_visit: 'Could not go ahead',
  near_miss: 'Near miss',
  checkin: 'Checked in',
  panic: 'Panic alarm',
  photo_reason: 'Photo reason',
  lone_start: 'Lone working on',
  lone_stop: 'Lone working off',
};
const TEAM = new Set([
  'vehicle_check',
  'loaded',
  'risk_check',
  'started',
  'installed',
  'returned',
  'day_complete',
  'job_complete',
  'failed_visit',
]);
const TRIGGERS = {
  arrival: ['signin'],
  before_work: ['started'],
  setup: ['installed'],
  removal: ['returned'],
  site_clear: ['day_complete', 'job_complete'],
};
const ENDS = ['day_complete', 'job_complete', 'failed_visit'];

/* ---------- small helpers ---------- */
const today = () => ymd(new Date());
const ymd = d => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
const fmtDate = d =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtT = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ago = t => {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1
    ? 'just now'
    : m < 60
      ? m + ' min'
      : m < 1440
        ? Math.round(m / 60) + ' h'
        : Math.round(m / 1440) + ' days';
};
function toast(m, ms = 3000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = m;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function sheet(html) {
  const d = document.createElement('div');
  d.className = 'sheet';
  d.innerHTML = `<div>${html}</div>`;
  document.body.append(d);
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.remove();
  });
  return d;
}
const sheetOpen = () => !!$('.sheet');
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function metres(a, b) {
  const R = 6371000,
    r = x => (x * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function position(timeout = 12000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => res(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    );
  });
}
// a UK wall-clock time on a date (BST or GMT), as the server works it out
function londonTime(date, hhmm) {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const shown = new Date(guess).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const [h, m] = shown.split(':').map(Number),
    [H, M] = hhmm.split(':').map(Number);
  return guess - ((h * 60 + m - (H * 60 + M) + 1440) % 1440) * 60e3;
}

/* ---------- data on the phone ---------- */
const me = () => (S.data ? S.data.me : {});
const jobOf = id => (S.data.jobs || []).find(j => j.id === id);
const visitOf = id => (S.data.visits || []).find(v => v.id === id);
const drawingOf = id => (S.data.drawings || []).find(d => d.id === id);
function allEvents() {
  const m = new Map();
  for (const e of S.data.events || []) m.set(e.id, e);
  for (const e of S.outbox) if (!m.has(e.id)) m.set(e.id, Object.assign({ user_name: me().name, local: true }, e));
  return [...m.values()].sort((a, b) => (a.client_time || a.server_time) - (b.client_time || b.server_time));
}
const visitEvents = v => allEvents().filter(e => e.visit_id === v.id);
const t0 = e => e.client_time || e.server_time;
function stepDone(v, kind, extra) {
  return visitEvents(v)
    .filter(e => e.kind === kind && (TEAM.has(kind) || e.user_id === me().id) && (!extra || extra(e)))
    .pop();
}
const firstOf = (v, kinds) => visitEvents(v).find(e => kinds.includes(e.kind));
function allPhotos() {
  const m = new Map();
  for (const p of S.data.photos || []) m.set(p.id, p);
  for (const p of S.photos) if (!m.has(p.id)) m.set(p.id, Object.assign({ local: true }, p));
  return [...m.values()];
}
// the photos this visit owes: the server's list, plus any the phone can work out before the server has heard
function visitTasks(v) {
  const job = jobOf(v.job_id);
  if (!job) return [];
  const map = new Map((S.data.tasks || []).filter(t => t.visit_id === v.id).map(t => [t.id, Object.assign({}, t)]));
  const byRule = new Set([...map.values()].map(t => t.rule_id));
  const add = (r, due) => {
    const id = `${v.id}:${r.id}:${Math.round(due)}`;
    if (!map.has(id))
      map.set(id, {
        id,
        visit_id: v.id,
        rule_id: r.id,
        label: r.label,
        count: r.count || 1,
        due_at: due,
        grace_until: due + (r.grace_mins ?? 10) * 60e3,
        status: 'due',
        local: true,
      });
  };
  const start = firstOf(v, ['started']),
    end = firstOf(v, ENDS);
  for (const r of job.rules || []) {
    if (r.trig === 'event') {
      const e = firstOf(v, TRIGGERS[r.event] || []);
      if (e && !byRule.has(r.id)) add(r, t0(e));
    } else if (start && r.trig === 'repeat' && r.every_mins >= 15) {
      for (let t = t0(start) + r.every_mins * 60e3; t <= t0(start) + 16 * 3600e3; t += r.every_mins * 60e3) add(r, t);
    } else if (start && r.trig === 'daily' && r.at_time) {
      const t = londonTime(v.date, r.at_time);
      if (t > t0(start)) add(r, t);
    }
  }
  const timed = new Set((job.rules || []).filter(r => r.trig !== 'event').map(r => r.id));
  const photos = allPhotos();
  const reasons = visitEvents(v).filter(e => e.kind === 'photo_reason');
  return [...map.values()]
    .filter(t => !(end && timed.has(t.rule_id) && t.due_at > t0(end) && t.status === 'due'))
    .map(t => {
      const n = photos.filter(p => p.task_id === t.id).length;
      const reason = reasons.find(e => e.data && e.data.task_id === t.id);
      const state =
        t.status === 'done' || n >= t.count
          ? 'done'
          : t.status === 'missed'
            ? 'missed'
            : t.due_at > Date.now()
              ? 'later'
              : t.grace_until < Date.now()
                ? 'overdue'
                : 'due';
      return Object.assign(t, { taken: n, state, reason: reason ? reason.data.reason : t.reason });
    })
    .sort((a, b) => a.due_at - b.due_at);
}
const owed = v => visitTasks(v).filter(t => ['due', 'overdue'].includes(t.state) && !t.reason);

async function refreshLocal() {
  const owner = await TMDB.get('kv', 'owner');
  S.outbox = (await TMDB.all('outbox')).filter(e => !owner || e.user_id === owner);
  S.photos = (await TMDB.photoMeta()).filter(p => !owner || p.user_id === owner);
  drawSendbar();
}
function drawSendbar() {
  const b = $('#sendbar');
  const ev = S.outbox.filter(e => !e.error),
    ph = S.photos.filter(p => !p.error),
    bad = S.outbox.filter(e => e.error).length + S.photos.filter(p => p.error).length;
  const n = $('#net');
  n.textContent = navigator.onLine ? '' : 'No signal';
  n.className = 'net' + (navigator.onLine ? '' : ' off');
  // on the sign-in screen itself the bar would only repeat it
  if (S.signedOut && !S.data && !ev.length && !ph.length) return (b.hidden = true);
  if (S.signedOut) {
    b.hidden = false;
    b.className = 'sendbar bad';
    b.innerHTML = `<span>Signed out. ${ev.length + ph.length ? 'Your records are safe on this phone: sign in to send them.' : ''}</span><button class="sm" id="sbIn">Sign in</button>`;
    $('#sbIn').onclick = () => drawLogin();
    return;
  }
  if (!ev.length && !ph.length && !bad) return (b.hidden = true);
  const oldest = Math.min(...ev.map(e => e.queued_at || e.client_time), ...ph.map(p => p.queued_at || p.taken_at));
  const late = S.data && oldest < Date.now() - (S.data.settings.pending_limit_hours || 2) * 3600e3;
  b.hidden = false;
  b.className = 'sendbar' + (late || bad ? ' bad' : '');
  b.innerHTML = `<span>${ev.length + ph.length ? `${ev.length ? ev.length + ' record' + (ev.length > 1 ? 's' : '') : ''}${ev.length && ph.length ? ' and ' : ''}${ph.length ? ph.length + ' photo' + (ph.length > 1 ? 's' : '') : ''} waiting to send${isFinite(oldest) ? ' (' + ago(oldest) + ')' : ''}.${late ? ' Find signal soon.' : ''}` : ''}${bad ? ` ${bad} could not be sent: see More.` : ''}</span><button class="sm sec" id="sbGo">Send now</button>`;
  $('#sbGo').onclick = () => flushNow(true);
}
let flushTimer = null;
async function flushNow(loud) {
  if (!navigator.onLine)
    return loud && toast('No signal. Everything is saved on the phone and will send when you have signal.');
  const r = await TMDB.flush();
  if (r.signedOut) S.signedOut = true; // only the server saying so; a good sync clears it
  await refreshLocal();
  if (loud)
    toast(
      r.signedOut
        ? 'Sign in again to send.'
        : r.offline
          ? 'Could not reach the office yet. It will keep trying.'
          : 'All sent.'
    );
  if (!r.offline && !r.signedOut && (r.sent || r.photos)) sync(true);
}
function kick() {
  navigator.serviceWorker &&
    navigator.serviceWorker.ready.then(reg => reg.sync && reg.sync.register('flush')).catch(() => {});
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushNow(false), 300);
}
// save a record on the phone, then try to send it
async function record(kind, v, o = {}) {
  const pos = o.pos !== undefined ? o.pos : await position(8000);
  const e = {
    id: uuid(),
    kind,
    job_id: v ? v.job_id : o.job_id || null,
    visit_id: v ? v.id : null,
    vehicle_id: o.vehicle_id || null,
    data: o.data || {},
    signature: o.signature || null,
    lat: pos ? pos.lat : null,
    lng: pos ? pos.lng : null,
    acc: pos ? pos.acc : null,
    client_time: Date.now(),
    user_id: me().id,
    queued_at: Date.now(),
  };
  await TMDB.put('outbox', e);
  await refreshLocal();
  kick();
  return e;
}
// each sync is numbered: an answer that comes back after a newer sync started (say, the check made as the app
// opened, arriving after the person has signed in) is out of date and ignored
let syncGen = 0;
async function sync(quiet) {
  if (!navigator.onLine) return;
  const gen = ++syncGen;
  try {
    await TMDB.flush();
    const r = await fetch('/api/crew/sync', { credentials: 'same-origin' });
    if (gen !== syncGen) return;
    if (r.status === 401) {
      // signed out (password reset, signed in on another phone, or the session ran out): this person's jobs,
      // drawings and photos come off the phone. Anything not yet sent stays, and sends when they sign in again.
      if (S.data) await forgetPerson();
      S.signedOut = true;
      await refreshLocal();
      if (!$('#un')) drawLogin(); // already showing: don't wipe what they are typing
      return;
    }
    if (!r.ok) return;
    const j = await r.json();
    if (gen !== syncGen) return;
    const owner = await TMDB.get('kv', 'owner');
    if (owner && owner !== j.me.id) {
      // a different person signed in on this phone: the last person's unsent work stays on the phone, theirs, and
      // sends when they next sign in here (records only ever send for the person signed in)
      S.seen = {};
      await TMDB.put('kv', {}, 'seen');
    }
    await TMDB.put('kv', j.me.id, 'owner');
    S.signedOut = false;
    S.data = j;
    await TMDB.put('kv', j, 'sync');
    await refreshLocal();
    prefetchFiles();
    if (!sheetOpen()) route();
  } catch (e) {
    /* no signal: carry on with what the phone has */
  }
}
// keep this week's drawings and the office's photos on the phone (the service worker stores them)
function prefetchFiles() {
  const from = ymd(new Date(Date.now() - 864e5)),
    to = ymd(new Date(Date.now() + 7 * 864e5));
  const ids = new Set(
    S.data.visits
      .filter(v => v.date >= from && v.date <= to)
      .map(v => v.drawing_id)
      .filter(Boolean)
  );
  const jobs = new Set(S.data.visits.filter(v => v.date >= from && v.date <= to).map(v => v.job_id));
  for (const id of ids) fetch('/api/crew/file/drawing/' + id, { credentials: 'same-origin' }).catch(() => {});
  for (const p of S.data.photos.filter(p => p.source === 'office' && jobs.has(p.job_id)))
    fetch('/api/crew/file/photo/' + p.id, { credentials: 'same-origin' }).catch(() => {});
}

// a shared phone: the next person must not see this person's jobs, or open their drawings and photos offline
async function forgetPerson() {
  await TMDB.del('kv', 'sync');
  await TMDB.put('kv', {}, 'seen');
  if (window.caches) await caches.delete('tmwerx-files-v1').catch(() => {});
  S.seen = {};
  S.data = null;
}

/* ---------- photos: camera, shrink, save on the phone ---------- */
function pick(gallery) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    if (!gallery) i.capture = 'environment';
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  } catch (e) {
    return file.size < 12e6 ? file : null;
  }
}
async function savePhoto(file, meta, source) {
  const blob = await shrink(file);
  if (!blob) return toast('That photo could not be read. Try again.');
  const pos = await position(6000);
  const id = uuid();
  const m = Object.assign(
    { user_id: me().id, source, taken_at: source === 'gallery' ? file.lastModified || Date.now() : Date.now() },
    meta,
    pos ? { lat: pos.lat, lng: pos.lng, acc: pos.acc } : {}
  );
  await TMDB.put('photos', { id, meta: m, blob, queued_at: Date.now() });
  await refreshLocal();
  kick();
  return id;
}
// take a set of photos with one tap each; resolves with how many were saved
function photoSheet(title, meta, count = 1) {
  return new Promise(res => {
    let n = 0;
    const gal = S.data.settings.allow_gallery;
    const d = sheet(
      `<h2>${esc(title)}</h2><p class="muted" id="pc"></p><div class="btns"><button id="cam">Take photo</button>${gal ? '<button class="sec" id="gal">From gallery</button>' : ''}<button class="sec" id="fin">Done</button></div>`
    );
    const upd = () =>
      ($('#pc', d).textContent = count > 1 ? `${n} of ${count} taken` : n ? 'Photo saved. Take another, or Done.' : '');
    upd();
    const go = async gallery => {
      const f = await pick(gallery);
      if (!f) return;
      if (await savePhoto(f, meta, gallery ? 'gallery' : 'camera')) n++;
      upd();
      if (count > 1 && n >= count) d.remove(), res(n);
    };
    $('#cam', d).onclick = () => go(false);
    if (gal) $('#gal', d).onclick = () => go(true);
    $('#fin', d).onclick = () => (d.remove(), res(n));
  });
}

/* ---------- signatures ---------- */
function sigPad(c) {
  const ctx = c.getContext('2d');
  const fit = () => {
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  };
  fit();
  let drawing = false,
    marks = 0;
  const p = e => {
    const r = c.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  c.addEventListener('pointerdown', e => {
    drawing = true;
    c.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...p(e));
  });
  c.addEventListener('pointermove', e => {
    if (!drawing) return;
    ctx.lineTo(...p(e));
    ctx.stroke();
    marks++;
  });
  c.addEventListener('pointerup', () => (drawing = false));
  return { empty: () => marks < 8, data: () => c.toDataURL('image/png'), clear: () => ((marks = 0), fit()) };
}
const sigHtml = (label = 'Sign below') =>
  `<label>${label}</label><canvas class="sig" id="sig"></canvas><button class="sm sec" id="sigClr" type="button" style="margin-top:6px">Clear</button>`;
function wireSig(d) {
  const s = sigPad($('#sig', d));
  $('#sigClr', d).onclick = () => s.clear();
  return s;
}
const seg = (name, opts, cur) =>
  `<div class="seg">${opts.map(([v, t, cls]) => `<label><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''} class="${cls || ''}"><span>${t}</span></label>`).join('')}</div>`;
const segVal = (d, name) => ($(`input[name="${name}"]:checked`, d) || {}).value;

/* ---------- sign in ---------- */
function drawLogin() {
  $('#v').innerHTML =
    `<div class="card" style="margin-top:20px"><h1>Sign in</h1><p class="muted">Use the username and password your office gave you.</p>
<label>Username</label><input type="text" id="un" autocomplete="username" autocapitalize="none" spellcheck="false"><label>Password</label><input type="password" id="pw" autocomplete="current-password">
<div class="btns"><button id="go">Sign in</button></div><p id="err" class="muted"></p></div>${S.outbox.length + S.photos.length ? '<div class="msg">Your unsent records and photos are safe on this phone. They send once you sign in.</div>' : ''}
<p class="muted">Office staff: sign in at <a href="/login">${esc(location.host)}/login</a>.</p>`;
  const go = async () => {
    $('#go').disabled = true;
    try {
      const r = await fetch('/api/crew/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('#un').value, password: $('#pw').value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || 'Could not sign in.');
      S.signedOut = false;
      await sync(true);
      const seenGuide = await TMDB.get('kv', 'guide');
      location.hash = !standalone() && !seenGuide ? 'guide' : '';
      route();
    } catch (e) {
      $('#err').textContent = navigator.onLine ? e.message : 'You need signal to sign in the first time.';
      $('#go').disabled = false;
    }
  };
  $('#go').onclick = go;
  $('#pw').onkeydown = e => e.key === 'Enter' && go();
}

/* ---------- first sign-in: put the app on the home screen, switch on alerts ---------- */
function drawGuide() {
  const ios = isIOS();
  const steps = ios
    ? `<ol><li>Open this page in <b>Safari</b> (not Chrome or another app's browser).</li><li>Tap the <span class="k">Share</span> button (the square with an arrow, at the bottom or top of the screen).</li><li>Scroll down and tap <span class="k">Add to Home Screen</span>, then <span class="k">Add</span>.</li><li>Close Safari and open <b>TM WerX</b> from your home screen. Sign in once more there.</li><li>Tap <b>Switch on alerts</b> when the app asks, and allow notifications.</li></ol>
<p class="muted">On iPhone, alerts from the office only work in the app opened from the home screen.</p>`
    : `<ol><li>${S.installEvt ? 'Tap <b>Install</b> below.' : 'Tap the <span class="k">⋮</span> menu at the top right of Chrome.'}</li>${S.installEvt ? '' : '<li>Tap <span class="k">Install app</span> or <span class="k">Add to Home screen</span>, then <span class="k">Install</span>.</li>'}<li>Open <b>TM WerX</b> from your home screen.</li><li>Tap <b>Switch on alerts</b> and allow notifications.</li></ol>`;
  $('#v').innerHTML =
    `<div class="card guide"><h1>Put TM WerX on your home screen</h1><p>It works like an app: it opens full screen, keeps your jobs and drawings for when there's no signal, and the office can alert you.</p>${steps}
<div class="btns">${S.installEvt ? '<button id="inst">Install</button>' : ''}${!ios || standalone() ? '<button class="sec" id="alerts">Switch on alerts</button>' : ''}<button class="sec" id="skip">${standalone() ? 'Done' : 'Not now'}</button></div></div>`;
  if ($('#inst'))
    $('#inst').onclick = async () => {
      S.installEvt.prompt();
      await S.installEvt.userChoice.catch(() => null);
      S.installEvt = null;
      drawGuide();
    };
  if ($('#alerts')) $('#alerts').onclick = enablePush;
  $('#skip').onclick = async () => {
    await TMDB.put('kv', 1, 'guide');
    location.hash = '';
  };
}
async function enablePush() {
  try {
    if (!('Notification' in window) || !navigator.serviceWorker)
      throw new Error(
        isIOS()
          ? 'Add TM WerX to your home screen first, then switch on alerts from there.'
          : 'This browser cannot show alerts.'
      );
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Notifications are blocked. Allow them for TM WerX in your phone settings.');
    const reg = await navigator.serviceWorker.ready;
    if (!S.data.vapid) throw new Error('Alerts are not set up on the server yet. Ask your office.');
    const key = Uint8Array.from(
      atob(S.data.vapid.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (S.data.vapid.length % 4)) % 4)),
      c => c.charCodeAt(0)
    );
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const r = await fetch('/api/crew/push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    if (!r.ok) throw new Error('Could not register this phone. Try again with signal.');
    toast('Alerts are on.');
    reportState();
  } catch (e) {
    toast(e.message, 5000);
  }
}
function reportState() {
  if (!navigator.onLine || S.signedOut) return;
  const push = 'Notification' in window ? Notification.permission === 'granted' : null;
  fetch('/api/crew/state', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ standalone: standalone(), push }),
  }).catch(() => {});
}

/* ---------- home: my visits ---------- */
function visitCard(v) {
  const j = jobOf(v.job_id);
  if (!j) return '';
  const seen = S.seen[j.id];
  const due = owed(v).length;
  const st = j.removed
    ? '<span class="chip bad">Removed: do not attend</span>'
    : seen == null
      ? '<span class="chip amber">New</span>'
      : seen < j.version
        ? '<span class="chip amber">Updated</span>'
        : '';
  return `<a class="card job ${v.date === today() || v.status === 'in_progress' ? 'hl' : ''}" href="#v/${esc(v.id)}"><b>${esc(j.number)}</b> ${st} ${v.status === 'in_progress' ? '<span class="chip warn">Under way</span>' : v.status === 'completed' ? '<span class="chip ok">Done</span>' : v.status === 'cancelled' ? '<span class="chip bad">Cancelled</span>' : ''}
<div>${esc(j.address || j.title || '')}${j.postcode ? ', ' + esc(j.postcode) : ''}</div><div class="muted">${esc(fmtDate(v.date))}${v.start_time ? ' · ' + esc(v.start_time) : ''} · ${esc(KIND[v.kind] || v.kind)}${j.tm_type ? ' · ' + esc(j.tm_type) : ''}</div>
${due ? `<div style="margin-top:6px"><span class="chip bad">${due} photo${due > 1 ? 's' : ''} due</span></div>` : ''}</a>`;
}
function drawHome() {
  const t = today();
  const vs = S.data.visits;
  const now = vs.filter(v => v.date === t || v.status === 'in_progress');
  const next = vs.filter(v => v.date > t && v.status !== 'in_progress');
  const past = vs
    .filter(v => v.date < t && v.status !== 'in_progress')
    .reverse()
    .slice(0, 10);
  $('#v').innerHTML =
    `<h1>Hello ${esc((me().name || '').split(' ')[0])}</h1><p class="muted">${esc(me().company || '')}</p>
${!standalone() ? '<a class="msg" style="display:block;text-decoration:none;color:inherit" href="#guide">Put TM WerX on your home screen so it works without signal. <b>How</b></a>' : ''}
<h2>Today</h2>${now.map(visitCard).join('') || '<div class="card"><p class="muted">Nothing for you today.</p></div>'}
${next.length ? `<h2>Coming up</h2>${next.map(visitCard).join('')}` : ''}${past.length ? `<h2>Recent</h2>${past.map(visitCard).join('')}` : ''}
<div class="btns two" style="margin-top:20px"><button class="sec" id="refresh">Refresh</button><a class="btn sec" href="#more">More</a></div>`;
  $('#refresh').onclick = async () =>
    navigator.onLine ? (await sync(true), toast('Up to date')) : toast('No signal. Showing what the phone has.');
}

/* ---------- one visit: the steps ---------- */
function drawVisit(id) {
  const v = visitOf(id);
  if (!v) return (location.hash = '');
  const j = jobOf(v.job_id);
  if (!j) return (location.hash = '');
  if (S.seen[j.id] !== j.version) (S.seen[j.id] = j.version), TMDB.put('kv', S.seen, 'seen');
  const s = S.data.settings,
    d = drawingOf(v.drawing_id),
    docs = S.data.docs || {};
  const did = k => stepDone(v, k);
  const ack = d ? stepDone(v, 'drawing_ack', e => e.data && e.data.drawing_id === d.id) : true;
  const ended = firstOf(v, ENDS);
  const signedIn = (() => {
    const mine = visitEvents(v).filter(e => e.user_id === me().id && ['signin', 'signout'].includes(e.kind));
    return mine.length && mine[mine.length - 1].kind === 'signin';
  })();
  const lone = (() => {
    const l = allEvents()
      .filter(e => e.user_id === me().id && ['lone_start', 'lone_stop', 'signout', ...ENDS].includes(e.kind))
      .pop();
    return l && l.kind === 'lone_start' ? l : null;
  })();
  const lastCheck = lone
    ? allEvents()
        .filter(e => e.user_id === me().id && e.kind === 'checkin' && t0(e) > t0(lone))
        .pop()
    : null;
  const tasks = visitTasks(v);
  const due = tasks.filter(t => ['due', 'overdue'].includes(t.state) && !t.reason);
  const setupKinds = ['install', 'install_remove', 'other'];
  const step = (key, title, sub, done, btn, enabled = true) =>
    `<div class="step ${done ? 'done' : ''}"><div class="ic">${done ? '✓' : '·'}</div><div class="t"><b>${title}</b><span class="muted">${done ? `${esc(done.user_name || '')} ${fmtT(t0(done))}${done.local ? ' · not sent yet' : ''}` : sub}</span></div>${!done || key === 'vehicle_check' ? `<button class="${done ? 'sec' : ''}" data-step="${key}" ${enabled ? '' : 'disabled'}>${done && key === 'vehicle_check' ? 'Another' : btn}</button>` : ''}</div>`;
  const missingStart = (s.start_requires || []).filter(k => (k === 'drawing_ack' ? !ack : !did(k)));
  $('#v').innerHTML = `<a class="back" href="#">‹ All jobs</a><h1>${esc(j.number)}</h1>
${j.removed ? '<div class="msg bad"><b>This job has been removed.</b> Do not attend unless the office tells you to.</div>' : ''}${v.status === 'cancelled' ? '<div class="msg bad">This visit is cancelled.</div>' : ''}
<div class="card"><div><b>${esc(j.address || j.title || '')}</b>${j.town ? ', ' + esc(j.town) : ''}${j.postcode ? ', ' + esc(j.postcode) : ''}</div>
<div class="muted">${esc(fmtDate(v.date))}${v.start_time ? ' · ' + esc(v.start_time) : ''}${v.end_time ? '–' + esc(v.end_time) : ''} · ${esc(KIND[v.kind] || v.kind)}${j.tm_type ? ' · ' + esc(j.tm_type) : ''}</div>
<div class="muted">${v.crew.map(c => esc(c.name) + (c.lead ? ' (lead)' : '')).join(', ')}${v.vehicle_ids.length ? ' · ' + v.vehicle_ids.map(x => esc((S.data.vehicles.find(z => z.id === x) || {}).reg || '')).join(', ') : ''}</div>
<div class="btns two">${j.lat != null ? `<a class="btn sec" href="https://www.google.com/maps/dir/?api=1&destination=${j.lat},${j.lng}" target="_blank" rel="noopener">Directions</a>` : `<span></span>`}<a class="btn sec" href="#info/${esc(v.id)}">Job details</a></div></div>
${d && !ack ? `<div class="msg warn"><b>${stepDone(v, 'drawing_ack') ? 'New drawing revision.' : 'Check the drawing.'}</b> Rev ${esc(d.rev)}: open it and confirm before you carry on.</div>` : ''}
${due.length ? `<div class="card bad"><h2>Photos due now</h2>${due.map(t => `<div class="step"><div class="t"><b>${esc(t.label)}</b><span class="muted">${t.taken}/${t.count} · due ${fmtT(t.due_at)}${t.state === 'overdue' ? ' · overdue' : ''}</span></div><button data-task="${esc(t.id)}">Take</button></div>`).join('')}</div>` : ''}
${lone ? `<div class="card hl"><h2>Lone working</h2><p>Check in every ${esc(lone.data.every_mins)} minutes. Next by <b>${fmtT(t0(lastCheck || lone) + lone.data.every_mins * 60e3)}</b>.</p><div class="btns two"><button id="chk">Check in: I'm OK</button><button class="sec" id="loneOff">Stop</button></div></div>` : ''}
<div class="card"><h2>Before you go</h2>
${step('accepted', 'Accept the job', 'Tell the office you have it', did('accepted') && stepDone(v, 'accepted'), 'Accept')}
${step('vehicle_check', 'Vehicle check', 'Daily walk-round', did('vehicle_check'), 'Check')}
${step('loaded', 'Load the van', d && d.equipment.length ? `${d.equipment.length} items on the list` : 'Count what you take', did('loaded'), 'Load')}
${step('ra_signoff', 'Read and sign the RAMS', `${docs.ra && !docs.ra.reviewed ? 'Draft wording · ' : ''}Risk assessment and method`, did('ra_signoff'), 'Read')}
${d ? step('drawing_ack', 'Check the drawing', `Rev ${esc(d.rev)}${d.drawing_no ? ' · ' + esc(d.drawing_no) : ''}`, ack === true ? null : ack, 'Open') : ''}</div>
<div class="card"><h2>On site</h2>
${step('signin', 'Sign in on site', 'Records when and where you arrived', signedIn ? stepDone(v, 'signin') : null, 'Sign in')}
${step('risk_check', 'Site check', 'Does the site match the plan?', did('risk_check'), 'Check')}
${step('started', 'Start work', missingStart.length ? 'First: ' + missingStart.map(k => LABEL[k].toLowerCase()).join(', ') : 'Ready', did('started'), 'Start', !missingStart.length)}
${setupKinds.includes(v.kind) ? step('installed', 'Layout set up', 'As on the drawing', did('installed'), 'Done', !!did('started')) : ''}
<div class="btns two"><button class="sec" data-x="note">Note or photo</button><button class="sec" data-x="change_request">Site differs</button><button class="sec" data-x="near_miss">Near miss</button>${lone ? '' : '<button class="sec" data-x="lone">Lone working</button>'}</div></div>
<div class="card"><h2>Finishing</h2>
${step('returned', 'Count the kit back', 'What comes back on the van', did('returned'), 'Count')}
${step('complete', 'Finish the day', 'Site left safe, notes', ended, 'Finish', !!did('started') || !!did('signin'))}
${step('signout', 'Sign out', 'End of your time on site', signedIn ? null : stepDone(v, 'signout'), 'Sign out', signedIn)}
${ended ? '' : '<div class="btns"><button class="sec" data-x="failed">Could not go ahead</button></div>'}</div>
${tasks.length ? `<div class="card"><h2>Photo schedule</h2><table>${tasks.map(t => `<tr><td>${fmtT(t.due_at)}</td><td>${esc(t.label)}</td><td>${t.state === 'done' ? '<span class="chip ok">Taken</span>' : t.state === 'missed' ? '<span class="chip bad">Missed</span>' : t.reason ? '<span class="chip">Reason given</span>' : t.state === 'later' ? '<span class="chip">Later</span>' : `<button class="sm" data-task="${esc(t.id)}">Take</button>`}${['overdue', 'missed'].includes(t.state) && !t.reason ? ` <button class="sm sec" data-why="${esc(t.id)}">Can't</button>` : ''}</td></tr>`).join('')}</table></div>` : ''}
<div class="card"><h2>Records</h2>${
    visitEvents(v)
      .map(
        e =>
          `<div class="muted">${fmtT(t0(e))} · ${esc(LABEL[e.kind] || e.kind)} · ${esc(e.user_name || '')}${e.local ? ' · <span class="chip warn">not sent</span>' : ''}</div>`
      )
      .join('') || '<p class="muted">None yet.</p>'
  }</div>
<button class="panic" id="panic">⚠ Panic</button>`;
  const V = $('#v');
  $$('[data-step]', V).forEach(b => (b.onclick = () => STEPS[b.dataset.step](v, j, d)));
  $$('[data-x]', V).forEach(b => (b.onclick = () => EXTRAS[b.dataset.x](v, j)));
  $$('[data-task]', V).forEach(
    b =>
      (b.onclick = async () => {
        const t = tasks.find(x => x.id === b.dataset.task);
        await photoSheet(
          t.label,
          { job_id: v.job_id, visit_id: v.id, task_id: t.id, category: 'Scheduled', caption: t.label },
          Math.max(1, t.count - t.taken)
        );
        route();
      })
  );
  $$('[data-why]', V).forEach(
    b =>
      (b.onclick = () => {
        const dd = sheet(
          `<h2>Why couldn't you take it?</h2><textarea id="r" placeholder="e.g. Called away to an incident"></textarea><div class="btns"><button id="ok">Save</button><button class="sec" data-close>Cancel</button></div>`
        );
        $('#ok', dd).onclick = async () => {
          if (!$('#r', dd).value.trim()) return toast('Give a reason.');
          await record('photo_reason', v, { data: { task_id: b.dataset.why, reason: $('#r', dd).value.trim() } });
          dd.remove();
          route();
        };
      })
  );
  if ($('#chk')) $('#chk').onclick = async () => (await record('checkin', v), toast('Checked in'), route());
  if ($('#loneOff')) $('#loneOff').onclick = async () => (await record('lone_stop', v), route());
  $('#panic').onclick = () => panic(v);
}

function drawInfo(id) {
  const v = visitOf(id),
    j = v && jobOf(v.job_id);
  if (!j) return (location.hash = '');
  const d = drawingOf(v.drawing_id);
  const office = S.data.photos.filter(p => p.job_id === j.id && p.source === 'office');
  const row = (k, x) => (x ? `<tr><th>${k}</th><td>${x}</td></tr>` : '');
  $('#v').innerHTML =
    `<a class="back" href="#v/${esc(v.id)}">‹ Back</a><h1>${esc(j.number)}</h1><div class="card"><table>
${row('Site', esc([j.address, j.town, j.postcode].filter(Boolean).join(', ')))}${row('Client', esc(j.client))}${row('Client ref', esc(j.client_ref))}${row('Type', esc(j.tm_type))}${row('Permit', esc(j.permit_ref))}
${row('Hours', esc(j.hours))}${row('Site contact', esc(j.site_contact))}${row('USRN', esc(j.usrn))}${row('what3words', j.w3w ? `<a href="https://what3words.com/${esc(j.w3w.replace(/^\/+/, ''))}" target="_blank" rel="noopener">${esc(j.w3w)}</a>` : '')}${row('Nearest A&amp;E', esc(j.nearest_ae))}</table></div>
${j.instructions ? `<div class="card"><h2>Instructions</h2><p style="white-space:pre-wrap">${esc(j.instructions)}</p></div>` : ''}${v.notes ? `<div class="card"><h2>For this visit</h2><p style="white-space:pre-wrap">${esc(v.notes)}</p></div>` : ''}
${j.hazards.length ? `<div class="card"><h2>Site hazards</h2>${j.hazards.map(h => `<div>• ${esc(h)}</div>`).join('')}</div>` : ''}
${d ? `<div class="card"><h2>Drawing rev ${esc(d.rev)}</h2><a class="btn sec wide" href="/api/crew/file/drawing/${esc(d.id)}" target="_blank">Open drawing</a>${d.equipment.length ? `<h3>Equipment</h3><table>${d.equipment.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)}</td></tr>`).join('')}</table>` : ''}</div>` : ''}
${office.length ? `<div class="card"><h2>From the office</h2><div class="photos">${office.map(p => `<a href="/api/crew/file/photo/${esc(p.id)}" target="_blank"><img src="/api/crew/file/photo/${esc(p.id)}" alt=""></a>`).join('')}</div></div>` : ''}
<div class="card"><h2>Crew</h2>${v.crew.map(c => `<div>${esc(c.name)}${c.lead ? ' (lead)' : ''} ${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</div>`).join('')}</div>`;
}

/* ---------- the steps ---------- */
const STEPS = {
  async accepted(v) {
    await record('accepted', v);
    toast('Accepted');
    route();
  },
  vehicle_check(v) {
    const items = ((S.data.docs.vehicle_checks || {}).content || {}).items || [];
    const vans = S.data.vehicles;
    const d =
      sheet(`<h2>Vehicle check</h2><label>Vehicle</label><select id="veh">${vans.map(x => `<option value="${esc(x.id)}" ${v.vehicle_ids[0] === x.id ? 'selected' : ''}>${esc(x.reg)}${x.unsafe ? ' (reported not safe)' : ''}</option>`).join('')}</select>
<label>Mileage</label><input type="number" id="miles" inputmode="numeric">${items
        .map(
          (it, i) =>
            `<div class="vc"><div>${esc(it)}</div>${seg(
              'i' + i,
              [
                ['ok', 'OK'],
                ['defect', 'Defect', 'bad'],
                ['na', 'N/A'],
              ],
              'ok'
            )}<input type="text" class="note" data-i="${i}" placeholder="What's wrong?" hidden style="margin-top:6px"></div>`
        )
        .join('')}
<label>Is the vehicle safe to use?</label>${seg(
        'safe',
        [
          ['yes', 'Yes, safe'],
          ['no', 'No, NOT safe', 'bad'],
        ],
        'yes'
      )}<label>Notes</label><textarea id="vn"></textarea>${sigHtml()}
<div class="btns"><button id="ok">Save check</button><button class="sec" data-close>Cancel</button></div>`);
    d.addEventListener('change', e => {
      const m = /^i(\d+)$/.exec(e.target.name || '');
      if (m) $(`.note[data-i="${m[1]}"]`, d).hidden = e.target.value !== 'defect';
    });
    const sig = wireSig(d);
    $('#ok', d).onclick = async () => {
      if (sig.empty()) return toast('Sign the check.');
      const res = items.map((it, i) => ({
        item: it,
        result: segVal(d, 'i' + i),
        note: $(`.note[data-i="${i}"]`, d).value.trim() || undefined,
      }));
      const safe = segVal(d, 'safe') === 'yes';
      const vid = $('#veh', d).value;
      const e = await record('vehicle_check', v, {
        vehicle_id: vid,
        signature: sig.data(),
        data: {
          items: res,
          safe,
          mileage: $('#miles', d).value || undefined,
          notes: $('#vn', d).value.trim() || undefined,
        },
      });
      d.remove();
      if (res.some(r => r.result === 'defect'))
        await photoSheet('Photo of the defect', {
          vehicle_id: vid,
          event_id: e.id,
          job_id: v.job_id,
          visit_id: v.id,
          category: 'Defect',
        });
      if (!safe)
        alertBox('Vehicle reported not safe', 'The office has been told. Do not drive it until they clear it.');
      route();
    };
  },
  loaded(v, j, dr) {
    const pct = S.data.settings.spares_pct || 0;
    const eq = dr ? dr.equipment : [];
    const must = S.data.settings.mandatory_items || [];
    const d =
      sheet(`<h2>Load the van</h2>${eq.length ? `<p class="muted">From the drawing${pct ? `, with ${pct}% spares added` : ''}. Change the numbers to what you actually load.</p>` : '<p class="muted">No list on the drawing: add what you load.</p>'}
<table id="ld">${eq.map(i => loadRow(i, Math.round(i.qty * (1 + pct / 100)))).join('')}</table><button class="sm sec" id="addI" style="margin-top:8px">Add an item</button>
${must.length ? `<h3>Must be on the van</h3>${must.map((m, i) => `<label class="chk"><input type="checkbox" class="mi" data-i="${i}"> ${esc(m)}</label>`).join('')}` : ''}
<div class="btns"><button id="ok">Van loaded</button><button class="sec" data-close>Cancel</button></div>`);
    wireQty(d);
    $('#addI', d).onclick = () => {
      const n = prompt('Item');
      if (n) $('#ld', d).insertAdjacentHTML('beforeend', loadRow({ name: n, qty: 0 }, 1));
    };
    $('#ok', d).onclick = async () => {
      const items = $$('#ld tr', d).map(r => ({
        code: r.dataset.code || undefined,
        name: r.dataset.name,
        planned: +r.dataset.planned || undefined,
        qty: +$('input', r).value || 0,
      }));
      const mandatory = must.map((m, i) => ({ item: m, ok: $(`.mi[data-i="${i}"]`, d).checked }));
      if (
        mandatory.some(m => !m.ok) &&
        !confirm('Some required items are not ticked. Save anyway? The office will see what is missing.')
      )
        return;
      await record('loaded', v, { data: { items, mandatory } });
      d.remove();
      route();
    };
  },
  ra_signoff(v, j) {
    const docs = S.data.docs;
    const ra = (docs.ra || {}).content || {},
      ms = (docs.method || {}).content || {};
    const draft = !(docs.ra && docs.ra.reviewed) || !(docs.method && docs.method.reviewed);
    const d =
      sheet(`<h2>RAMS</h2>${draft ? '<p><span class="draft">DRAFT</span> <span class="muted">Your company has not approved this wording yet.</span></p>' : ''}
<h3>${esc(ra.title || 'Risk assessment')}</h3><table>${(ra.rows || []).map(r => `<tr><td><b>${esc(r[0])}</b><div class="muted">${esc(r[1])}</div>${esc(r[2])}<div class="muted">Risk: ${esc(r[3])}</div></td></tr>`).join('')}</table>
<h3>${esc(ms.title || 'Method statement')}</h3>${(ms.sections || []).map(s => `<p><b>${esc(s[0])}</b><br>${esc(s[1])}</p>`).join('')}
${j.hazards.length ? `<h3>Hazards on this site</h3>${j.hazards.map(h => `<div>• ${esc(h)}</div>`).join('')}` : ''}${j.instructions ? `<h3>Instructions</h3><p style="white-space:pre-wrap">${esc(j.instructions)}</p>` : ''}
<label class="chk"><input type="checkbox" id="rd"> I have read and understood this, and will work to it</label>${sigHtml()}
<div class="btns"><button id="ok">Sign</button><button class="sec" data-close>Cancel</button></div>`);
    const sig = wireSig(d);
    $('#ok', d).onclick = async () => {
      if (!$('#rd', d).checked) return toast('Tick to say you have read it.');
      if (sig.empty()) return toast('Sign first.');
      await record('ra_signoff', v, {
        signature: sig.data(),
        data: { ra_version: docs.ra && docs.ra.version, method_version: docs.method && docs.method.version, draft },
      });
      d.remove();
      route();
    };
  },
  drawing_ack(v, j, dr) {
    const d = sheet(
      `<h2>Drawing rev ${esc(dr.rev)}</h2>${dr.note ? `<p>${esc(dr.note)}</p>` : ''}<div class="btns"><a class="btn sec" href="/api/crew/file/drawing/${esc(dr.id)}" target="_blank" id="op">Open the drawing</a><button id="ok" disabled>I've checked the drawing</button><button class="sec" data-close>Cancel</button></div>`
    );
    $('#op', d).onclick = () => ($('#ok', d).disabled = false);
    $('#ok', d).onclick = async () => {
      await record('drawing_ack', v, { data: { drawing_id: dr.id, rev: dr.rev } });
      d.remove();
      route();
    };
  },
  async signin(v, j) {
    const d = sheet(`<h2>Sign in</h2><p class="muted" id="st">Finding where you are…</p><div id="more"></div>`);
    const pos = await position(15000);
    const far = pos && j.lat != null ? metres(pos, { lat: j.lat, lng: j.lng }) : null;
    const gf = S.data.settings.geofence_m || 300;
    $('#st', d).textContent = !pos
      ? 'Could not find your position. You can still sign in.'
      : far == null
        ? 'Position found.'
        : far > gf
          ? `You look to be ${Math.round(far)} m from the site.`
          : 'You are at the site.';
    $('#more', d).innerHTML =
      `${(far != null && far > gf) || !pos ? '<label>Why? (the office will see this)</label><input type="text" id="why" placeholder="e.g. Parked up the road, site pin is wrong">' : ''}
${v.crew.length === 1 ? '<label class="chk"><input type="checkbox" id="lone" checked> I am working alone: start lone-working check-ins</label>' : ''}<div class="btns"><button id="ok">Sign in</button><button class="sec" data-close>Cancel</button></div>`;
    $('#ok', d).onclick = async () => {
      const why = $('#why', d) ? $('#why', d).value.trim() : '';
      if ($('#why', d) && !why) return toast('Say why.');
      await record('signin', v, {
        pos,
        data: { reason: why || undefined, distance_m: far != null ? Math.round(far) : undefined },
      });
      if ($('#lone', d) && $('#lone', d).checked)
        await record('lone_start', v, { pos, data: { every_mins: S.data.settings.lone_every_mins || 60 } });
      d.remove();
      startLocation();
      route();
    };
  },
  risk_check(v) {
    const d = sheet(`<h2>Site check</h2><label>Does the site match the drawing and the job pack?</label>${seg(
      'm',
      [
        ['yes', 'Yes'],
        ['no', 'No', 'bad'],
      ],
      'yes'
    )}
<label>Can all the controls in the RAMS be put in place?</label>${seg(
      'c',
      [
        ['yes', 'Yes'],
        ['no', 'No', 'bad'],
      ],
      'yes'
    )}<label>Any hazards not in the pack?</label><input type="text" id="x" placeholder="Leave blank if none"><label>Notes</label><textarea id="n"></textarea>
<div class="btns"><button id="ok">Save</button><button class="sec" data-close>Cancel</button></div>`);
    $('#ok', d).onclick = async () => {
      const matches = segVal(d, 'm') === 'yes',
        controls = segVal(d, 'c') === 'yes';
      const e = await record('risk_check', v, {
        data: {
          matches,
          controls,
          extra: $('#x', d).value.trim() || undefined,
          notes: $('#n', d).value.trim() || undefined,
        },
      });
      d.remove();
      if (!matches || !controls) {
        await photoSheet('Photos of what differs', {
          job_id: v.job_id,
          visit_id: v.id,
          event_id: e.id,
          category: 'Before',
          caption: 'Site check',
        });
        alertBox("Don't start yet", 'The office has been told. Call them before you start work.');
      }
      route();
    };
  },
  async started(v) {
    await record('started', v);
    toast('Work started');
    route();
  },
  async installed(v) {
    await record('installed', v);
    route();
  },
  returned(v, j, dr) {
    const ld = stepDone(v, 'loaded');
    const items = ld
      ? ld.data.items || []
      : (dr ? dr.equipment : []).map(i => ({ code: i.code, name: i.name, qty: i.qty }));
    const leave = ['install'].includes(v.kind);
    const d =
      sheet(`<h2>Count the kit back</h2><p class="muted">${leave ? 'Kit left out on site as part of the layout: tick "left on site".' : 'Count what is back on the van.'}</p><table id="ld">${items.map(i => loadRow(i, i.qty, true, leave)).join('')}</table>
<div class="btns"><button id="ok">Save count</button><button class="sec" data-close>Cancel</button></div>`);
    wireQty(d);
    $('#ok', d).onclick = async () => {
      const out = $$('#ld tr', d).map(r => ({
        code: r.dataset.code || undefined,
        name: r.dataset.name,
        qty: +$('input[type=number]', r).value || 0,
        left_on_site: $('.los', r) ? $('.los', r).checked : undefined,
      }));
      await record('returned', v, { data: { items: out } });
      d.remove();
      route();
    };
  },
  complete(v) {
    const removal = ['removal', 'install_remove'].includes(v.kind);
    const d =
      sheet(`<h2>Finish</h2><label>${removal ? 'Is the site left clear and safe?' : 'Is the site left safe, as on the drawing?'}</label>${seg(
        'c',
        [
          ['yes', 'Yes'],
          ['no', 'No', 'bad'],
        ],
        'yes'
      )}
<label>Is the whole job finished?</label>${seg(
        'f',
        [
          ['no', 'No, more visits'],
          ['yes', 'Yes, finished'],
        ],
        removal ? 'yes' : 'no'
      )}<label>Notes for the office</label><textarea id="n"></textarea>${sigHtml()}
<div class="btns"><button id="ok">Finish</button><button class="sec" data-close>Cancel</button></div>`);
    const sig = wireSig(d);
    $('#ok', d).onclick = async () => {
      if (sig.empty()) return toast('Sign first.');
      const fin = segVal(d, 'f') === 'yes';
      await record(fin ? 'job_complete' : 'day_complete', v, {
        signature: sig.data(),
        data: { site_clear: segVal(d, 'c') === 'yes', finished: fin, notes: $('#n', d).value.trim() || undefined },
      });
      d.remove();
      toast('Done. Take any photos still due.');
      route();
    };
  },
  async signout(v) {
    if (owed(v).length && !confirm('Some photos are still due. Sign out anyway?')) return;
    await record('signout', v);
    stopLocation();
    route();
  },
};
const loadRow = (i, q, back, leave) =>
  `<tr data-code="${esc(i.code || '')}" data-name="${esc(i.name)}" data-planned="${esc(i.qty)}"><td>${esc(i.name)}${back ? `<div class="muted">Out: ${esc(i.qty)}</div>` : ''}${leave ? '<label class="chk"><input type="checkbox" class="los"> left on site</label>' : ''}</td><td><div class="qty"><button class="sec" data-q="-1" type="button">−</button><input type="number" inputmode="numeric" min="0" value="${esc(q)}"><button class="sec" data-q="1" type="button">+</button></div></td></tr>`;
function wireQty(d) {
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const i = $('input[type=number]', b.parentNode);
    i.value = Math.max(0, (+i.value || 0) + +b.dataset.q);
  });
}
function alertBox(title, text) {
  sheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btns"><button data-close>OK</button></div>`);
}
const EXTRAS = {
  note: v => textThen(v, 'Note or photo', 'note', 'What do you want to record?', 'Other'),
  change_request: v =>
    textThen(
      v,
      'Site differs from the drawing',
      'change_request',
      'What is different, and what do you need?',
      'Before',
      true
    ),
  near_miss: v =>
    textThen(v, 'Near miss', 'near_miss', 'What happened? Nobody was hurt, but it could have been worse.', 'Other'),
  lone(v) {
    const d = sheet(
      `<h2>Lone working</h2><p>The office is alerted if you miss a check-in.</p><label>Check in every (minutes)</label><input type="number" id="m" value="${esc(S.data.settings.lone_every_mins || 60)}" min="15" max="240"><div class="btns"><button id="ok">Start</button><button class="sec" data-close>Cancel</button></div>`
    );
    $('#ok', d).onclick = async () => (
      await record('lone_start', v, { data: { every_mins: Math.max(15, Math.min(240, +$('#m', d).value || 60)) } }),
      d.remove(),
      route()
    );
  },
  failed(v) {
    const reasons = [
      'Site not ready',
      'No access or blocked',
      'Permit or licence problem',
      'Unsafe to work',
      'Weather',
      'Client cancelled on site',
      'Vehicle or equipment problem',
      'Other',
    ];
    const d = sheet(
      `<h2>Could not go ahead</h2><label>Why?</label><select id="r">${reasons.map(r => `<option>${esc(r)}</option>`).join('')}</select><label>Details</label><textarea id="n"></textarea><div class="btns"><button id="ok">Save and take photos</button><button class="sec" data-close>Cancel</button></div>`
    );
    $('#ok', d).onclick = async () => {
      const e = await record('failed_visit', v, {
        data: { reason: $('#r', d).value, notes: $('#n', d).value.trim() || undefined },
      });
      d.remove();
      await photoSheet('Photos showing why', {
        job_id: v.job_id,
        visit_id: v.id,
        event_id: e.id,
        category: 'Other',
        caption: 'Could not go ahead',
      });
      route();
    };
  },
};
function textThen(v, title, kind, ph, cat, measure) {
  const d = sheet(
    `<h2>${esc(title)}</h2><textarea id="t" placeholder="${esc(ph)}"></textarea>${measure ? '<label>Measurements (optional)</label><input type="text" id="me" placeholder="e.g. Lane 3.1 m, not 3.65 m">' : ''}<div class="btns"><button id="ok">Save and add photos</button><button class="sec" id="ok2">Save without photos</button><button class="sec" data-close>Cancel</button></div>`
  );
  const go = async photos => {
    const text = $('#t', d).value.trim();
    if (!text) return toast('Write something first.');
    const e = await record(kind, v, {
      data: { text, measure: measure ? $('#me', d).value.trim() || undefined : undefined },
    });
    d.remove();
    if (photos)
      await photoSheet(title, {
        job_id: v.job_id,
        visit_id: v.id,
        event_id: e.id,
        category: cat,
        caption: text.slice(0, 280),
      });
    toast(kind === 'note' ? 'Saved' : 'Saved. The office has been told.');
    route();
  };
  $('#ok', d).onclick = () => go(true);
  $('#ok2', d).onclick = () => go(false);
}
function panic(v) {
  const d =
    sheet(`<h2 style="color:var(--red)">Panic alarm</h2><p>Sends your position to the office straight away and emails every office user.</p><p><b>If anyone is hurt or in danger, call 999 first.</b></p>
<div class="btns"><button class="danger" id="go">Send panic alarm</button><a class="btn sec" href="tel:999">Call 999</a><button class="sec" data-close>Cancel</button></div>`);
  $('#go', d).onclick = async () => {
    $('#go', d).disabled = true;
    await record('panic', v, { pos: await position(6000) });
    await flushNow(false);
    const sent = !S.outbox.some(e => e.kind === 'panic' && !e.error);
    d.remove();
    sheet(
      sent
        ? `<h2>Alarm sent</h2><p>The office has your position. Keep your phone with you.</p><div class="btns"><a class="btn danger" href="tel:999">Call 999</a><button class="sec" data-close>Close</button></div>`
        : `<h2 style="color:var(--red)">No signal: alarm NOT sent yet</h2><p>It will send the moment you have signal. Call 999 or the office now if you can.</p><div class="btns"><a class="btn danger" href="tel:999">Call 999</a><button class="sec" data-close>Close</button></div>`
    );
  };
}

/* ---------- position while signed in (working time only) ---------- */
let locTimer = null;
function startLocation() {
  if (locTimer) return;
  const send = async () => {
    if (!navigator.onLine || document.visibilityState !== 'visible') return;
    const p = await position(10000);
    if (p)
      fetch('/api/crew/location', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      }).catch(() => {});
  };
  send();
  locTimer = setInterval(send, 5 * 60e3);
}
function stopLocation() {
  clearInterval(locTimer);
  locTimer = null;
}

/* ---------- more: alerts, unsent items, sign out ---------- */
async function drawMore() {
  const bad = [
    ...S.outbox
      .filter(e => e.error)
      .map(e => ({ store: 'outbox', id: e.id, what: LABEL[e.kind] || e.kind, when: e.client_time, error: e.error })),
    ...S.photos
      .filter(p => p.error)
      .map(p => ({ store: 'photos', id: p.id, what: 'Photo', when: p.taken_at, error: p.error })),
  ];
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#v').innerHTML = `<a class="back" href="#">‹ All jobs</a><h1>More</h1>
<div class="card"><h2>${esc(me().name || '')}</h2><p class="muted">${esc(me().company || '')}</p></div>
<div class="card"><h2>Alerts from the office</h2><p>${perm === 'granted' ? '<span class="chip ok">On</span>' : perm === 'denied' ? '<span class="chip bad">Blocked in phone settings</span>' : '<span class="chip warn">Off</span>'}</p>${perm !== 'granted' ? '<button class="wide" id="push">Switch on alerts</button>' : ''}
<p class="muted">${standalone() ? 'Running from the home screen.' : '<a href="#guide">Put TM WerX on your home screen</a> so it works without signal.'}</p></div>
<div class="card"><h2>Waiting to send</h2><p>${S.outbox.filter(e => !e.error).length} records, ${S.photos.filter(p => !p.error).length} photos.</p><button class="sec wide" id="send">Send now</button>
${bad.length ? `<h3>Could not be sent</h3>${bad.map(b => `<div class="vc"><b>${esc(b.what)}</b> <span class="muted">${b.when ? fmtT(b.when) : ''}</span><div class="muted">${esc(b.error)}</div><button class="sm sec" data-drop="${esc(b.store)}:${esc(b.id)}">Remove from phone</button></div>`).join('')}` : ''}</div>
<div class="btns"><button class="sec" id="out">Sign out</button></div><p class="muted" style="text-align:center">TM WerX crew app</p>`;
  if ($('#push')) $('#push').onclick = enablePush;
  $('#send').onclick = () => flushNow(true).then(drawMore);
  $$('[data-drop]').forEach(
    b =>
      (b.onclick = async () => {
        if (!confirm('Remove this from the phone? It will never reach the office.')) return;
        const [store, id] = b.dataset.drop.split(':');
        await TMDB.del(store, id);
        await refreshLocal();
        drawMore();
      })
  );
  $('#out').onclick = async () => {
    await flushNow(false);
    const n = S.outbox.length + S.photos.length;
    if (
      n &&
      !confirm(
        `${n} item${n > 1 ? 's have' : ' has'} not been sent. They stay on this phone and send when you sign in again. Sign out?`
      )
    )
      return;
    await fetch('/api/crew/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    await forgetPerson();
    S.signedOut = false;
    stopLocation();
    drawLogin();
  };
}

/* ---------- routing and start-up ---------- */
function route() {
  if (!S.data) return drawLogin();
  if (sheetOpen()) return;
  const [name, arg] = location.hash.slice(1).split('/');
  if (name === 'job') {
    const vs = S.data.visits.filter(v => v.job_id === arg);
    const v = vs.find(x => x.date === today()) || vs.find(x => x.date >= today()) || vs[vs.length - 1];
    location.replace(v ? '#v/' + v.id : '#');
    return;
  }
  if (name === 'v') drawVisit(arg);
  else if (name === 'info') drawInfo(arg);
  else if (name === 'more') drawMore();
  else if (name === 'guide') drawGuide();
  else drawHome();
  drawSendbar();
  window.scrollTo(0, 0);
}
// photos falling due while the app is open: a buzz and a notification
async function tick() {
  if (!S.data) return;
  const due = S.data.visits.flatMap(v => owed(v).map(t => Object.assign({ v }, t)));
  for (const t of due)
    if (!S.notified.has(t.id)) {
      S.notified.add(t.id);
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      try {
        if (Notification.permission === 'granted')
          (await navigator.serviceWorker.ready).showNotification('Photo due', {
            body: `${jobOf(t.v.job_id).number}: ${t.label}`,
            tag: 'task-' + t.id,
            data: { url: '/crew/#v/' + t.v.id },
            icon: '/icon-192.png',
          });
      } catch (e) {
        /* notifications not available */
      }
    }
  if (
    !sheetOpen() &&
    /^#v\//.test(location.hash) &&
    document.activeElement.tagName !== 'INPUT' &&
    document.activeElement.tagName !== 'TEXTAREA'
  )
    route();
  if (navigator.onLine && (S.outbox.some(e => !e.error) || S.photos.some(p => !p.error))) flushNow(false);
}
(async function start() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/crew/sw.js', { scope: '/crew/' }).catch(() => {});
    navigator.serviceWorker.addEventListener(
      'message',
      e => e.data && e.data.type === 'open' && (location.href = e.data.url)
    );
  }
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    S.installEvt = e;
    if (location.hash === '#guide') drawGuide();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => (drawSendbar(), flushNow(false), sync(true)));
  window.addEventListener('offline', drawSendbar);
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'visible' && (sync(true), reportState())
  );
  S.seen = (await TMDB.get('kv', 'seen')) || {};
  S.data = (await TMDB.get('kv', 'sync')) || null;
  await refreshLocal();
  route();
  await sync(true);
  route();
  reportState();
  if (S.data && S.data.visits.some(v => stepDone(v, 'signin') && !stepDone(v, 'signout') && !firstOf(v, ENDS)))
    startLocation();
  setInterval(tick, 30000);
  setInterval(() => sync(true), 5 * 60e3);
  tick();
})();
