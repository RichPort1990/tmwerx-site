// Stripe: the subscription, seats, checkout, the customer portal and webhooks.
import { esc, msg, page, steps } from './pages.js';
import { nextStep, timingSafe } from './auth.js';
import {
  ACTIVE,
  enc,
  freeMail,
  hex,
  json,
  now,
  priceGbp,
  vatNote,
  readBody,
  redirect,
  sendEmail,
  tooLarge,
  tooMany,
  workDomain,
} from './lib/core.js';

/* ---------- Stripe ---------- */
export function formEncode(o, prefix = '', out = []) {
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
export async function stripe(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not set up (STRIPE_SECRET_KEY).');
  // one retry on a dropped connection; POSTs carry an idempotency key, so a retried request is never applied twice
  const req = () =>
    fetch(
      `${env.STRIPE_API_BASE || 'https://api.stripe.com'}/v1/${path}${method === 'GET' && params ? '?' + formEncode(params) : ''}`,
      {
        method,
        headers: Object.assign(
          {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Stripe-Version': '2024-06-20',
          },
          method === 'POST' ? { 'Idempotency-Key': idem } : {}
        ),
        body: method === 'GET' || method === 'DELETE' ? undefined : formEncode(params || {}),
      }
    );
  const idem = crypto.randomUUID();
  let r;
  try {
    r = await req();
  } catch (e) {
    await new Promise(res => setTimeout(res, 300));
    r = await req();
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Stripe: ' + ((j.error && j.error.message) || r.status));
  return j;
}
export async function verifyStripe(env, body, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(
    header
      .split(',')
      .map(x => x.split('='))
      .filter(x => x.length === 2)
      .map(([k, v]) => [k.trim(), v])
  );
  const sigs = header
    .split(',')
    .filter(x => x.trim().startsWith('v1='))
    .map(x => x.trim().slice(3));
  const t = +parts.t;
  if (!t || Math.abs(now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`)));
  return sigs.some(s => timingSafe(s, mac));
}
// keep the company row in step with its Stripe subscription (always as Stripe has it now, never an old event's copy)
export async function applySubscription(env, sub, companyId) {
  const items = (sub.items && sub.items.data) || [],
    item = items.find(i => i.price && i.price.id === env.STRIPE_PRICE_ID) || items[0];
  const cid =
    companyId ||
    (sub.metadata && sub.metadata.company_id) ||
    (
      (await env.DB.prepare('SELECT id FROM companies WHERE stripe_sub = ? OR stripe_customer = ?')
        .bind(sub.id, sub.customer)
        .first()) || {}
    ).id;
  if (!cid) return;
  const cur = await env.DB.prepare('SELECT stripe_sub, sub_status, closed_at FROM companies WHERE id = ?')
    .bind(cid)
    .first();
  if (cur && cur.closed_at) return;
  // a different subscription for the same company only replaces the current one if the current one has lapsed
  if (cur && cur.stripe_sub && cur.stripe_sub !== sub.id && ACTIVE.has(cur.sub_status) && !ACTIVE.has(sub.status))
    return;
  await env.DB.prepare(
    'UPDATE companies SET stripe_customer = ?, stripe_sub = ?, stripe_item = ?, sub_status = ?, seats_paid = ?, period_end = ?, cancel_at_period_end = ? WHERE id = ?'
  )
    .bind(
      sub.customer,
      sub.id,
      item ? item.id : null,
      sub.status,
      item ? item.quantity : 0,
      (sub.current_period_end || (item && item.current_period_end) || 0) * 1000,
      sub.cancel_at_period_end ? 1 : 0,
      cid
    )
    .run();
  await syncSeats(env, cid); // people who joined before the subscription existed, or a quantity changed elsewhere
  await claimDomain(env, cid, sub.status);
  if (sub.status === 'trialing') {
    // this domain has had its free trial
    const a = await env.DB.prepare(
      "SELECT email FROM users WHERE company_id = ? AND role = 'admin' ORDER BY created_at LIMIT 1"
    )
      .bind(cid)
      .first();
    if (a)
      await env.DB.prepare('INSERT OR IGNORE INTO trials (domain, at) VALUES (?, ?)')
        .bind(workDomain(a.email) || a.email, now())
        .run();
  }
}
// a confirmed, paying company holds the email domain it signed up from (unless another active company already does);
// a lapsed or closed one lets it go, so nobody can hold a domain by signing up and never paying
export async function claimDomain(env, cid, status) {
  const c = await env.DB.prepare('SELECT domain_claim FROM companies WHERE id = ?').bind(cid).first();
  if (!ACTIVE.has(status) || !c || !c.domain_claim || freeMail(c.domain_claim)) {
    await env.DB.prepare('UPDATE companies SET domain = NULL WHERE id = ?').bind(cid).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE companies SET domain = domain_claim WHERE id = ? AND domain IS NULL AND domain_claim IS NOT NULL AND closed_at IS NULL
    AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = companies.id AND u.role = 'admin' AND u.verified = 1 AND u.disabled = 0)
    AND NOT EXISTS (SELECT 1 FROM companies o WHERE o.domain = companies.domain_claim AND o.id <> companies.id AND o.closed_at IS NULL AND o.sub_status IN ('active','trialing','past_due'))`
  )
    .bind(cid)
    .run();
}
export const activeUsers = async (env, cid) =>
  (await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND disabled = 0').bind(cid).first()).c;
// the subscription quantity follows the number of active users (prorated)
// never throws: if Stripe is unreachable the change is marked and the scheduled job retries it
export async function syncSeats(env, cid) {
  try {
    const c = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(cid).first();
    if (!c || !c.stripe_item || !ACTIVE.has(c.sub_status)) return;
    const n = Math.max(1, await activeUsers(env, cid));
    if (n === c.seats_paid) {
      if (c.seats_dirty) await env.DB.prepare('UPDATE companies SET seats_dirty = 0 WHERE id = ?').bind(cid).run();
      return;
    }
    await stripe(env, 'POST', `subscription_items/${c.stripe_item}`, {
      quantity: n,
      proration_behavior: n > c.seats_paid ? 'always_invoice' : 'create_prorations',
    });
    await env.DB.prepare('UPDATE companies SET seats_paid = ?, seats_dirty = 0 WHERE id = ?').bind(n, cid).run();
  } catch (e) {
    console.error('seat sync failed for ' + cid + ': ' + e.message);
    await env.DB.prepare('UPDATE companies SET seats_dirty = 1 WHERE id = ?').bind(cid).run();
  }
}

export async function billing(env, M, u, url) {
  if (!u) return redirect('/login');
  const ns = await nextStep(env, u);
  if (ns && ns !== '/billing') return redirect(ns);
  if (!ns) return redirect('/account');
  const users = await activeUsers(env, u.company_id),
    note = url.searchParams.get('m');
  if (u.role !== 'admin')
    return page(
      env,
      'Subscription',
      `<div class="card"><h1>Subscription not active</h1><p>${esc(u.company_name)}'s subscription isn't active. Ask your administrator to set it up or update the payment details.</p></div>`,
      u
    );
  const st = u.sub_status || 'none';
  const lapsed = st === 'canceled' || st === 'unpaid' || st === 'incomplete_expired';
  return page(
    env,
    'Subscription',
    `${steps('billing')}<div class="card"><h1>${lapsed ? 'Restart your subscription' : 'Set up your subscription'}</h1>${note === 'cancel' ? msg('Checkout was cancelled; nothing was charged.', 'info') : ''}${st === 'incomplete' ? msg('Your last payment needs attention. Start checkout again or contact your bank.', 'info') : ''}
<p>${priceGbp(env) ? esc(`£${priceGbp(env)} a month per active user. ${vatNote(env)}`.trim()) : 'Monthly, per active user, plus VAT where applicable.'} You have <b>${users}</b> user${users === 1 ? '' : 's'}; the subscription adjusts automatically as you add or remove people, with a proportionate charge or credit.</p>
<p>Payment is taken by Stripe on their secure page: your card details never pass through this site.</p>
<form method="post" action="/billing/checkout"><button type="submit">Continue to payment</button></form></div>`,
    u
  );
}
export async function checkout(req, env, M, u, url) {
  if (!u || M !== 'POST') return redirect('/login');
  if (u.role !== 'admin') return redirect('/billing');
  const ns = await nextStep(env, u);
  if (ns && ns !== '/billing') return redirect(ns);
  if (!ns) return redirect('/account'); // already subscribed: never start a second subscription
  if (await tooMany(env, 'checkout:' + u.company_id, 10, 60)) return redirect('/billing');
  let cus = u.stripe_customer;
  if (!cus) {
    cus = (
      await stripe(env, 'POST', 'customers', {
        email: u.email,
        name: u.company_name,
        metadata: { company_id: u.company_id },
      })
    ).id;
    const w = await env.DB.prepare('UPDATE companies SET stripe_customer = ? WHERE id = ? AND stripe_customer IS NULL')
      .bind(cus, u.company_id)
      .run();
    if (!(w.meta && w.meta.changes))
      cus = (await env.DB.prepare('SELECT stripe_customer FROM companies WHERE id = ?').bind(u.company_id).first())
        .stripe_customer; // another tab got there first
  }
  const subs = await stripe(env, 'GET', 'subscriptions', { customer: cus, status: 'all', limit: 20 });
  const live = (subs.data || []).find(x => ACTIVE.has(x.status));
  if (live) {
    await applySubscription(env, live, u.company_id);
    return redirect('/account');
  } // paid in another tab, webhook not here yet
  const open = await stripe(env, 'GET', 'checkout/sessions', { customer: cus, status: 'open', limit: 1 });
  if (open.data && open.data[0] && open.data[0].url) return redirect(open.data[0].url);
  const qty = Math.max(1, await activeUsers(env, u.company_id));
  // a free trial once per email domain (and once per company), so closing and re-opening doesn't start another
  let trial = +env.TRIAL_DAYS > 0 ? +env.TRIAL_DAYS : 0;
  if (trial) {
    const dom = workDomain(u.email) || u.email;
    if (u.stripe_sub || (await env.DB.prepare('SELECT 1 FROM trials WHERE domain = ?').bind(dom).first())) trial = 0; // recorded once the trial starts (applySubscription)
  }
  const params = {
    mode: 'subscription',
    client_reference_id: u.company_id,
    line_items: { 0: { price: env.STRIPE_PRICE_ID, quantity: qty } },
    success_url: `${url.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${url.origin}/billing?m=cancel`,
    subscription_data: { metadata: { company_id: u.company_id }, trial_period_days: trial || undefined },
    automatic_tax: env.STRIPE_AUTOMATIC_TAX === '1' ? { enabled: 'true' } : undefined,
    tax_id_collection: { enabled: 'true' },
    billing_address_collection: 'required',
    allow_promotion_codes: env.STRIPE_PROMO_CODES === '1' ? 'true' : undefined,
    metadata: { company_id: u.company_id },
    customer: cus,
    customer_update: { name: 'auto', address: 'auto' },
  };
  const s = await stripe(env, 'POST', 'checkout/sessions', params);
  return redirect(s.url);
}
export async function billingSuccess(env, u, url) {
  if (!u) return redirect('/login');
  // the webhook is the authority, but confirm straight away so the customer isn't left waiting for it
  const id = url.searchParams.get('session_id');
  if (id && /^cs_[A-Za-z0-9_]+$/.test(id)) {
    try {
      const s = await stripe(env, 'GET', `checkout/sessions/${id}`, { 'expand[]': 'subscription' });
      if (s.client_reference_id === u.company_id && s.subscription && typeof s.subscription === 'object')
        await applySubscription(env, s.subscription, u.company_id);
    } catch (e) {
      console.error(e);
    }
  }
  const c = await env.DB.prepare('SELECT sub_status FROM companies WHERE id = ?').bind(u.company_id).first();
  if (ACTIVE.has(c.sub_status)) return redirect('/app?welcome=1');
  return page(
    env,
    'Payment processing',
    `${steps('billing')}<div class="card"><h1>Payment processing</h1><p>Stripe is confirming your payment. This page will move on by itself.</p></div>`,
    u,
    200,
    '<meta http-equiv="refresh" content="3">'
  );
}
export async function portal(env, M, u, url) {
  if (!u || M !== 'POST' || u.role !== 'admin' || !u.stripe_customer) return redirect('/account');
  const s = await stripe(env, 'POST', 'billing_portal/sessions', {
    customer: u.stripe_customer,
    return_url: `${url.origin}/account`,
  });
  return redirect(s.url);
}
// an invoice's subscription: on older API versions invoice.subscription, on newer ones (the webhook endpoint's own
// version decides) invoice.parent.subscription_details.subscription
export const invoiceSub = o => {
  const v = o.subscription || (o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription);
  return typeof v === 'string' ? v : v && v.id;
};
export async function webhook(req, env) {
  const raw = await readBody(req, 1000000);
  if (!raw) return tooLarge();
  const body = new TextDecoder().decode(raw);
  if (!(await verifyStripe(env, body, req.headers.get('Stripe-Signature'))))
    return new Response('Bad signature', { status: 400 });
  const ev = JSON.parse(body);
  if (await env.DB.prepare('SELECT 1 FROM stripe_events WHERE id = ?').bind(ev.id).first())
    return json({ ok: true, duplicate: true });
  const o = ev.data && ev.data.object;
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
    const sub = await stripe(env, 'GET', `subscriptions/${o.subscription}`);
    await applySubscription(env, sub, o.client_reference_id);
  } else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(ev.type)) {
    // events can arrive late or out of order: fetch the subscription as it is now
    await applySubscription(
      env,
      await stripe(env, 'GET', `subscriptions/${o.id}`),
      o.metadata && o.metadata.company_id
    );
  } else if (ev.type === 'invoice.payment_failed' && invoiceSub(o)) {
    try {
      await applySubscription(env, await stripe(env, 'GET', `subscriptions/${invoiceSub(o)}`));
    } catch (e) {
      console.error('stripe: could not refresh subscription ' + invoiceSub(o) + ' after ' + ev.type + ': ' + e.message);
    }
  } else if (ev.type === 'customer.deleted' && o.id) {
    await env.DB.prepare(
      "UPDATE companies SET stripe_customer = NULL, stripe_sub = NULL, stripe_item = NULL, sub_status = 'canceled', seats_paid = 0, domain = NULL WHERE stripe_customer = ?"
    )
      .bind(o.id)
      .run();
  } else if (ev.type === 'charge.dispute.created') {
    const c =
      o.charge &&
      (await env.DB.prepare('SELECT name FROM companies WHERE stripe_customer = ?')
        .bind(o.customer || '')
        .first());
    console.error(`DISPUTE ${o.id} on ${o.charge} (${(o.amount || 0) / 100} ${o.currency || ''}) ${c ? c.name : ''}`);
    for (const to of (env.ADMIN_EMAILS || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)) {
      try {
        await sendEmail(
          env,
          to,
          'Stripe dispute opened',
          `A payment dispute was opened: ${o.id}, ${(o.amount || 0) / 100} ${(o.currency || '').toUpperCase()}${c ? ', customer ' + c.name : ''}. Respond in the Stripe dashboard before the deadline.`
        );
      } catch (e) {
        console.error('dispute email: ' + e.message);
      }
    }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)')
    .bind(ev.id, ev.type, now())
    .run();
  return json({ ok: true });
}
