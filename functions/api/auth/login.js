import {
  buildSessionCookie,
  createCustomerSession,
  verifyPassword,
} from '../../lib/customer-auth.js';

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

    if (!email || !password) {
      return json({ ok: false, error: 'E-mail et mot de passe requis.' }, 400);
    }

    const customer = await env.DB.prepare(
      `SELECT id, email, password_hash, salt, first_name, last_name, phone, address, postal_code, city
       FROM customers WHERE email = ?`
    )
      .bind(email)
      .first();

    if (!customer) {
      return json({ ok: false, error: 'Identifiants incorrects.' }, 401);
    }

    const valid = await verifyPassword(password, customer.salt, customer.password_hash);
    if (!valid) {
      return json({ ok: false, error: 'Identifiants incorrects.' }, 401);
    }

    const { rawToken } = await createCustomerSession(env.DB, customer.id);

    return json(
      {
        ok: true,
        customer: {
          id: customer.id,
          email: customer.email,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          address: customer.address,
          postal_code: customer.postal_code,
          city: customer.city,
        },
      },
      200,
      { 'Set-Cookie': buildSessionCookie(rawToken) }
    );
  } catch (_) {
    return json({ ok: false, error: 'Erreur de connexion.' }, 500);
  }
}