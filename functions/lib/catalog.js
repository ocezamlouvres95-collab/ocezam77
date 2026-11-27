import { clean, num } from './util.js';
import { sanitizeHours } from './hours.js';
const id = (s, d) => String(s ?? d ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
const choices = a => (Array.isArray(a) ? a : []).slice(0, 200).map(c => ({ n: clean(c.n, 60), p: Math.max(0, Math.min(99, num(c.p))) })).filter(c => c.n);
export function sanitizeCatalog(c) {
  if (!c || !Array.isArray(c.cats) || !Array.isArray(c.items)) throw new Error('Catalogue invalide');
  const cats = c.cats.slice(0, 60).map((x, i) => ({ id: id(x.id, 'c' + i), n: clean(x.n, 50), on: x.on !== false })).filter(x => x.id && x.n);
  const catIds = new Set(cats.map(x => x.id)), lists = {};
  for (const [k, v] of Object.entries(c.lists || {}).slice(0, 40)) { const lk = id(k); if (lk) lists[lk] = { n: clean(v.n, 50), ch: choices(v.ch) }; }
  const seen = new Set();
  const items = c.items.slice(0, 1500).map((i, k) => {
    const iid = id(i.id); if (!iid || seen.has(iid)) return null; seen.add(iid);
    if (!catIds.has(i.c)) return null;
    const groups = (Array.isArray(i.groups) ? i.groups : []).slice(0, 12).map((g, j) => {
      const single = g.type === 'single';
      const o = { id: id(g.id, 'g' + j), t: clean(g.t, 60), type: single ? 'single' : 'multi', min: Math.max(0, parseInt(g.min) || 0), max: Math.max(1, parseInt(g.max) || 99) };
      if (single) { o.min = Math.min(1, o.min); o.max = 1; } else o.min = Math.min(o.min, o.max);
      if (g.list && lists[id(g.list)]) o.list = id(g.list); else o.ch = choices(g.ch);
      if (Array.isArray(g.def)) o.def = g.def.map(x => clean(x, 60)).slice(0, 20);
      if (g.empty) o.empty = clean(g.empty, 40);
      return o;
    }).filter(g => g.t);
    return { id: iid, n: clean(i.n, 80), c: i.c, p: Math.max(0, Math.min(999, num(i.p))), d: clean(i.d, 300), inc: (Array.isArray(i.inc) ? i.inc : []).slice(0, 12).map(x => clean(x, 80)).filter(Boolean), on: i.on !== false, img: parseInt(i.img) || 0, imgUrl: /^(https:\/\/app\.eatandcollect\.fr\/[\w\-./%]+|\/img\/[\w\-]+\.png)$/.test(i.imgUrl || '') ? i.imgUrl : '', groups, s: parseInt(i.s) || k };
  }).filter(Boolean);
  return { v: 1, cats, lists, items };
}
export function sanitizePromos(a) {
  if (!Array.isArray(a)) throw new Error('Promotions invalides');
  const hm = s => (/^([01]\d|2[0-3]):[0-5]\d$/.test(s || '') ? s : ''), dt = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '');
  return a.slice(0, 100).map((p, i) => ({
    id: id(p.id, 'p' + i), n: clean(p.n, 60), d: clean(p.d, 160), on: p.on !== false, banner: !!p.banner,
    type: ['PERCENT', 'AMOUNT', 'FEEOFF', 'HIGHLIGHT'].includes(p.type) ? p.type : 'PERCENT', value: p.type === 'HIGHLIGHT' ? 0 : Math.max(0, Math.min(p.type === 'PERCENT' ? 100 : 999, num(p.value))),
    scope: ['CART', 'CAT', 'ITEM'].includes(p.scope) ? p.scope : 'CART', t: (Array.isArray(p.t) ? p.t : []).map(x => id(x)).slice(0, 200),
    code: clean(p.code, 30).toUpperCase().replace(/\s+/g, ''), min: Math.max(0, num(p.min)), from: dt(p.from), to: dt(p.to),
    days: (Array.isArray(p.days) ? p.days : []).map(Number).filter(d => d >= 0 && d <= 6), h1: hm(p.h1), h2: hm(p.h2),
    mode: ['ALL', 'LIVRAISON', 'A EMPORTER'].includes(p.mode) ? p.mode : 'ALL',
    color: ['jaune', 'orange', 'rouge', 'rose', 'vert', 'bleu', 'violet'].includes(p.color) ? p.color : 'jaune', emoji: clean(p.emoji, 4), flash: !!p.flash,
  })).filter(p => p.n);
}
export function sanitizeSettings(s) {
  const pr = s.printer || {};
  const freeFrom = s.freeDeliveryFrom != null ? num(s.freeDeliveryFrom) : (s.freeFeeFrom != null ? num(s.freeFeeFrom) : 0);
  return {
    name: clean(s.name, 60), address: clean(s.address, 120), phone: clean(s.phone, 25), whatsapp: clean(s.whatsapp, 20).replace(/\D/g, ''),
    open: !!s.open, closedMsg: clean(s.closedMsg, 160), prep: clean(s.prep, 40),
    fee: Math.max(0, Math.min(50, num(s.fee))),
    freeFeeFrom: Math.max(0, Math.min(500, freeFrom)),
    freeDeliveryFrom: Math.max(0, Math.min(500, freeFrom)),
    minDelivery: Math.max(0, Math.min(500, s.minDelivery != null ? num(s.minDelivery) : 0)),
    lowItemThreshold: Math.max(0.1, Math.min(100, s.lowItemThreshold != null ? num(s.lowItemThreshold) : 5)),
    under5Fee: Math.max(0, Math.min(50, s.under5Fee != null ? num(s.under5Fee) : 0)),
    over5Fee: Math.max(0, Math.min(50, s.over5Fee != null ? num(s.over5Fee) : 0)),
    maxDeliveryKm: Math.max(0.5, Math.min(50, s.maxDeliveryKm != null ? num(s.maxDeliveryKm) : 15)),
    deliveryZone: clean(s.deliveryZone ?? 'Chaumes-en-Brie et communes environnantes', 120),
    zones: (Array.isArray(s.zones) ? s.zones : []).slice(0, 80).map(z => ({ n: clean(z.n, 60), cp: clean(z.cp, 10), min: z.min == null || z.min === '' ? null : Math.max(0, Math.min(500, num(z.min))) })).filter(z => z.n),
    payOnline: !!s.payOnline, payOnSite: !!s.payOnSite,
    hours: sanitizeHours(s.hours),
    printer: { mode: pr.mode === 'browser' ? 'browser' : 'zebra', width: Math.max(200, Math.min(1000, parseInt(pr.width) || 576)), font: Math.max(18, Math.min(60, parseInt(pr.font) || 28)), copies: Math.max(1, Math.min(5, parseInt(pr.copies) || 1)), auto: !!pr.auto, tickets: pr.tickets === 'kitchen' ? 'kitchen' : 'both', header: clean(pr.header, 40), footer: clean(pr.footer, 80), device: clean(pr.device, 100) },
  };
}
