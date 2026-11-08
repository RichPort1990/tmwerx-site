// Shared basics: constants, encoding, responses, request bodies, email, rate limits.
export const DAY = 864e5,
  SESSION_DAYS = 30,
  CK = '__Host-tm_s',
  DK = '__Host-tm_d',
  PK = '__Host-tm_p';
// personal email providers: they never claim an organisation (everyone else's first sign-up claims its domain)
// (shared and ISP mail: a domain here, or any subdomain of one, never claims an organisation)
export const FREE_MAIL = new Set(
  `gmail.com googlemail.com outlook.com outlook.co.uk outlook.fr outlook.de outlook.ie hotmail.com hotmail.co.uk hotmail.fr hotmail.de hotmail.it hotmail.es live.com live.co.uk live.fr live.ie msn.com
 windowslive.com passport.com yahoo.com yahoo.co.uk yahoo.fr yahoo.de yahoo.ie yahoo.es yahoo.it ymail.com rocketmail.com icloud.com me.com mac.com aol.com aol.co.uk aim.com
 btinternet.com btopenworld.com btconnect.com talk21.com sky.com sky.co.uk talktalk.net talktalk.co.uk tiscali.co.uk virginmedia.com virgin.net ntlworld.com blueyonder.co.uk
 plus.net plus.com freeserve.co.uk lineone.net o2.co.uk orange.net orange.co.uk wanadoo.co.uk tesco.net zen.co.uk zetnet.co.uk madasafish.com f2s.com fsmail.net uwclub.net
 gmx.com gmx.co.uk gmx.net gmx.de web.de mail.com email.com usa.com post.com inbox.com mail.ru yandex.com yandex.ru protonmail.com protonmail.ch proton.me pm.me tutanota.com tuta.io
 zoho.com zohomail.com fastmail.com fastmail.fm hushmail.com mailbox.org posteo.de runbox.com hey.com duck.com mailfence.com qq.com 163.com 126.com naver.com
 free.fr orange.fr laposte.net sfr.fr libero.it virgilio.it t-online.de freenet.de seznam.cz wp.pl o2.pl onet.pl interia.pl rediffmail.com eircom.net`
    .split(/\s+/)
    .filter(Boolean)
);
export const freeMail = d => {
  for (let x = d; x.includes('.'); x = x.slice(x.indexOf('.') + 1)) if (FREE_MAIL.has(x)) return true;
  return false;
};
export const workDomain = e => {
  const d =
    String(e || '')
      .toLowerCase()
      .split('@')[1] || '';
  return d && !freeMail(d) ? d : null;
};
export const now = () => Date.now();
// for a failure that should not stop the request but must not vanish either
export const logErr = what => e => console.error(what + ': ' + ((e && e.message) || e));
export const enc = new TextEncoder();
export const b64u = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const unb64u = s =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c =>
    c.charCodeAt(0)
  );
export const b64 = buf => {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
export const randToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
export const redirectC = (to, cookies) => {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  for (const c of cookies) if (c) h.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers: h });
};
export const redirect = (to, headers = {}) =>
  new Response(null, { status: 303, headers: Object.assign({ Location: to, 'Cache-Control': 'no-store' }, headers) });
