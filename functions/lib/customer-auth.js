// functions/lib/customer-auth.js
const PBKDF2_ITERATIONS = 100000;
export const SESSION_COOKIE_NAME = 'ocezam_cust_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(password, existingSaltHex = null) {
  const enc = new TextEncoder();
  const saltBytes = existingSaltHex
    ? hexToBytes(existingSaltHex)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    saltHex: bytesToHex(saltBytes),
    hashHex: bytesToHex(new Uint8Array(derivedBits)),
  };
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hashHex } = await hashPassword(password, saltHex);
  return timingSafeEqualHex(hashHex, expectedHashHex);
}

export async function sha256Hex(rawValue) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawValue));
  return bytesToHex(new Uint8Array(digest));
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const map = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

export function buildSessionCookie(rawToken, maxAgeSeconds = 30 * 24 * 3600) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createCustomerSession(db, customerId) {
  const rawToken = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db
    .prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, customerId, expiresAt)
    .run();

  return { rawToken, expiresAt };
}

export async function getAuthenticatedCustomer(db, request) {
  const cookies = parseCookies(request);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.address, c.postal_code, c.city, s.expires_at
       FROM customer_sessions s
       JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .bind(tokenHash, nowIso)
    .first();

  return row || null;
}