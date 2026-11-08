// Files in R2: photos, drawings and office attachments, kept under co/<company>/... and served only to people of
// that company (and, for the crew, only for jobs sent to them). Files are written once and never overwritten.
import { hex } from '../lib/core.js';

export const PHOTO_MAX = 12 * 1024 * 1024; // phones send ~0.5 MB; leave room for an office upload
export const PDF_MAX = 25 * 1024 * 1024;
export async function sha256buf(buf) {
  return hex(await crypto.subtle.digest('SHA-256', buf));
}
// what the bytes really are (not what the request says)
export function sniff(u8) {
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8.length > 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[8] === 0x57 && u8[9] === 0x45) return 'image/webp';
  if (u8.length > 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'application/pdf';
  return null;
}
export const ext = mime =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[mime] || 'bin';
// put a file only if nothing is there yet (a retried upload keeps the first copy)
export async function putOnce(env, key, buf, mime) {
  const r = await env.FILES.put(key, buf, { httpMetadata: { contentType: mime }, onlyIf: { etagDoesNotMatch: '*' } });
  return r !== null;
}
// a drawing is a PDF (uploaded) or, sent from CAD WerX, the A3 sheets as one HTML page
export const drawingType = d => (String(d.pdf_key).endsWith('.html') ? 'text/html; charset=utf-8' : 'application/pdf');
export const drawingName = d =>
  `drawing-${String(d.rev).replace(/[^\w.-]/g, '_')}.${drawingType(d).startsWith('text/html') ? 'html' : 'pdf'}`;
export async function serve(env, key, mime, name) {
  const o = await env.FILES.get(key);
  if (!o) return new Response('Not found', { status: 404 });
  const type = mime || (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream';
  return new Response(o.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      // images: nothing in them can run; PDFs: left to the browser's own viewer (a sandbox would stop it opening);
      // drawing sheets from CAD WerX: shown, never run (no scripts, nothing fetched, only their own embedded images)
      ...(type.startsWith('image/') ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}),
      ...(type.startsWith('text/html')
        ? {
            'Content-Security-Policy':
              "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'; sandbox allow-modals",
          }
        : {}),
      ...(name ? { 'Content-Disposition': `inline; filename="${name.replace(/[^\w.-]+/g, '_')}"` } : {}),
    },
  });
}
