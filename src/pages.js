// Page shell and small HTML helpers for the account pages (the office and crew apps are separate pages)
export const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

import { FONT_CSS } from './fonts.js';
import { companyLine } from './lib/core.js';
const CSS =
  FONT_CSS +
  `
:root{--ink:#eceef0;--muted:#a0a7b0;--line:#333a42;--panel:#1a1e23;--bg:#121518;--amber:#f26b1d;--red:#ff7b7b;--ok:#7fd8a0;--display:'Barlow Condensed',Arial Narrow,Arial,sans-serif;--body:'Barlow',Arial,sans-serif}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--body)}
a{color:#ff9a5c}header{background:#121518;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;border-bottom:2px solid #f26b1d;position:sticky;top:0;z-index:5}
header .brand{font:800 22px/1 var(--body);letter-spacing:-.4px;color:#fff;text-decoration:none;white-space:nowrap}header .brand span{font-weight:900}
header nav{margin-left:auto;display:flex;gap:16px;font-size:14px}header nav a{color:#fff;text-decoration:none;opacity:.9}header nav a:hover{opacity:1;text-decoration:underline}header nav form{margin:0;display:inline}header nav button{all:unset;cursor:pointer;color:#fff;opacity:.9;font-size:14px}header nav button:hover{opacity:1;text-decoration:underline}
footer{max-width:860px;margin:8px auto 30px;padding:14px 16px 0;font-size:12.5px;color:#7b828b;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:4px 18px}footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--ink);text-decoration:underline}footer .co{flex-basis:100%}
main{max-width:860px;margin:28px auto;padding:0 16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:22px 24px;margin-bottom:18px}
h1{font:700 34px/1.1 var(--display);margin:0 0 14px;color:#fff}
h2{font:700 24px/1.2 var(--display);margin:0 0 10px;color:#fff}
h3{font:700 16px/1.3 var(--body);margin:18px 0 6px}
label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}
input[type=text],input[type=email],input[type=password],input[type=file],input[type=number],select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#0f1214;color:var(--ink)}input:focus,select:focus,textarea:focus{border-color:#f26b1d;outline:none;box-shadow:0 0 0 3px rgba(242,107,29,.25)}
.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400}.chk input{margin-top:5px}
button,.btn{display:inline-block;font:600 16px/1 var(--body);padding:12px 20px;border-radius:999px;border:2px solid var(--amber);background:var(--amber);color:#fff;cursor:pointer;text-decoration:none;margin-top:16px}button:hover,.btn:hover{background:#ff8a45;border-color:#ff8a45}
button.sec,.btn.sec{background:transparent;border-color:#56606b;color:var(--ink)}button.danger{background:transparent;border-color:var(--red);color:var(--red)}
.msg{padding:10px 14px;border-radius:4px;margin:0 0 14px;border-left:4px solid}.msg.err{background:rgba(220,60,60,.14);border-color:var(--red)}.msg.ok{background:rgba(46,160,90,.15);border-color:var(--ok)}.msg.info{background:rgba(242,107,29,.12);border-color:var(--amber)}
.muted{color:var(--muted);font-size:14px}@media (max-width:640px){table.cards,table.cards tbody,table.cards tr,table.cards td{display:block;width:100%}table.cards tr:first-child{display:none}table.cards tr{border-bottom:1px solid var(--line);padding:6px 0}table.cards td{border:0;padding:2px 0}table.cards td[data-l]::before{content:attr(data-l) ': ';color:var(--muted);font-size:12px}table:not(.cards){display:block;overflow-x:auto;white-space:nowrap}}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.terms{max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:6px 16px;background:#15181c;font-size:14.5px}.terms h2{font-size:18px;margin-top:10px}
.draft{background:rgba(220,60,60,.14);border:1px solid var(--red);color:var(--red);font-weight:700;padding:6px 10px;border-radius:4px}
.steps{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px;padding:0;list-style:none;font-size:13px}.steps li{padding:4px 10px;border-radius:12px;background:#22272d;color:var(--muted)}.steps li.on{background:var(--amber);color:#fff;font-weight:700}.steps li.done{background:rgba(46,160,90,.18);color:var(--ok)}
.row{display:flex;gap:16px;flex-wrap:wrap}.row>*{flex:1;min-width:220px}
.logo-prev{max-width:240px;max-height:110px;border:1px solid var(--line);padding:6px;background:#fff;border-radius:6px}
code{background:#22272d;padding:1px 5px;border-radius:3px}
input[type=file]{padding:8px;color:var(--muted);cursor:pointer}input[type=file]::file-selector-button{font:600 14px/1 var(--body);padding:9px 16px;margin-right:14px;border-radius:999px;border:2px solid #56606b;background:transparent;color:var(--ink);cursor:pointer}input[type=file]::file-selector-button:hover{border-color:var(--ink)}
.logoup{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0}.logoup input[type=file]{width:auto;max-width:230px;padding:4px}.logoup button{margin-top:0;padding:7px 12px;font-size:13px}
details{margin-top:10px}details>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--ink)}details>summary::-webkit-details-marker{display:none}
details>summary::after{content:"";width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg) translateY(-2px);transition:transform .15s}details[open]>summary::after{transform:rotate(-135deg) translateY(-1px)}details>summary:hover{color:#ff9a5c}
@media(max-width:640px){main{margin:16px auto}.card{padding:16px}table{display:block;overflow-x:auto;white-space:nowrap}}`;

export function page(env, title, body, user, status = 200, extraHead = '', setCookie = '') {
  const nav = user
    ? `<a href="/app">Office</a><a href="/account">Account</a>${user.super ? '<a href="/admin">Admin</a>' : ''}<form method="post" action="/logout"><button type="submit">Sign out</button></form>`
    : `<a href="/login">Sign in</a><a href="/signup">Start a subscription</a>`;
  return new Response(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<title>${esc(title)} · ${esc(env.APP_NAME || 'TM WerX')}</title>
<style>${CSS}</style>${extraHead}</head><body>
<header><a class="brand" href="/" aria-label="TM WerX">TM Wer<span style="color:#f26b1d">X</span></a><nav>${nav}</nav></header>
<main>${body}</main><footer><a href="/terms">Agreement</a><a href="/privacy">Privacy and cookies</a><a href="/about">Data sources</a><a href="mailto:${esc(env.SUPPORT_EMAIL || 'support@tmwerx.co.uk')}">${esc(env.SUPPORT_EMAIL || 'support@tmwerx.co.uk')}</a><span class="co">${esc(companyLine(env))}</span></footer></body></html>`,
    {
      status,
      headers: secHeaders(
        Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, setCookie ? { 'Set-Cookie': setCookie } : {})
      ),
    }
  );
}
export function secHeaders(h = {}) {
  return Object.assign(
    {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none'; base-uri 'none'",
    },
    h
  );
}
export const msg = (m, cls = 'err') => (m ? `<div class="msg ${cls}">${esc(m)}</div>` : '');
export function steps(cur) {
  const all = [
    ['account', 'Account'],
    ['verify', 'Confirm email'],
    ['agreement', 'Agreement'],
    ['billing', 'Subscription'],
    ['app', 'TM WerX'],
  ];
  const k = all.findIndex(x => x[0] === cur);
  return `<ol class="steps">${all.map(([id, t], i) => `<li class="${i < k ? 'done' : i === k ? 'on' : ''}">${i + 1}. ${t}</li>`).join('')}</ol>`;
}
