import { getAuthenticatedCustomer } from '../../lib/customer-auth.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const customer = await getAuthenticatedCustomer(env.DB, request);
    if (!customer) {
      return json({ ok: true, customer: null, orders: [] });
    }

    const ordersRes = await env.DB.prepare(
      `SELECT id, num, mode, slot_time, status, total, ts
       FROM orders
       WHERE lower(customer_email) = lower(?)
       ORDER BY ts DESC
       LIMIT 15`
    )
      .bind(customer.email)
      .all();

    return json({
      ok: true,
      customer,
      orders: ordersRes?.results || [],
    });
  } catch (_) {
    return json({ ok: false, error: 'Erreur lecture profil.' }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const customer = await getAuthenticatedCustomer(env.DB, request);
    if (!customer) {
      return json({ ok: false, error: 'Non authentifié.' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const firstName = String(body.first_name ?? customer.first_name ?? '').trim();
    const lastName = String(body.last_name ?? customer.last_name ?? '').trim();
    const phone = String(body.phone ?? customer.phone ?? '').trim();
    const address = String(body.address ?? customer.address ?? '').trim();
    const postalCode = String(body.postal_code ?? customer.postal_code ?? '').trim();
    const city = String(body.city ?? customer.city ?? '').trim();

    await env.DB.prepare(
      `UPDATE customers
       SET first_name = ?, last_name = ?, phone = ?, address = ?, postal_code = ?, city = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(firstName, lastName, phone, address, postalCode, city, customer.id)
      .run();

    return json({
      ok: true,
      customer: {
        ...customer,
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        postal_code: postalCode,
        city,
      },
    });
  } catch (_) {
    return json({ ok: false, error: 'Erreur mise à jour profil.' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const customer = await getAuthenticatedCustomer(env.DB, request);
    if (!customer) {
      return json({ ok: false, error: 'Non authentifié.' }, 401);
    }

    await env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(customer.id).run();
    await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(customer.id).run();

    return new Response(JSON.stringify({ ok: true, deleted: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie':
          'ocezam_cust_sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  } catch (_) {
    return json({ ok: false, error: 'Erreur suppression compte.' }, 500);
  }
}