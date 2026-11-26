import SEED from './seed.js';
import { DEFAULT_HOURS } from './hours.js';

export const json = (o, st = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
export const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
export const num = (x, d = 0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
export const cents = x => Math.round(num(x) * 100);
export const rid = (n = 10) => { const a = crypto.getRandomValues(new Uint8Array(n)); return Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function parisNow(d = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d)) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, hm: `${p.hour}:${p.minute}`, dow: DOW[p.weekday] };
}

/* ---------- base de données (D1) ---------- */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, ts INTEGER)`,
  `CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, ct TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER)`,
  `CREATE TABLE IF NOT EXISTS counters (day TEXT PRIMARY KEY, n INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rl (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (
     id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, num INTEGER, day TEXT, hour INTEGER, ts INTEGER NOT NULL, updated INTEGER,
     status TEXT NOT NULL, mode TEXT NOT NULL, prenom TEXT, telephone TEXT, adresse TEXT, code_postal TEXT, heure TEXT, remarque TEXT, slot_time TEXT, customer_email TEXT,
     lines TEXT NOT NULL, subtotal INTEGER, discount INTEGER DEFAULT 0, fee INTEGER DEFAULT 0, total INTEGER NOT NULL, promo TEXT,
     pay_pref TEXT, pay_method TEXT, paid INTEGER DEFAULT 0, paid_at INTEGER, stripe_session TEXT, printed INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(day)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE TABLE IF NOT EXISTS lines_stat (order_id TEXT NOT NULL, item_id TEXT, name TEXT, cat TEXT, qty INTEGER, total INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_lines_order ON lines_stat(order_id)`,
  `CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email)`,
];
let ready = null;
export function ensureDb(env) {
  if (!env.DB) throw new Error('Base D1 non liée (binding DB manquant)');
  return (ready ||= env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { ready = null; throw e; }));
}

export async function kvGetMany(env, keys) {
  const r = await env.DB.prepare(`SELECT k,v FROM kv WHERE k IN (${keys.map(() => '?').join(',')})`).bind(...keys).all();
  const o = {}; for (const row of r.results) { try { o[row.k] = JSON.parse(row.v); } catch { } }
  return o;
}
export const kvSet = (env, k, v) => env.DB.prepare('INSERT INTO kv(k,v,ts) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts').bind(k, JSON.stringify(v), Date.now()).run();

export const DEFAULT_SETTINGS = {
  name: 'Ô Cezam 77', address: '5 Avenue du Général Leclerc, 77390 Chaumes-en-Brie', phone: '07 82 75 80 44', whatsapp: '33782758044',
  open: true, closedMsg: 'Les commandes en ligne sont fermées pour le moment.', prep: '20 à 30 min',
  fee: 0, freeFeeFrom: 0, freeDeliveryFrom: 0, minDelivery: 0,
  lowItemThreshold: 5, under5Fee: 0, over5Fee: 0, maxDeliveryKm: 15,
  deliveryZone: 'Chaumes-en-Brie et communes environnantes',
  zones: SEED.settings.zones || [],
  hours: DEFAULT_HOURS,
  payOnline: true, payOnSite: true,
  printer: { mode: 'zebra', width: 576, font: 28, copies: 1, auto: false, tickets: 'both', header: 'Ô CEZAM 77', footer: 'Merci et bon appétit !' },
};

/** Charge catalogue + réglages + promos (initialise le catalogue depuis le seed au 1er appel). */
export async function loadAll(env) {
  const d = await kvGetMany(env, ['catalog', 'settings', 'promos']);
  if (!d.catalog) { d.catalog = SEED.catalog; await kvSet(env, 'catalog', d.catalog); }
  if (!d.settings) { d.settings = { ...SEED.settings }; await kvSet(env, 'settings', d.settings); }
  const s = { ...DEFAULT_SETTINGS, ...d.settings, printer: { ...DEFAULT_SETTINGS.printer, ...(d.settings.printer || {}) } };
  return { catalog: d.catalog, settings: s, promos: d.promos || [] };
}

/* ---------- sécurité ---------- */
export function isAdmin(request, env) {
  const t = request.headers.get('x-admin-token') || '', s = env.ADMIN_TOKEN || '';
  if (!s || t.length !== s.length) return false;
  let d = 0; for (let i = 0; i < s.length; i++) d |= t.charCodeAt(i) ^ s.charCodeAt(i);
  return d === 0;
}
export async function rateHit(env, key, windowMs, max) {
  const b = Math.floor(Date.now() / windowMs), k = `${key}:${b}`;
  const r = await env.DB.prepare('INSERT INTO rl(k,n,exp) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1 RETURNING n').bind(k, Date.now() + windowMs * 2).first();
  if (Math.random() < 0.02) env.DB.prepare('DELETE FROM rl WHERE exp<?').bind(Date.now()).run().catch(() => { });
  return r.n > max;
}
export const clientIp = r => r.headers.get('cf-connecting-ip') || 'x';
