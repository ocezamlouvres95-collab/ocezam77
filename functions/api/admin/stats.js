import { json, loadAll, kvGetMany } from '../../lib/util.js';
import { aggregate } from '../../lib/stats.js';
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), re = /^\d{4}-\d{2}-\d{2}$/, from = u.searchParams.get('from') || '', to = u.searchParams.get('to') || from;
  if (!re.test(from) || !re.test(to) || from > to) return json({ ok: false, error: 'Dates invalides' }, 400);
  const [{ catalog }, kv, r, c] = await Promise.all([loadAll(env), kvGetMany(env, ['recipes']),
    env.DB.prepare("SELECT day,hour,mode,total,paid,pay_method,discount,promo,lines FROM orders WHERE day BETWEEN ?1 AND ?2 AND status NOT IN ('ANNULEE','ATTENTE_PAIEMENT') LIMIT 20000").bind(from, to).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM orders WHERE day BETWEEN ?1 AND ?2 AND status='ANNULEE'").bind(from, to).first()]);
  return json({ ok: true, from, to, cancelled: c.n, ...aggregate(r.results, catalog, kv.recipes) });
}
