import { cents, clean, num } from './util.js';

const inHours = (p, hm) => !p.h1 || !p.h2 || (p.h1 <= p.h2 ? hm >= p.h1 && hm <= p.h2 : hm >= p.h1 || hm <= p.h2);

export function promoWindow(p, ctx) {
  if (!p.on) return false;
  if (p.from && ctx.day < p.from) return false;
  if (p.to && ctx.day > p.to) return false;
  if (p.days && p.days.length && !p.days.includes(ctx.dow)) return false;
  if (!inHours(p, ctx.hm)) return false;
  if (ctx.mode && p.mode && p.mode !== 'ALL' && p.mode !== ctx.mode) return false;
  return true;
}

const eur = c => (c / 100).toFixed(2).replace('.', ',') + ' €';

export function computeBaseDelivery(lines, baseSubtotalCents, settings = {}) {
  const lowThresholdCents = num(settings.lowItemThreshold) > 0 ? cents(settings.lowItemThreshold) : 500;
  const underFeeCents = settings.under5Fee != null ? cents(settings.under5Fee) : 50;
  const overFeeCents = settings.over5Fee != null ? cents(settings.over5Fee) : 100;
  const freeFromRaw = settings.freeDeliveryFrom ?? settings.freeFeeFrom ?? 80;
  const freeFromCents = num(freeFromRaw) > 0 ? cents(freeFromRaw) : 0;

  const isFreeByThreshold = freeFromCents > 0 && baseSubtotalCents >= freeFromCents;

  let underCount = 0;
  let overCount = 0;
  let rawFeeCents = 0;

  for (const l of lines) {
    const q = Math.max(1, parseInt(l.qty) || 1);
    const baseUnitCents = l._baseUnitCents != null ? l._baseUnitCents : cents(l.unit);
    if (baseUnitCents < lowThresholdCents) {
      underCount += q;
      rawFeeCents += underFeeCents * q;
    } else {
      overCount += q;
      rawFeeCents += overFeeCents * q;
    }
  }

  const feeCents = isFreeByThreshold ? 0 : rawFeeCents;
  const parts = [];
  if (isFreeByThreshold) {
    parts.push(`Offerte dès ${eur(freeFromCents)}`);
  } else {
    if (underCount > 0) parts.push(`${underCount} art. < ${eur(lowThresholdCents)} (${eur(underCount * underFeeCents)})`);
    if (overCount > 0) parts.push(`${overCount} art. >= ${eur(lowThresholdCents)} (${eur(overCount * overFeeCents)})`);
  }

  return {
    feeCents,
    rawFeeCents,
    underCount,
    overCount,
    isFreeByThreshold,
    freeFromCents,
    detailText: parts.join(' + ')
  };
}

