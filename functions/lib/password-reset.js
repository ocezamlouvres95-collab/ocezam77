// functions/lib/password-reset.js
// Outils pour la réinitialisation du mot de passe client.
export const RESET_TTL_MS = 60 * 60 * 1000; // le lien est valable 1 heure

let ready = null;
export function ensureResetTable(env) {
  if (!env.DB) throw new Error('Base D1 non liée (binding DB manquant)');
  return (ready ||= env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS password_resets (
         token_hash TEXT PRIMARY KEY,
         customer_id INTEGER NOT NULL,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_password_resets_customer ON password_resets(customer_id)'),
  ]).catch((e) => {
    ready = null;
    throw e;
  }));
}

export function newResetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
