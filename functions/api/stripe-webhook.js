import { json, ensureDb } from '../lib/util.js';
import { verifySignature } from '../lib/stripe.js';
import { markPaid } from '../lib/orders.js';
import { sendOrderConfirmationEmail } from '../lib/mailer.js';

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (!(await verifySignature(env, raw, request.headers.get('stripe-signature')))) {
    return json({ ok: false }, 400);
  }
  await ensureDb(env);
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ ok: false }, 400);
  }

  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const s = ev.data.object;
    const id = s.client_reference_id || (s.metadata && s.metadata.order_id);
    if (id && s.payment_status === 'paid') {
      const o = await env.DB.prepare(
        'SELECT id, num, paid, mode, prenom, customer_email, slot_time, heure, remarque, lines, total FROM orders WHERE id=?'
      )
        .bind(id)
        .first();

      if (o && o.total === s.amount_total && s.currency === 'eur') {
        const wasUnpaid = Number(o.paid || 0) === 0;
        await markPaid(env, id, 'CARTE');

        if (wasUnpaid) {
          const updatedOrder = await env.DB.prepare(
            'SELECT id, num, mode, prenom, customer_email, slot_time, heure, remarque, lines, total FROM orders WHERE id=?'
          )
            .bind(id)
            .first();

          await sendOrderConfirmationEmail(env, updatedOrder || o).catch(() => {});
        }
      }
    }
  }

  return json({ ok: true });
}