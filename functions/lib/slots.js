// functions/lib/slots.js
const TIMEZONE = 'Europe/Paris';

function getParisNowParts(nowMs = Date.now()) {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = {};
  for (const p of fmt.formatToParts(new Date(nowMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }

  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: (parts.weekday || '').toLowerCase(),
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function parseHhMmToMinutes(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function formatMinutesToHhMm(totalMinutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Extrait les plages [{ startMin, endMin }] pour aujourd'hui depuis settings.hours
 * Supporte plusieurs formats courants :
 * - settings.hours.mon..sun = [{ start: "11:30", end: "14:30" }, { start: "18:00", end: "22:30" }]
 * - ou { open1: "11:30", close1: "14:30", open2: "18:00", close2: "22:30" }
 * - ou plage unique { open: "11:00", close: "23:00" }
 */
export function getTodayRanges(settings = {}, weekdayShort = '') {
  const hours = settings?.hours || settings?.horaires || settings || {};
  const dayKeysByFr = {
    lun: ['mon', 'monday', 'lun', 'lundi', '1'],
    mar: ['tue', 'tuesday', 'mar', 'mardi', '2'],
    mer: ['wed', 'wednesday', 'mer', 'mercredi', '3'],
    jeu: ['thu', 'thursday', 'jeu', 'jeudi', '4'],
    ven: ['fri', 'friday', 'ven', 'vendredi', '5'],
    sam: ['sat', 'saturday', 'sam', 'samedi', '6'],
    dim: ['sun', 'sunday', 'dim', 'dimanche', '0', '7'],
  };

  const prefix = Object.keys(dayKeysByFr).find((k) => weekdayShort.startsWith(k)) || 'lun';
  const candidates = dayKeysByFr[prefix] || [];

  let dayCfg = null;
  for (const key of candidates) {
    if (hours && Object.prototype.hasOwnProperty.call(hours, key)) {
      dayCfg = hours[key];
      break;
    }
  }
  if (!dayCfg && Array.isArray(hours.days)) {
    dayCfg = hours.days.find((d) => candidates.includes(String(d?.day || d?.key || '').toLowerCase()));
  }
  if (!dayCfg) dayCfg = hours;

  if (!dayCfg || dayCfg.closed === true || dayCfg.ferme === true) {
    return [];
  }

  const ranges = [];
  const rawSlots = Array.isArray(dayCfg.slots)
    ? dayCfg.slots
    : Array.isArray(dayCfg.ranges)
      ? dayCfg.ranges
      : Array.isArray(dayCfg)
        ? dayCfg
        : null;

  if (rawSlots) {
    for (const s of rawSlots) {
      const startMin = parseHhMmToMinutes(s?.start || s?.open || s?.from);
      const endMin = parseHhMmToMinutes(s?.end || s?.close || s?.to);
      if (startMin !== null && endMin !== null && endMin > startMin) {
        ranges.push({ startMin, endMin });
      }
    }
    return ranges;
  }

  const pairs = [
    [dayCfg.open1 || dayCfg.open || dayCfg.start1, dayCfg.close1 || dayCfg.close || dayCfg.end1],
    [dayCfg.open2 || dayCfg.start2, dayCfg.close2 || dayCfg.end2],
  ];
  for (const [o, c] of pairs) {
    const startMin = parseHhMmToMinutes(o);
    const endMin = parseHhMmToMinutes(c);
    if (startMin !== null && endMin !== null && endMin > startMin) {
      ranges.push({ startMin, endMin });
    }
  }
  return ranges;
}

/**
 * Calcule la liste des créneaux (ex. ["19:15", "19:30", "19:45"])
 */
export function computeAvailableSlots({
  settings = {},
  mode = 'retrait',
  stepMinutes = 15,
  nowMs = Date.now(),
}) {
  const isDelivery = String(mode).toLowerCase().includes('livr') || mode === 'delivery';
  const prepMinutes = isDelivery
    ? Number(settings?.delivery_prep_min ?? settings?.prep_delivery ?? 45)
    : Number(settings?.pickup_prep_min ?? settings?.prep_pickup ?? 30);

  const now = getParisNowParts(nowMs);
  const ranges = getTodayRanges(settings, now.weekday);

  if (!ranges.length) {
    return {
      dateKey: now.dateKey,
      asapAvailable: false,
      slots: [],
    };
  }

  const earliestAllowedMin = now.minutesSinceMidnight + prepMinutes;
  const slots = [];

  for (const { startMin, endMin } of ranges) {
    // Arrondi au prochain pas de `stepMinutes` après l'ouverture ou l'heure minimale autorisée
    const firstCandidate = Math.max(
      Math.ceil(startMin / stepMinutes) * stepMinutes,
      Math.ceil(earliestAllowedMin / stepMinutes) * stepMinutes
    );

    for (let m = firstCandidate; m <= endMin; m += stepMinutes) {
      const label = formatMinutesToHhMm(m);
      if (!slots.includes(label)) {
        slots.push(label);
      }
    }
  }

  return {
    dateKey: now.dateKey,
    asapAvailable: slots.length > 0,
    slots,
  };
}

export function isValidSlotChoice(slotTime, availableSlots = [], allowAsap = true) {
  const val = String(slotTime || '').trim();
  if (!val) return false;
  if (allowAsap && (val === 'ASAP' || val.toLowerCase() === 'dès que possible')) {
    return availableSlots.length > 0;
  }
  return availableSlots.includes(val);
}