export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
// plain characters only, so an address can never carry a link (https://…) into an email we send
// the request body, read up to max bytes whatever the Content-Length header says (null = too large)
export async function readBody(req, max) {
  if ((+req.headers.get('Content-Length') || 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const rd = req.body.getReader(),
    parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      try {
        await rd.cancel();
      } catch (e) {
        // already finished or cancelled: nothing to tidy up
      }
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
export const tooLarge = () => new Response('Too large', { status: 413 });
export const emailOk = e =>
  /^[a-z0-9][a-z0-9._%+'-]{0,63}@([a-z0-9-]{1,63}\.)+[a-z]{2,24}$/i.test(e) &&
  e.length <= 254 &&
  !/\.\.|\.@|@-|-\./.test(e);
// 'free': an approved company that uses the service without paying (FREE_DOMAINS); never sent to Stripe
export const ACTIVE = new Set(['active', 'trialing', 'past_due', 'free']);
// FREE_DOMAINS: comma-separated @domains whose companies sign up and use the service free, with no payment step
export function freeDomain(env, email) {
  const e = String(email || '').toLowerCase(),
    d = e.slice(e.lastIndexOf('@'));
  return (
    e.includes('@') &&
    (env.FREE_DOMAINS || '')
      .toLowerCase()
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
      .includes(d)
  );
}

// the company's registered details (Companies Act: on the website and in emails), from the settings; any part not yet
// filled in (empty, or still a [placeholder]) is left out
export function companyLine(env) {
  const v = k => {
    const x = String(env[k] || '').trim();
    return x && !/^\[.*\]$/.test(x) ? x : '';
  };
  const name = v('PROVIDER_NAME') || 'CAD WerX Limited',
    no = v('PROVIDER_NUMBER'),
    addr = v('PROVIDER_ADDRESS');
  return `${name}, a company registered in England and Wales${no ? ', number ' + no : ''}${addr ? '. Registered office: ' + addr : ''}.`;
}
// the price per user per month before VAT (PRICE_GBP), as shown: "100", "99.50"; '' when not set
export function priceGbp(env) {
  const n = Number(String(env.PRICE_GBP || '').replace(/[£,\s]/g, ''));
  return n > 0 ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '';
}
// what the price pages say about VAT: nothing until CAD WerX registers (VAT_REGISTERED), then that prices exclude it
export const vatNote = env => (env.VAT_REGISTERED === '1' ? 'Prices exclude VAT.' : '');
export async function sendEmail(env, to, subject, text) {
  text = `${text}\n\n--\n${companyLine(env)}\nQuestions: ${env.SUPPORT_EMAIL || 'support@tmwerx.co.uk'}`;
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        reply_to: env.SUPPORT_EMAIL || undefined,
      }),
    });
    if (!r.ok) throw new Error('Email could not be sent (' + r.status + ')');
    return;
  }
  if (env.DEV_MODE === '1') {
    await env.DB.prepare('INSERT INTO outbox (to_addr, subject, body, created_at) VALUES (?, ?, ?, ?)')
      .bind(to, subject, text, now())
      .run();
    return;
  }
  throw new Error('Email sending is not set up (RESEND_API_KEY).');
}
// simple brute-force brake: at most n tries per key in the window
// (one statement, so requests sent at the same moment cannot all slip under the limit)
export async function tooMany(env, k, n, mins) {
  const r = await env.DB.prepare(
    'INSERT INTO attempts (k, at) SELECT ?, ? WHERE (SELECT COUNT(*) FROM attempts WHERE k = ? AND at > ?) < ?'
  )
    .bind(k, now(), k, now() - mins * 60e3, n)
    .run();
  return !(r.meta && r.meta.changes === 1);
}
// the address a limit is counted against: IPv6 by its /64 (one connection usually holds a whole /64)
export function ipKey(ip) {
  ip = String(ip || '').toLowerCase();
  if (!ip.includes(':')) return ip;
  const [h, t] = ip.split('::'),
    a = h ? h.split(':') : [],
    b = t ? t.split(':') : [];
  const g = t === undefined ? a : a.concat(Array(Math.max(0, 8 - a.length - b.length)).fill('0'), b);
  return (
    g
      .slice(0, 4)
      .map(x => x.replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}

export const plain = (x, d = 'A colleague') =>
  String(x || '')
    .replace(/(https?:\/\/|www\.)\S*/gi, '')
    .replace(
      /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|uk|info|biz|xyz|ru|cn|app|link|site|online|top|me|ly|gl)\b\S*/gi,
      ''
    )
    .replace(/[\r\n<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || d;
// error messages are codes in the address, never free text someone could put in a link
export const ERR = {
  email: 'Enter a valid email address.',
  invTooMany: 'Too many invitations in the last hour.',
  invSub: 'Invitations need an active subscription that is not set to cancel. Check the subscription below.',
  file: 'Choose a file.',
  imgType: 'Use a PNG or JPEG file (save an SVG logo as a PNG first).',
  imgSize: 'The logo must be 1 MB or smaller.',
  imgBad: 'That file is not a valid image.',
  svg: 'That SVG contains scripts or unsupported content; export it as a plain SVG or PNG.',
  os: 'That does not look like an OS Data Hub key.',
  pwCur: 'Current password not recognised.',
  pwShort: 'Use a password of at least 10 characters.',
  pwLong: 'That password is too long.',
  pwMany: 'Too many attempts. Wait 15 minutes and try again.',
  close: 'To close the account, type the company name exactly and enter your password.',
};
export const pwCode = pw => (!pw || pw.length < 10 ? 'pwShort' : pw.length > 200 ? 'pwLong' : null);

export const lockedDown = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
};
