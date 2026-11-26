import { hashPassword, sha256Hex } from '../../lib/customer-auth.js';
import { ensureResetTable } from '../../lib/password-reset.js';
import { clientIp, ensureDb, rateHit } from '../../lib/util.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const password = String(body.password || '');

    if (!/^[0-9a-f]{64}$/.test(token)) {
      return json({ ok: false, error: 'Lien invalide ou expiré. Refaites une demande.' }, 400);
    }
    if (password.length < 8) {
      return json({ ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' }, 400);
    }

    await ensureDb(env);
    await ensureResetTable(env);

    if (await rateHit(env, 'pwr-ip:' + clientIp(request), 3600000, 20)) {
      return json({ ok: false, error: 'Trop de tentatives. Réessayez dans une heure.' }, 429);
    }

    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare('SELECT customer_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')
      .bind(tokenHash, new Date().toISOString())
      .first();
    if (!row) {
      return json({ ok: false, error: 'Lien invalide ou expiré. Refaites une demande.' }, 400);
    }

    const { saltHex, hashHex } = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare('UPDATE customers SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(
        hashHex,
        saltHex,
        row.customer_id
      ),
      // lien à usage unique + déconnexion de tous les appareils
      env.DB.prepare('DELETE FROM password_resets WHERE customer_id = ?').bind(row.customer_id),
      env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(row.customer_id),
    ]);

    return json({ ok: true });
  } catch (_) {
    return json({ ok: false, error: 'Erreur, veuillez réessayer dans un instant.' }, 500);
  }
}
