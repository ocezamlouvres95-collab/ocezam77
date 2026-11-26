import { json } from '../../lib/util.js';
const OK = ['image/jpeg', 'image/png', 'image/webp'];
export async function onRequestPost({ request, env }) {
  const id = new URL(request.url).searchParams.get('id') || '', ct = (request.headers.get('content-type') || '').split(';')[0];
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(id) || !OK.includes(ct)) return json({ ok: false, error: 'Image invalide (JPEG, PNG ou WebP)' }, 400);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > 600000) return json({ ok: false, error: 'Image trop lourde (max 600 Ko)' }, 413);
  let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  const ts = Date.now();
  await env.DB.prepare('INSERT INTO images(id,ct,data,ts) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET ct=excluded.ct,data=excluded.data,ts=excluded.ts').bind(id, ct, btoa(s), ts).run();
  return json({ ok: true, v: ts });
}
export async function onRequestDelete({ request, env }) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(id)) return json({ ok: false }, 400);
  await env.DB.prepare('DELETE FROM images WHERE id=?').bind(id).run();
  return json({ ok: true });
}
