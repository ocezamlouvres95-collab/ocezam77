import {
  buildSessionCookie,
  createCustomerSession,
  hashPassword,
} from '../../lib/customer-auth.js';
import { isValidEmail } from '../../lib/mailer.js';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!isValidEmail(email)) {
      return json({ ok: false, error: 'Adresse e-mail invalide.' }, 400);
    }
    if (password.length < 8) {
      return json({ ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' }, 400);
    }

    const existing = await env.DB.prepare('SELECT id FROM customers WHERE email = ?')
      .bind(email)
      .first();
    if (existing) {
      return json({ ok: false, error: 'Un compte existe déjà avec cette adresse e-mail.' }, 409);
    }

    const { saltHex, hashHex } = await hashPassword(password);
    const firstName = String(body.first_name || body.prenom || '').trim();
    const lastName = String(body.last_name || body.nom || '').trim();
    const phone = String(body.phone || body.telephone || '').trim();
    const address = String(body.address || body.adresse || '').trim();
    const postalCode = String(body.postal_code || body.code_postal || '').trim();
    const city = String(body.city || body.ville || '').trim();

    const insertRes = await env.DB.prepare(
      `INSERT INTO customers
       (email, password_hash, salt, first_name, last_name, phone, address, postal_code, city)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(email, hashHex, saltHex, firstName, lastName, phone, address, postalCode, city)
      .run();

    const customerId = insertRes.meta?.last_row_id;
    const { rawToken } = await createCustomerSession(env.DB, customerId);

    return json(
      {
        ok: true,
        customer: {
          id: customerId,
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          address,
          postal_code: postalCode,
          city,
        },
      },
      201,
      { 'Set-Cookie': buildSessionCookie(rawToken) }
    );
  } catch (err) {
    return json({ ok: false, error: 'Erreur lors de la création du compte.' }, 500);
  }
}