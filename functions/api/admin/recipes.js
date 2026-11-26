import { json, kvGetMany, kvSet } from '../../lib/util.js';
import { sanitizeRecipes } from '../../lib/stats.js';
export async function onRequestGet({ env }) { const k = await kvGetMany(env, ['recipes']); return json({ ok: true, recipes: k.recipes || { mats: {}, items: {}, choices: {} } }); }
export async function onRequestPut({ request, env }) {
  try { const r = sanitizeRecipes((await request.json()).recipes || {}); await kvSet(env, 'recipes', r); return json({ ok: true, recipes: r }); } catch (e) { return json({ ok: false, error: e.message }, 400); }
}
