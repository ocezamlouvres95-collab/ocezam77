/** Agrège des commandes (lignes JSON) : ventes, Pareto articles, consommation matières. Montants en centimes. */
export function pareto(rows, keyVal) {
  const a = rows.slice().sort((x, y) => keyVal(y) - keyVal(x)), tot = a.reduce((s, r) => s + keyVal(r), 0);
  let cum = 0;
  return a.map(r => { const v = keyVal(r), before = tot ? cum / tot * 100 : 0; cum += v; return { ...r, v, share: tot ? v / tot * 100 : 0, cum: tot ? cum / tot * 100 : 0, cls: before < 80 ? 'A' : before < 95 ? 'B' : 'C' }; });
}
export function aggregate(orders, catalog, recipes) {
  const R = { mats: recipes?.mats || {}, items: recipes?.items || {}, choices: recipes?.choices || {} };
  const catName = Object.fromEntries((catalog.cats || []).map(c => [c.id, c.n]));
  const daily = {}, hours = {}, modes = {}, pays = {}, items = {}, cats = {}, cons = {}, promos = {};
  const T = { n: 0, rev: 0, paid: 0, disc: 0 };
  const add = (o, k, f) => { const r = (o[k] ||= { k, n: 0, rev: 0 }); f(r); };
  const use = (m, q) => { const mt = R.mats[m] || {}; const r = (cons[m] ||= { m, u: mt.u || 'portion', q: 0, cost: 0 }); r.q += q; r.cost += q * (mt.cost || 0); };
  for (const o of orders) {
    T.n++; T.rev += o.total; T.disc += o.discount || 0; if (o.paid) T.paid += o.total;
    add(daily, o.day, r => { r.n++; r.rev += o.total; });
    add(hours, o.hour, r => { r.n++; r.rev += o.total; });
    add(modes, o.mode, r => { r.n++; r.rev += o.total; });
    add(pays, o.paid ? (o.pay_method || 'AUTRE') : 'A_ENCAISSER', r => { r.n++; r.rev += o.total; });
    if (o.promo) add(promos, o.promo, r => { r.n++; r.rev += o.discount || 0; });
    let lines = []; try { lines = JSON.parse(o.lines || '[]'); } catch { }
    for (const l of lines) {
      add(items, l.id, r => { r.name = l.label; r.cat = catName[l.cat] || l.cat; r.q = (r.q || 0) + l.qty; r.rev += l.total; });
      add(cats, catName[l.cat] || l.cat, r => { r.q = (r.q || 0) + l.qty; r.rev += l.total; });
      for (const x of R.items[l.id] || []) use(x.m, x.q * l.qty);
      for (const names of Object.values(l.sel || {})) for (const nm of names) {
        const rec = R.choices[nm];
        if (rec && rec.length) rec.forEach(x => use(x.m, x.q * l.qty)); else use(nm, l.qty);
      }
    }
  }
  const consRows = Object.values(cons), hasCost = consRows.some(r => r.cost > 0);
  return {
    totals: T, daily: Object.values(daily).sort((a, b) => a.k < b.k ? -1 : 1), hours: Object.values(hours).sort((a, b) => a.k - b.k),
    modes: Object.values(modes), pays: Object.values(pays), promos: Object.values(promos), cats: Object.values(cats).sort((a, b) => b.rev - a.rev),
    items: pareto(Object.values(items), r => r.rev), consBasis: hasCost ? 'cost' : 'qty',
    cons: pareto(consRows, r => hasCost ? r.cost : r.q),
  };
}
export function sanitizeRecipes(r) {
  const s = (x, n) => String(x ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n), q = x => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const list = a => (Array.isArray(a) ? a : []).slice(0, 40).map(x => ({ m: s(x.m, 60), q: q(x.q) })).filter(x => x.m);
  const mats = {}, items = {}, choices = {};
  for (const [k, v] of Object.entries(r.mats || {}).slice(0, 500)) if (s(k, 60)) mats[s(k, 60)] = { u: s(v.u, 12) || 'portion', cost: q(v.cost) };
  for (const [k, v] of Object.entries(r.items || {}).slice(0, 1500)) items[s(k, 30)] = list(v);
  for (const [k, v] of Object.entries(r.choices || {}).slice(0, 800)) choices[s(k, 60)] = list(v);
  return { mats, items, choices };
}
