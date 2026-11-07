// Shared helpers for TM WerX: ids, JSON bodies, who may use what, company settings, the office log and alerts.
import { nextStep } from '../auth.js';
import { ACTIVE, json, now, readBody } from '../lib/core.js';

export const uid = () => crypto.randomUUID();
export const OFFICE = new Set(['admin', 'office']);
export const CREW = new Set(['lead', 'engineer']);
export const bad = (m, status = 400) => json({ ok: false, error: m }, status);
export const ok = (o = {}) => json(Object.assign({ ok: true }, o));
export const today = () => new Date().toISOString().slice(0, 10);
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const str = (v, max = 500) =>
  v == null
    ? null
    : String(v)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .trim()
        .slice(0, max) || null;
export const int = (v, min = -1e12, max = 1e12) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
export const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
export const pj = (s, d) => {
  try {
    return s == null ? d : JSON.parse(s);
  } catch (e) {
    return d;
  }
};
export async function body(req, max = 300000) {
  const b = await readBody(req, max);
  if (!b) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b) || '{}');
  } catch (e) {
    return null;
  }
}

/* ---------- who may use what ---------- */
// office web app: administrators and office users of a signed-up, paying company that has signed the agreement
export async function officeUser(env, u) {
  if (!u || !OFFICE.has(u.role)) return null;
  if (await nextStep(env, u)) return null;
  return u;
}
// crew app: crew logins of a paying company whose administrator has signed the current agreement
export function crewUser(u) {
  if (!u || !CREW.has(u.role) || u.disabled) return null;
  if (!ACTIVE.has(u.sub_status) || !u.adm_ok) return null;
  return u;
}

/* ---------- company settings ---------- */
export const DEFAULT_SETTINGS = {
  week_start: 1, // 1 = Monday ... 6 = Saturday (weekly totals and the board)
  pending_limit_hours: 2, // items waiting on a phone longer than this alert the office
  late_photo_hours: 12, // a photo taken on time counts as on time if it arrives within this
  spares_pct: 10, // added to the drawing's equipment list
  mandatory_items: [], // equipment codes a crew cannot start without
  start_requires: ['ra_signoff', 'risk_check'], // steps that must be done before Start
  allow_gallery: false, // let crews pick photos from the gallery (each one is marked as such)
  geofence_m: 300, // signing in further than this from the site asks for a reason and tells the office
  lone_every_mins: 60, // lone working check-in interval
  week_hours_limit: 48, // working-time warning, hours in a week
  day_hours_limit: 13, // working-time warning, hours in a day
  retention_years: 6, // job records and photos
  cadwerx_link: '', // the link code a CAD WerX administrator made for this company
};
export async function settings(env, cid) {
  const r = await env.DB.prepare('SELECT data FROM tm_settings WHERE company_id = ?').bind(cid).first();
  return Object.assign({}, DEFAULT_SETTINGS, pj(r && r.data, {}));
}

/* ---------- the office log and alerts ---------- */
export const logStmt = (env, u, action, ref, detail) =>
  env.DB.prepare('INSERT INTO tm_log (company_id, user_id, action, ref, detail, at) VALUES (?, ?, ?, ?, ?, ?)').bind(
    u.company_id,
    u.id,
    action,
    ref || null,
    detail == null ? null : typeof detail === 'string' ? detail.slice(0, 2000) : JSON.stringify(detail).slice(0, 2000),
    now()
  );
export const log = (env, u, action, ref, detail) => logStmt(env, u, action, ref, detail).run();

// one open alert per (kind, ref): raising it again only refreshes it; returns true when it is new
export async function raiseAlert(env, a) {
  const r = await env.DB.prepare(
    `INSERT INTO tm_alerts (id, company_id, kind, ref, job_id, user_id, level, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (company_id, kind, ref) DO UPDATE SET level = excluded.level, title = excluded.title, detail = excluded.detail,
       created_at = CASE WHEN tm_alerts.ack_at IS NOT NULL THEN excluded.created_at ELSE tm_alerts.created_at END,
       ack_at = NULL, ack_by = NULL
     WHERE tm_alerts.ack_at IS NOT NULL OR tm_alerts.level <> excluded.level OR tm_alerts.title <> excluded.title`
  )
    .bind(
      uid(),
      a.company_id,
      a.kind,
      a.ref || '-',
      a.job_id || null,
      a.user_id || null,
      a.level || 'warn',
      String(a.title).slice(0, 200),
      a.detail ? String(a.detail).slice(0, 1000) : null,
      now()
    )
    .run();
  return !!(r.meta && r.meta.changes);
}
export const clearAlert = (env, cid, kind, ref) =>
  env.DB.prepare(
    'UPDATE tm_alerts SET ack_at = ?, ack_by = ? WHERE company_id = ? AND kind = ? AND ref = ? AND ack_at IS NULL'
  )
    .bind(now(), 'system', cid, kind, ref)
    .run();

// distance in metres between two points
export function metres(a, b) {
  const R = 6371000,
    r = x => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat),
    dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// a job number like TM-2611-0042: year and month, then a running number for the company
export async function nextJobNumber(env, cid) {
  const ym = new Date().toISOString().slice(2, 7).replace('-', '');
  const r = await env.DB.prepare(
    'SELECT number FROM tm_jobs WHERE company_id = ? AND number LIKE ? ORDER BY number DESC LIMIT 1'
  )
    .bind(cid, `TM-${ym}-%`)
    .first();
  const n = r ? parseInt(r.number.split('-')[2], 10) + 1 : 1;
  return `TM-${ym}-${String(n).padStart(4, '0')}`;
}
