/* The crew app's offline store, shared by the page and the service worker (importScripts).
   Records and photos are saved on the phone first, then sent when there is signal. Each has an id made on the
   phone, so sending the same one twice is harmless: the server keeps the first copy. */
'use strict';
const TMDB = (() => {
  let dbp = null;
  const open = () =>
    (dbp =
      dbp ||
      new Promise((res, rej) => {
        const r = indexedDB.open('tmwerx-crew', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('kv');
          db.createObjectStore('outbox', { keyPath: 'id' });
          db.createObjectStore('photos', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  const req = r => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const api = {
    get: (store, key) => tx(store, 'readonly', s => req(s.get(key))),
    put: (store, val, key) => tx(store, 'readwrite', s => req(key === undefined ? s.put(val) : s.put(val, key))),
    del: (store, key) => tx(store, 'readwrite', s => req(s.delete(key))),
    all: store => tx(store, 'readonly', s => req(s.getAll())),
    count: store => tx(store, 'readonly', s => req(s.count())),
    clear: store => tx(store, 'readwrite', s => req(s.clear())),
  };
  // photo rows without their image, for listing
  api.photoMeta = async () =>
    (await api.all('photos')).map(p => Object.assign({}, p.meta, { id: p.id, error: p.error, queued_at: p.queued_at }));

  let flushing = null;
  // send everything waiting: records first (so the server knows the visit and its photo schedule), then photos
  api.flush = () =>
    (flushing =
      flushing ||
      (async () => {
        const out = { sent: 0, photos: 0, failed: 0, signedOut: false, offline: false };
        try {
          // only what the person signed in now made: the server files everything under the session's login
          const owner = await api.get('kv', 'owner');
          if (!owner) return out; // nobody has signed in on this phone yet: nothing of theirs to send
          let ev = (await api.all('outbox'))
            .filter(e => !e.error && e.user_id === owner)
            .sort((a, b) => a.client_time - b.client_time);
          while (ev.length) {
            const batch = ev.slice(0, 50).map(e => Object.assign({}, e, { queued_at: undefined }));
            const r = await fetch('/api/crew/events', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ events: batch, client_now: Date.now() }),
            });
            if (r.status === 401) return Object.assign(out, { signedOut: true });
            if (!r.ok) throw new Error('server ' + r.status);
            const j = await r.json();
            for (const id of j.done || []) await api.del('outbox', id);
            for (const f of j.failed || []) {
              const e = await api.get('outbox', f.id);
              if (e) await api.put('outbox', Object.assign(e, { error: f.error }));
            }
            out.sent += (j.done || []).length;
            out.failed += (j.failed || []).length;
            ev = ev.slice(50);
          }
          const ph = (await api.all('photos'))
            .filter(p => !p.error && p.meta.user_id === owner)
            .sort((a, b) => a.meta.taken_at - b.meta.taken_at);
          for (const p of ph) {
            const r = await fetch('/api/crew/photo/' + p.id, {
              method: 'PUT',
              credentials: 'same-origin',
              body: p.blob,
              headers: {
                'Content-Type': p.blob.type || 'image/jpeg',
                'X-Photo': encodeURIComponent(JSON.stringify(Object.assign({}, p.meta, { client_now: Date.now() }))),
              },
            });
            if (r.status === 401) return Object.assign(out, { signedOut: true });
            if (r.ok) {
              await api.del('photos', p.id);
              out.photos++;
            } else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
              const j = await r.json().catch(() => ({}));
              await api.put('photos', Object.assign(p, { error: j.error || 'refused (' + r.status + ')' }));
              out.failed++;
            } else throw new Error('server ' + r.status);
          }
        } catch (e) {
          out.offline = true;
        } finally {
          flushing = null;
        }
        return out;
      })());
  return api;
})();
