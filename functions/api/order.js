import { json, clean, rid, parisNow, ensureDb, loadAll, rateHit, clientIp } from '../lib/util.js';
import { quote } from '../lib/pricing.js';
import { checkDeliveryZone, findZone } from '../lib/geo.js';
import { activate, getLoyaltyEligibility } from '../lib/orders.js';
import { stripeOn, createSession } from '../lib/stripe.js';
import { hoursState, pickupOk } from '../lib/hours.js';
import { isValidEmail, sendOrderConfirmationEmail } from '../lib/mailer.js';
import { getAuthenticatedCustomer } from '../lib/customer-auth.js';

export async function onRequestPost({ request, env }) {
  await ensureDb(env);
  const raw = await request.text();
  if (raw.length > 60000) return json({ ok: false, error: 'Requête trop volumineuse' }, 413);
  let b;
  try {
    b = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'Requête invalide' }, 400);
  }
  if (b.website) return json({ ok: true, token: 'x' });

  const { catalog, settings, promos } = await loadAll(env);
  const now = parisNow(), hs = hoursState(settings.hours, now);
  if (!settings.open) return json({ ok: false, error: settings.closedMsg || 'Commandes fermées.' }, 403);
  if (!hs.orderOpen) {
    return json({
      ok: false,
      closed: true,
      error: ((settings.closedMsg || 'Commandes fermées.') + ' ' + (hs.today.on
        ? 'Horaires du jour : ' + hs.today.order.map(r => r[0].replace(':', 'h') + '–' + r[1].replace(':', 'h')).join(' · ') + '.'
        : "Fermé aujourd'hui.") + ' ' + hs.nextText).trim()
    }, 403);
  }
  if (b.mode === 'LIVRAISON' && !hs.delivery) {
    return json({ ok: false, error: 'Livraison indisponible : enlèvement uniquement.' }, 400);
  }

  const want = String(b.heure_souhaitee || b.slot_time || '').trim();
  const mt = want.match(/^(\d{1,2})\s*[h:]\s*(\d{2})$/i);
  let normalizedSlot = clean(want, 30) || 'Dès que possible';

  if (mt && hs.auto) {
    const hm = String(mt[1]).padStart(2, '0') + ':' + mt[2];
    if (!pickupOk(settings.hours, now, hm)) {
      return json({
        ok: false,
        error: "Heure d'enlèvement hors horaires : " + (hs.today.pickup.length
          ? hs.today.pickup.map(r => r[0].replace(':', 'h') + '–' + r[1].replace(':', 'h')).join(' · ')
          : "fermé aujourd'hui") + '.'
      }, 400);
    }
    if (hm < now.hm) return json({ ok: false, error: "Cette heure d'enlèvement est déjà passée." }, 400);
    normalizedSlot = hm;
  }

  const customer = await getAuthenticatedCustomer(env.DB, request).catch(() => null);
  const loyalty = await getLoyaltyEligibility(env.DB, customer).catch(() => null);

  const zone = findZone(settings, b.commune);
  const qSettings = zone && zone.min != null ? { ...settings, minDelivery: zone.min } : settings;
  const q = quote({ catalog, promos, settings: qSettings, loyalty }, b, now);
  if (!q.ok) return json(q, 400);

  const mode = q.mode;
  const adresse = mode === 'LIVRAISON' ? clean(b.adresse, 120) : '';
  const cp = mode === 'LIVRAISON' ? clean(b.code_postal, 10) : '';

  let geoCheck = null;
  if (mode === 'LIVRAISON' && (adresse || !b.dry)) {
    if (!adresse) return json({ ok: false, error: 'Adresse de livraison manquante' }, 400);
    geoCheck = checkDeliveryZone(adresse, b.commune, settings);
    if (!geoCheck.ok) {
      return json({ ok: false, error: geoCheck.error, outOfZone: true }, 400);
    }
  }

  if (b.dry) {
    return json({
      ok: true,
      subtotal: q.subtotal,
      discount: q.discount,
      promo: q.promo && q.promo.n,
      loyaltyApplied: !!q.loyaltyApplied,
      fee: q.fee,
      deliveryDetail: q.deliveryDetail,
      total: q.total,
      codeMsg: q.codeMsg
    });
  }

  if (await rateHit(env, 'ord:' + clientIp(request), 600000, 6)) {
    return json({ ok: false, error: 'Trop de commandes, réessayez dans quelques minutes.' }, 429);
  }

  const prenom = clean(b.prenom || customer?.first_name || '', 40);
  const tel = clean(b.telephone || customer?.phone || '', 20);
  const customerEmail = clean(b.customer_email || b.email || customer?.email || '', 120).toLowerCase();

  if (!prenom || !/^[0-9 +().-]{6,20}$/.test(tel)) {
    return json({ ok: false, error: 'Nom ou téléphone invalide' }, 400);
  }
  if (!isValidEmail(customerEmail)) {
    return json({ ok: false, error: 'Adresse e-mail obligatoire et valide' }, 400);
  }
  if (mode === 'LIVRAISON' && !adresse) {
    return json({ ok: false, error: 'Adresse de livraison manquante' }, 400);
  }

  const card = b.pay === 'CARTE';
  if (card && !(stripeOn(env) && settings.payOnline)) {
    return json({ ok: false, error: 'Paiement en ligne indisponible' }, 400);
  }
  if (!card && !settings.payOnSite) {
    return json({ ok: false, error: 'Le paiement sur place est désactivé : payez par carte.' }, 400);
  }

  const id = 'o' + rid(10), token = rid(16), ts = Date.now();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO orders(id,token,num,day,hour,ts,updated,status,mode,prenom,telephone,adresse,code_postal,heure,slot_time,customer_email,remarque,lines,subtotal,discount,fee,total,promo,pay_pref,paid,printed)
       VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)`
    ).bind(
      id,
      token,
      now.day,
      now.hour,
      ts,
      ts,
      card ? 'ATTENTE_PAIEMENT' : 'NOUVELLE',
      mode,
      prenom,
      tel,
      adresse,
      cp,
      normalizedSlot,
      normalizedSlot,
      customerEmail,
      clean(b.remarque, 150),
      JSON.stringify(q.lines),
      q.subtotal,
      q.discount,
      q.fee,
      q.total,
      q.promo ? q.promo.n : null,
      card ? 'CARTE' : 'SUR_PLACE'
    )
  ];

  for (const l of q.lines) {
    stmts.push(
      env.DB.prepare('INSERT INTO lines_stat(order_id,item_id,name,cat,qty,total) VALUES(?,?,?,?,?,?)')
        .bind(id, l.id, l.label, l.cat, l.qty, l.total)
    );
  }

  await env.DB.batch(stmts);

  if (Math.random() < 0.01) {
    env.DB.prepare(
      "UPDATE orders SET prenom='Anonymisé', telephone='', adresse='', code_postal='', customer_email='', remarque='' WHERE ts<? AND telephone!=''"
    ).bind(Date.now() - 3 * 365 * 864e5).run().catch(() => {});
  }

if (!card) {
    await activate(env, id);
    const o = await env.DB.prepare('SELECT id, num, mode, prenom, customer_email, slot_time, heure, lines, total FROM orders WHERE id=?')
      .bind(id)
      .first();

    await sendOrderConfirmationEmail(env, o).catch(() => {});

    return json({ ok: true, token, num: o && o.num, total: q.total });
  }

  try {
    const s = await createSession(env, { id, token, total: q.total }, new URL(request.url).origin);
    await env.DB.prepare('UPDATE orders SET stripe_session=? WHERE id=?').bind(s.id, id).run();
    return json({ ok: true, token, url: s.url, total: q.total });
  } catch (e) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM lines_stat WHERE order_id=?').bind(id),
      env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id)
    ]);
    return json({ ok: false, error: 'Paiement indisponible : ' + e.message }, 502);
  }
}