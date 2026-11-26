import { buildClearSessionCookie, parseCookies, sha256Hex } from '../../lib/customer-auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const cookies = parseCookies(request);
    const rawToken = cookies.ocezam_cust_sid;
    if (rawToken) {
      const tokenHash = await sha256Hex(rawToken);
      await env.DB.prepare('DELETE FROM customer_sessions WHERE token_hash = ?')
        .bind(tokenHash)
        .run();
    }
  } catch (_) {
    // Ignorer si déjà expirée
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearSessionCookie(),
    },
  });
}