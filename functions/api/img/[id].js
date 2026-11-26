export async function onRequestGet({ params, env }) {
  const id = String(params.id || '');
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(id) || !env.DB) return new Response('not found', { status: 404 });
  let r; try { r = await env.DB.prepare('SELECT ct,data FROM images WHERE id=?').bind(id).first(); } catch { r = null; }
  if (!r) return new Response('not found', { status: 404 });
  const bin = atob(r.data), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Response(u, { headers: { 'content-type': r.ct, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
