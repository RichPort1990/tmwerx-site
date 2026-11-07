// Makes a VAPID key pair for phone notifications. Put both in Cloudflare as secrets:
//   npx wrangler secret put VAPID_PUBLIC_KEY   (paste the public key)
//   npx wrangler secret put VAPID_PRIVATE_KEY  (paste the private key)
// Keep the private key safe. Changing the pair later means every phone has to allow notifications again.
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log('VAPID_PUBLIC_KEY  ' + b64u(raw));
console.log('VAPID_PRIVATE_KEY ' + jwk.d);
