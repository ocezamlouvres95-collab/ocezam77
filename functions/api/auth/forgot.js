import { sha256Hex } from '../../lib/customer-auth.js';
import { isValidEmail, sendPasswordResetEmail } from '../../lib/mailer.js';
import { RESET_TTL_MS, ensureResetTable, newResetToken } from '../../lib/password-reset.js';
import { clientIp, ensureDb, rateHit } from '../../lib/util.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const GENERIC_MESSAGE =
  "Si un compte existe avec cette adresse, un e-mail contenant un lien de réinitialisation vient d'être envoyé. Le lien est valable 1 heure. Pensez à vérifier vos courriers indésirables.";

// Même réponse que le compte existe ou non (on ne révèle pas quelles adresses sont inscrites).
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      return json({ ok: false, error: 'Adresse e-mail invalide.' }, 400);
    }

    await ensureDb(env);
    await ensureResetTable(env);

    // Limites : 5 demandes par heure et par adresse IP, 3 par heure et par e-mail.
    if (await rateHit(env, 'pwf-ip:' + clientIp(request), 3600000, 5)) {
      return json({ ok: true, message: GENERIC_MESSAGE });
    }
    if (await rateHit(env, 'pwf-em:' + email, 3600000, 3)) {
      return json({ ok: true, message: GENERIC_MESSAGE });
    }

    const customer = await env.DB.prepare('SELECT id, email, first_name FROM customers WHERE email = ?')
      .bind(email)
      .first();
    if (!customer) {
      return json({ ok: true, message: GENERIC_MESSAGE });
    }

    const rawToken = newResetToken();
    const tokenHash = await sha256Hex(rawToken); // seul le hash est conservé en base
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

    await env.DB.batch([
      env.DB.prepare('DELETE FROM password_resets WHERE customer_id = ?').bind(customer.id),
      env.DB.prepare('INSERT INTO password_resets (token_hash, customer_id, expires_at) VALUES (?, ?, ?)').bind(
        tokenHash,
        customer.id,
        expiresAt
      ),
    ]);

    const link = new URL(request.url).origin + '/#reset=' + rawToken;
    await sendPasswordResetEmail(env, {
      email: customer.email,
      prenom: customer.first_name,
      link,
    }).catch(() => {});

    return json({ ok: true, message: GENERIC_MESSAGE });
  } catch (_) {
    return json({ ok: false, error: 'Erreur, veuillez réessayer dans un instant.' }, 500);
  }
}
