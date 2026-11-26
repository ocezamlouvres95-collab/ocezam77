import { json, ensureDb, loadAll, parisNow } from '../lib/util.js';
import { promoWindow } from '../lib/pricing.js';
import { stripeOn } from '../lib/stripe.js';
import { hoursState } from '../lib/hours.js';
export async function onRequestGet({ env }) {
  await ensureDb(env);
  const { catalog, settings: s, promos } = await loadAll(env);
  const now = parisNow(), cats = catalog.cats.filter(c => c.on !== false), ids = new Set(cats.map(c => c.id));
  const hs = hoursState(s.hours, now), open = !!s.open && hs.orderOpen;
  const closedMsg = !s.open ? s.closedMsg : (s.closedMsg + ' ' + (hs.today.on ? 'Horaires du jour : ' + hs.today.order.map(r => r[0].replace(':', 'h') + '–' + r[1].replace(':', 'h')).join(' · ') + '.' : "Fermé aujourd'hui.") + (hs.nextText ? ' ' + hs.nextText : '')).trim();
  const items = catalog.items.filter(i => i.on !== false && ids.has(i.c)).sort((a, b) => (a.s || 0) - (b.s || 0));
  return json({ ok: true, cats, lists: catalog.lists, items,
    promos: promos.filter(p => !p.code && p.banner && promoWindow(p, now)).map(p => ({ n: p.n, d: p.d, color: p.color || 'jaune', emoji: p.emoji || '', flash: !!p.flash, type: p.type, value: p.value, scope: p.scope, t: p.t || [], min: p.min || 0 })),
    shop: { name: s.name, address: s.address, phone: s.phone, whatsapp: s.whatsapp, open, closedMsg, prep: s.prep,
      hours: { auto: hs.auto, delivery: hs.delivery, prepMin: hs.prepMin, lines: hs.lines, pickupToday: hs.today.pickup, nowHm: now.hm }, fee: s.fee, freeFeeFrom: s.freeFeeFrom, minDelivery: s.minDelivery, payOnline: s.payOnline && stripeOn(env), payOnSite: s.payOnSite, zones: (s.zones || []).map(z => ({ n: z.n, cp: z.cp, min: z.min })) } });
}
