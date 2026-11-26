import { json, parisNow } from '../../lib/util.js';
import { rowToOrder, activate, markPaid, STATUSES, ACTIVE } from '../../lib/orders.js';
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), q = (u.searchParams.get('q') || '').trim().slice(0, 40), today = parisNow().day;
  let r;
  if (q) { const like = '%' + q.replace(/[%_]/g, '') + '%'; r = await env.DB.prepare('SELECT * FROM orders WHERE prenom LIKE ? OR telephone LIKE ? OR num=? ORDER BY ts DESC LIMIT 100').bind(like, like, parseInt(q) || -1).all(); }
  else { const day = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('day') || '') ? u.searchParams.get('day') : today;
    r = await env.DB.prepare(`SELECT * FROM orders WHERE day=? OR status IN ('NOUVELLE','EN_PREPARATION','PRETE') ORDER BY ts DESC LIMIT 400`).bind(day).all(); }
  return json({ ok: true, today, now: Date.now(), orders: r.results.map(rowToOrder) });
}
export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const o = await env.DB.prepare('SELECT id,status,paid,num FROM orders WHERE id=?').bind(String(b.id || '')).first();
  if (!o) return json({ ok: false, error: 'Commande introuvable' }, 404);
  const now = Date.now();
  if (b.action === 'status') {
    if (!STATUSES.includes(b.status) || b.status === 'ATTENTE_PAIEMENT') return json({ ok: false, error: 'Statut invalide' }, 400);
    await env.DB.prepare('UPDATE orders SET status=?, updated=? WHERE id=?').bind(b.status, now, o.id).run();
    if (ACTIVE.includes(b.status) || b.status === 'LIVREE') await activate(env, o.id);
  } else if (b.action === 'pay') {
    const m = ['ESPECES', 'CB', 'TICKET_RESTO', 'AUTRE'].includes(b.method) ? b.method : 'ESPECES';
    if (b.paid === false) await env.DB.prepare("UPDATE orders SET paid=0, paid_at=NULL, pay_method=NULL, updated=? WHERE id=? AND (pay_method IS NULL OR pay_method!='CARTE')").bind(now, o.id).run();
    else if (o.paid) await env.DB.prepare('UPDATE orders SET pay_method=?, updated=? WHERE id=?').bind(m, now, o.id).run();
    else await markPaid(env, o.id, m);
  } else if (b.action === 'printed') await env.DB.prepare('UPDATE orders SET printed=1 WHERE id=?').bind(o.id).run();
  else return json({ ok: false, error: 'Action inconnue' }, 400);
  return json({ ok: true, order: rowToOrder(await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first()) });
}
