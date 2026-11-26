/* Livraison O CEZAM 77 : la zone est une liste de communes (réglages > zones), pas un rayon. */
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findZone(settings, commune) {
  const c = norm(commune);
  return c ? (settings.zones || []).find(z => norm(z.n) === c) || null : null;
}

export function checkDeliveryZone(adresse, commune, settings = {}) {
  if (!String(adresse || '').trim()) return { ok: false, error: 'Adresse de livraison requise.' };
  const zones = settings.zones || [];
  if (!zones.length) return { ok: true, zone: null };
  const z = findZone(settings, commune);
  if (!z) return { ok: false, error: 'Livraison impossible : choisissez une commune desservie (' + zones.map(x => x.n).join(', ') + ').' };
  return { ok: true, zone: z };
}
