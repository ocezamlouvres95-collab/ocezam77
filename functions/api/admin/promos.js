import { json, loadAll, kvSet } from '../../lib/util.js';
import { sanitizePromos } from '../../lib/catalog.js';
export async function onRequestGet({ env }) { return json({ ok: true, promos: (await loadAll(env)).promos }); }
export async function onRequestPut({ request, env }) {
  try { const p = sanitizePromos((await request.json()).promos); await kvSet(env, 'promos', p); return json({ ok: true, promos: p }); } catch (e) { return json({ ok: false, error: e.message }, 400); }
}
