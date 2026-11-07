// Phone notifications (Web Push): encrypted to each phone's key (RFC 8291, aes128gcm) and signed with the site's
// VAPID key (RFC 8292). No Apple or Google developer account is needed. VAPID_PUBLIC_KEY is the raw P-256 public key
// and VAPID_PRIVATE_KEY the private scalar, both base64url (scripts/vapid.mjs makes a pair).
import { b64u, enc, now, unb64u } from '../lib/core.js';

const concat = (...a) => {
  const n = a.reduce((t, x) => t + x.length, 0),
    out = new Uint8Array(n);
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
let vapidKey = null;
async function signingKey(env) {
  if (vapidKey && vapidKey.pub === env.VAPID_PUBLIC_KEY) return vapidKey.key;
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: env.VAPID_PRIVATE_KEY,
      x: b64u(pub.slice(1, 33)),
      y: b64u(pub.slice(33, 65)),
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  vapidKey = { pub: env.VAPID_PUBLIC_KEY, key };
  return key;
}
async function vapidJwt(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || 'mailto:support@tmwerx.co.uk',
      })
    )
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await signingKey(env),
    enc.encode(h + '.' + p)
  );
  return `${h}.${p}.${b64u(sig)}`;
}
// the encrypted body for one subscription
export async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.p256dh),
    auth = unb64u(sub.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, concat(enc.encode(text), new Uint8Array([2])))
  );
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
// send to every phone of these users; subscriptions the push service says are gone are removed
export async function pushTo(env, userIds, msg) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !userIds.length) return 0;
  const subs = (
    await env.DB.prepare(`SELECT * FROM tm_push WHERE user_id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(userIds))
      .all()
  ).results;
  let sent = 0;
  const text = JSON.stringify(msg).slice(0, 3000);
  await Promise.all(
    subs.map(async s => {
      try {
        const body = await encryptPayload(s, text);
        const r = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `vapid t=${await vapidJwt(env, s.endpoint)}, k=${env.VAPID_PUBLIC_KEY}`,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400',
            Urgency: msg.urgent ? 'high' : 'normal',
          },
          body,
        });
        if (r.status === 404 || r.status === 410)
          await env.DB.prepare('DELETE FROM tm_push WHERE id = ?').bind(s.id).run();
        else if (!r.ok)
          // a phone that keeps refusing (uninstalled, or its subscription broken): stop after 10 tries
          await env.DB.batch([
            env.DB.prepare('UPDATE tm_push SET failures = failures + 1 WHERE id = ?').bind(s.id),
            env.DB.prepare('DELETE FROM tm_push WHERE id = ? AND failures >= 10').bind(s.id),
          ]);
        else {
          sent++;
          if (s.failures) await env.DB.prepare('UPDATE tm_push SET failures = 0 WHERE id = ?').bind(s.id).run();
        }
      } catch (e) {
        console.error('push: ' + e.message);
      }
    })
  );
  return sent;
}
