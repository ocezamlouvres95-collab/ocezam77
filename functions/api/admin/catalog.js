import { json, loadAll, kvSet } from '../../lib/util.js';
import { sanitizeCatalog } from '../../lib/catalog.js';
export async function onRequestGet({ env }) { return json({ ok: true, catalog: (await loadAll(env)).catalog }); }
export async function onRequestPut({ request, env }) {
  const raw = await request.text();
  if (raw.length > 1500000) return json({ ok: false, error: 'Catalogue trop volumineux' }, 413);
  try { const c = sanitizeCatalog(JSON.parse(raw).catalog); await kvSet(env, 'catalog', c); return json({ ok: true, catalog: c }); } catch (e) { return json({ ok: false, error: e.message }, 400); }
}
