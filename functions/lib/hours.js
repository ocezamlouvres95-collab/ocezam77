/* Horaires : ouverture du restaurant, prise des commandes (passation) et enlèvement.
   Jours : 0 = dimanche … 6 = samedi. Heures "HH:MM" (heure de Paris). Deux plages par jour (midi / soir). */
export const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const SLOTS = [['11:30', '15:55'], ['18:10', '22:20']];
const mkDay = on => ({ on, open: SLOTS.map(s => s.slice()), order: SLOTS.map(s => s.slice()), pickup: SLOTS.map(s => s.slice()) });
export const DEFAULT_HOURS = {
  auto: false, delivery: true, prepMin: 20,
  days: { 0: mkDay(true), 1: mkDay(false), 2: mkDay(true), 3: mkDay(true), 4: mkDay(true), 5: mkDay(true), 6: mkDay(true) },
};
const T = s => (/^([01]\d|2[0-3]):[0-5]\d$/.test(s || '') ? s : '');
const ranges = (a, def) => [0, 1].map(i => {
  const r = Array.isArray(a) && Array.isArray(a[i]) ? a[i] : (a === undefined ? def[i] : ['', '']);
  const x = T(r[0]), y = T(r[1]);
  return x && y && x < y ? [x, y] : ['', ''];
});
export function sanitizeHours(h) {
  const src = h && typeof h === 'object' ? h : {};
  const out = {
    auto: src.auto === undefined ? DEFAULT_HOURS.auto : !!src.auto,
    delivery: src.delivery === undefined ? DEFAULT_HOURS.delivery : !!src.delivery,
    prepMin: Math.max(0, Math.min(180, parseInt(src.prepMin) >= 0 ? parseInt(src.prepMin) : DEFAULT_HOURS.prepMin)),
    days: {},
  };
  for (let d = 0; d < 7; d++) {
    const s = (src.days && src.days[d]) || null, def = DEFAULT_HOURS.days[d];
    out.days[d] = s
      ? { on: !!s.on, open: ranges(s.open, def.open), order: ranges(s.order, def.order), pickup: ranges(s.pickup, def.pickup) }
      : mkDay(def.on);
  }
  return out;
}
const inAny = (list, hm) => (list || []).some(([a, b]) => a && b && hm >= a && hm <= b);
const fmt = t => t.replace(':', 'h');
const rng = list => (list || []).filter(([a, b]) => a && b);
const rtxt = list => rng(list).map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(' · ');

/** État à l'instant `now` (objet parisNow). */
export function hoursState(hours, now) {
  const H = sanitizeHours(hours), day = H.days[now.dow], hm = now.hm;
  const orderOpen = !H.auto || (day.on && inAny(day.order, hm));
  const pickupNow = day.on && inAny(day.pickup, hm);
  let next = null;
  if (H.auto) {
    for (let off = 0; off < 8 && !next; off++) {
      const d = (now.dow + off) % 7, dd = H.days[d];
      if (!dd.on) continue;
      const starts = rng(dd.order).map(r => r[0]).sort().filter(s => off > 0 || s > hm);
      if (starts.length) next = { off, day: d, at: starts[0] };
    }
  }
  const nextText = next ? 'Prochaine ouverture : ' + (next.off === 0 ? "aujourd'hui" : next.off === 1 ? 'demain' : DAY_NAMES[next.day]) + ' à ' + fmt(next.at) + '.' : '';
  return {
    auto: H.auto, orderOpen, pickupNow, delivery: H.delivery, prepMin: H.prepMin, next, nextText,
    today: { on: day.on, open: rng(day.open), order: rng(day.order), pickup: rng(day.pickup) },
    lines: weekLines(H),
  };
}
/** Résumé lisible : « Mardi – Dimanche : 11h30–15h55 · 18h10–22h20 » */
export function weekLines(H) {
  const order = [1, 2, 3, 4, 5, 6, 0], sig = d => (H.days[d].on ? rtxt(H.days[d].open) || 'fermé' : 'fermé');
  const cap = s => s[0].toUpperCase() + s.slice(1), out = [];
  let i = 0;
  while (i < order.length) {
    let j = i; while (j + 1 < order.length && sig(order[j + 1]) === sig(order[i])) j++;
    out.push((i === j ? cap(DAY_NAMES[order[i]]) : cap(DAY_NAMES[order[i]]) + ' – ' + cap(DAY_NAMES[order[j]])) + ' : ' + sig(order[i]));
    i = j + 1;
  }
  return out;
}
/** Un horaire souhaité "HH:MM" est-il dans les plages d'enlèvement du jour ? */
export function pickupOk(hours, now, hm) {
  const day = sanitizeHours(hours).days[now.dow];
  return day.on && inAny(day.pickup, hm);
}
