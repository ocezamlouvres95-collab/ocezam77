import { parisNow } from './util.js';

export const ACTIVE = ['NOUVELLE', 'EN_PREPARATION', 'PRETE'];
export const STATUSES = ['ATTENTE_PAIEMENT', 'NOUVELLE', 'EN_PREPARATION', 'PRETE', 'LIVREE', 'ANNULEE'];
export const rowToOrder = r => ({ ...r, lines: JSON.parse(r.lines || '[]'), paid: !!r.paid, printed: !!r.printed });

export const LOYALTY_MIN_PREV_ORDERS = 4; // au-delà de 4 commandes précédentes validées (>= 4)
export const LOYALTY_MIN_SPENT_CENTS = 12000; // 120,00 € cumulés
export const LOYALTY_RATE_PCT = 2;

export async function activate(env, id) {
  const cur = await env.DB.prepare('SELECT num FROM orders WHERE id=?').bind(id).first();
  if (!cur || cur.num) return;
  const { day, hour } = parisNow();
  const r = await env.DB.prepare('INSERT INTO counters(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1 RETURNING n').bind(day).first();
  await env.DB.prepare('UPDATE orders SET num=?, day=?, hour=?, ts=? WHERE id=? AND num IS NULL').bind(r.n, day, hour, Date.now(), id).run();
}

export async function markPaid(env, id, method) {
  const now = Date.now();
  const r = await env.DB.prepare("UPDATE orders SET paid=1, paid_at=?, pay_method=?, updated=?, status=CASE WHEN status='ATTENTE_PAIEMENT' THEN 'NOUVELLE' ELSE status END WHERE id=? AND paid=0 AND status!='ANNULEE'").bind(now, method, now, id).run();
  if (r.meta.changes === 1) await activate(env, id);
  return r.meta.changes === 1;
}

export async function getLoyaltyEligibility(db, customer) {
  if (!customer || !customer.email) {
    return { eligible: false, ratePct: LOYALTY_RATE_PCT, label: `Fidélité -${LOYALTY_RATE_PCT}%`, prevCount: 0, spentCents: 0 };
  }

  const stats = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS spent_cents
       FROM orders
       WHERE status NOT IN ('ANNULEE', 'ATTENTE_PAIEMENT')
         AND customer_email IS NOT NULL
         AND lower(customer_email) = lower(?)`
    )
    .bind(String(customer.email).trim())
    .first()
    .catch(() => null);

  const prevCount = Number(stats?.cnt || 0);
  const spentCents = Number(stats?.spent_cents || 0);

  return {
    eligible: prevCount > LOYALTY_MIN_PREV_ORDERS && spentCents >= LOYALTY_MIN_SPENT_CENTS,
    ratePct: LOYALTY_RATE_PCT,
    label: `Fidélité -${LOYALTY_RATE_PCT}%`,
    prevCount,
    spentCents
  };
}