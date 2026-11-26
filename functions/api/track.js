import { json, ensureDb, loadAll } from '../lib/util.js';
import { markPaid } from '../lib/orders.js';
import { stripeOn, getSession } from '../lib/stripe.js';
import { sendOrderConfirmationEmail } from '../lib/mailer.js';

export async function onRequestGet({ request, env }) {
  await ensureDb(env);
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!/^[a-z0-9]{16}$/.test(k)) return json({ ok: false, error: 'Lien invalide' }, 400);
  let o = await env.DB.prepare('SELECT * FROM orders WHERE token=?').bind(k).first();
  if (!o) return json({ ok: false, error: 'Commande introuvable' }, 404);

  if (o.status === 'ATTENTE_PAIEMENT' && o.stripe_session && stripeOn(env)) {
    const s = await getSession(env, o.stripe_session);
    if (s && s.payment_status === 'paid' && s.amount_total === o.total && s.currency === 'eur') {
      const wasUnpaid = Number(o.paid || 0) === 0;
      await markPaid(env, o.id, 'CARTE');
      o = await env.DB.prepare('SELECT * FROM orders WHERE token=?').bind(k).first();
      if (o && wasUnpaid) {
        await sendOrderConfirmationEmail(env, o).catch(() => {});
      }
    }
  }

  const { settings } = await loadAll(env);
  return json({
    ok: true,
    num: o.num,
    status: o.status,
    paid: !!o.paid,
    pay: o.pay_pref,
    mode: o.mode,
    heure: o.heure,
    ts: o.ts,
    total: o.total,
    discount: o.discount,
    fee: o.fee,
    promo: o.promo,
    lines: JSON.parse(o.lines).map(l => ({
      label: l.label,
      qty: l.qty,
      detail: [...(l.inc || []), ...(l.detail || [])].join(' · '),
      total: l.total
    })),
    shop: { name: settings.name, phone: settings.phone, whatsapp: settings.whatsapp, prep: settings.prep }
  });
}