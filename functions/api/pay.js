import { json, ensureDb, rateHit, clientIp } from '../lib/util.js';
import { stripeOn, createSession } from '../lib/stripe.js';
export async function onRequestPost({ request, env }) {
  await ensureDb(env);
  if (!stripeOn(env)) return json({ ok: false, error: 'Paiement en ligne indisponible' }, 400);
  if (await rateHit(env, 'pay:' + clientIp(request), 600000, 10)) return json({ ok: false, error: 'Trop de tentatives' }, 429);
  const b = await request.json().catch(() => ({}));
  const o = await env.DB.prepare('SELECT id,token,total,status,paid FROM orders WHERE token=?').bind(String(b.k || '')).first();
  if (!o || o.paid || o.status === 'ANNULEE') return json({ ok: false, error: 'Commande non payable' }, 400);
  try { const s = await createSession(env, o, new URL(request.url).origin); await env.DB.prepare('UPDATE orders SET stripe_session=? WHERE id=?').bind(s.id, o.id).run(); return json({ ok: true, url: s.url }); }
  catch (e) { return json({ ok: false, error: e.message }, 502); }
}
