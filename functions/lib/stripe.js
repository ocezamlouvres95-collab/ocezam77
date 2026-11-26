export const stripeOn = env => !!env.STRIPE_SECRET_KEY;
export async function createSession(env, order, origin) {
  if (order.total < 50) throw new Error('Montant minimum Stripe : 0,50 €');
  const p = new URLSearchParams();
  p.set('mode', 'payment'); p.set('locale', 'fr');
  p.set('success_url', `${origin}/suivi.html?t=${order.token}&paid=1`);
  p.set('cancel_url', `${origin}/suivi.html?t=${order.token}&cancel=1`);
  p.set('client_reference_id', order.id); p.set('metadata[order_id]', order.id);
  p.set('payment_intent_data[metadata][order_id]', order.id);
  p.set('expires_at', String(Math.floor(Date.now() / 1000) + 3600));
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'eur');
  p.set('line_items[0][price_data][unit_amount]', String(order.total));
  p.set('line_items[0][price_data][product_data][name]', 'Commande Ô Cezam 77');
  p.set('line_items[0][price_data][product_data][description]', 'Réf. ' + order.id.slice(-6).toUpperCase());
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() }, body: p });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Stripe ' + r.status);
  return { id: j.id, url: j.url };
}
export async function getSession(env, id) {
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY } });
  return r.ok ? r.json() : null;
}
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export async function verifySignature(env, raw, header) {
  const secret = env.STRIPE_WEBHOOK_SECRET; if (!secret || !header) return false;
  const parts = header.split(',').map(x => x.split('='));
  const t = (parts.find(x => x[0] === 't') || [])[1];
  const sigs = parts.filter(x => x[0] === 'v1').map(x => x[1]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const exp = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + raw)));
  return sigs.some(s => { if (s.length !== exp.length) return false; let d = 0; for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ exp.charCodeAt(i); return d === 0; });
}
