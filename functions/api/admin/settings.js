import { json, loadAll, kvSet } from '../../lib/util.js';
import { sanitizeSettings } from '../../lib/catalog.js';
import { stripeOn } from '../../lib/stripe.js';
export async function onRequestGet({ env }) { return json({ ok: true, settings: (await loadAll(env)).settings, stripe: { key: stripeOn(env), webhook: !!env.STRIPE_WEBHOOK_SECRET } }); }
export async function onRequestPut({ request, env }) {
  try { const s = sanitizeSettings((await request.json()).settings || {}); await kvSet(env, 'settings', s); return json({ ok: true, settings: s }); } catch (e) { return json({ ok: false, error: e.message }, 400); }
}