export function quote({ catalog, promos, settings, loyalty = null }, body, ctx) {
  const items = new Map(catalog.items.map(i => [i.id, i]));
  const catOn = new Map(catalog.cats.map(c => [c.id, c.on !== false]));
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) return { ok: false, error: 'Panier vide ou invalide' };
  const lines = []; let subtotal = 0;
  for (const it of body.items) {
    const ref = items.get(String(it.id));
    if (!ref || ref.on === false || !catOn.get(ref.c)) return { ok: false, error: 'Article indisponible : ' + clean(it.n || it.id, 60) };
    const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
    const baseUnitCents = cents(ref.p);
    let unit = baseUnitCents; const detail = []; const selMap = {};
    for (const g of ref.groups || []) {
      const ch = g.list ? (catalog.lists[g.list]?.ch || []) : (g.ch || []);
      const price = new Map(ch.map(c => [c.n, cents(c.p)]));
      const raw = it.sel && it.sel[g.id];
      const sel = [...new Set((Array.isArray(raw) ? raw : []).map(String))];
      if (sel.some(s => !price.has(s))) return { ok: false, error: 'Choix invalide : ' + g.t };
      const max = g.type === 'single' ? 1 : (g.max ?? 99), min = g.min ?? (g.type === 'single' ? 1 : 0);
      if (sel.length < min || sel.length > max) return { ok: false, error: `À compléter : ${g.t.replace(/\s*\(.*\)\s*$/, '')} (${ref.n})` };
      for (const s of sel) unit += price.get(s);
      selMap[g.id] = sel;
      const t = g.t.replace(/\s*\(.*\)\s*$/, '');
      if (sel.length) detail.push(t + ' : ' + sel.join(', ')); else if (g.empty) detail.push(g.empty);
    }
    const note = clean(it.note, 100);
    const total = unit * qty; subtotal += total;
    lines.push({
      id: ref.id, label: ref.n, cat: ref.c, qty, unit, total,
      inc: ref.inc || [], detail, note, sel: selMap,
      _baseUnitCents: baseUnitCents
    });
  }

  const mode = body.mode === 'LIVRAISON' ? 'LIVRAISON' : 'A EMPORTER';

  const minDelRaw = settings.minDelivery ?? 30;
  const minDelCents = num(minDelRaw) > 0 ? cents(minDelRaw) : 0;
  if (mode === 'LIVRAISON' && minDelCents > 0 && subtotal < minDelCents) {
    return { ok: false, error: 'Minimum de commande pour la livraison : ' + eur(minDelCents) };
  }

  const delBase = mode === 'LIVRAISON' ? computeBaseDelivery(lines, subtotal, settings) : { feeCents: 0, detailText: '' };
  let fee = delBase.feeCents;
  let deliveryDetail = delBase.detailText;

  const code = clean(body.code, 30).toUpperCase();
  let best = null, codeFound = false, codeMsg = '';
  const c2 = { ...ctx, mode };
  for (const p of promos) {
    const pc = (p.code || '').trim().toUpperCase();
    if (pc) { if (!code || pc !== code) continue; codeFound = true; }
    if (!promoWindow(p, c2)) { if (pc) codeMsg = "Ce code n'est pas valable actuellement."; continue; }
    if (p.min && subtotal < cents(p.min)) { if (pc) codeMsg = 'Minimum de commande : ' + eur(cents(p.min)); continue; }
    const tg = p.t || [];
    const base = p.scope === 'CAT' ? lines.filter(l => tg.includes(l.cat)).reduce((s, l) => s + l.total, 0)
      : p.scope === 'ITEM' ? lines.filter(l => tg.includes(l.id)).reduce((s, l) => s + l.total, 0) : subtotal;
    let disc = 0;
    if (p.type === 'PERCENT') disc = Math.round(base * Math.min(100, num(p.value)) / 100);
    else if (p.type === 'AMOUNT') disc = Math.min(base, cents(p.value));
    else if (p.type === 'FEEOFF') disc = fee;
    if (disc > 0 && (!best || disc > best.disc)) { best = { id: p.id, n: p.n, disc, type: p.type, viaCode: !!pc }; codeMsg = pc ? '' : codeMsg; }
    else if (pc && !best) codeMsg = "Ce code ne s'applique pas à votre panier.";
  }
  if (code && !codeFound) codeMsg = 'Code promo inconnu.';

  const discount = best ? best.disc : 0;
  if (mode === 'LIVRAISON' && best && best.type === 'FEEOFF') {
    fee = 0;
    deliveryDetail = 'Offerte par promotion';
  }

  const cleanLines = lines.map(({ _baseUnitCents, ...rest }) => rest);
  let finalDiscount = best && best.type === 'FEEOFF' ? 0 : discount;
  let finalPromo = best && best.type === 'FEEOFF' ? null : (best ? { id: best.id, n: best.n } : null);

  // Remise fidélité 2 % sur le sous-total (hors frais de livraison), non cumulable avec une promo
  const loyaltyEligible = Boolean(loyalty && loyalty.eligible);
  const loyaltyRate = Number(loyalty && loyalty.ratePct) > 0 ? Number(loyalty.ratePct) : 2;
  let loyaltyApplied = false;

  if (finalDiscount === 0 && loyaltyEligible && subtotal > 0) {
    finalDiscount = Math.min(subtotal, Math.round((subtotal * loyaltyRate) / 100));
    if (finalDiscount > 0) {
      loyaltyApplied = true;
      finalPromo = { id: 'LOYALTY_2', n: loyalty.label || `Fidélité -${loyaltyRate}%` };
    }
  }

  return {
    ok: true,
    lines: cleanLines,
    subtotal,
    discount: finalDiscount,
    promo: finalPromo,
    loyaltyApplied,
    fee,
    deliveryDetail,
    total: Math.max(0, subtotal - finalDiscount + fee),
    mode,
    codeMsg
  };
}