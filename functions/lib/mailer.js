// functions/lib/mailer.js
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatEurosFromCents(cents = 0) {
  const val = (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
  return `${val} €`;
}

/**
 * Envoie un e-mail de confirmation de commande via l'API Brevo.
 * Variables d'environnement attendues sur Cloudflare Pages :
 * - MAIL_API_KEY (obligatoire pour envoyer)
 * - MAIL_SENDER_EMAIL (optionnel, défaut : "commande@ocezam.com")
 * - MAIL_SENDER_NAME (optionnel, défaut : "Ô Cezam 77")
 */
export async function sendOrderConfirmationEmail(env, order = {}) {
  const apiKey = env?.MAIL_API_KEY;
  const toEmail = String(order.customer_email || order.email || '').trim();

  if (!apiKey || !isValidEmail(toEmail)) {
    return { sent: false, reason: !apiKey ? 'missing_mail_api_key' : 'invalid_email' };
  }

  const senderEmail = String(env?.MAIL_SENDER_EMAIL || 'commande@ocezam.com').trim();
  const senderName = String(env?.MAIL_SENDER_NAME || 'Ô Cezam 77').trim();
  const orderNum = escapeHtml(order.num || order.id || '');
  const prenom = escapeHtml(order.prenom || 'Client');
  const modeLabel =
    String(order.mode || '').toLowerCase() === 'livraison' ? 'Livraison' : 'À emporter';
  const slotLabel = escapeHtml(
    order.slot_time === 'ASAP'
      ? 'Dès que possible'
      : order.slot_time || order.heure || 'À préciser'
  );
  const totalLabel = escapeHtml(formatEurosFromCents(order.total));

  let linesHtml = '';
  try {
    const parsedLines =
      typeof order.lines === 'string' ? JSON.parse(order.lines) : order.lines || [];
    if (Array.isArray(parsedLines) && parsedLines.length > 0) {
      linesHtml = parsedLines
        .map((item) => {
          const qty = Number(item.qty || item.quantity || 1);
          const name = escapeHtml(item.name || item.title || 'Article');
          const lineTotal = item.total_cents ?? item.price_cents ? formatEurosFromCents((item.total_cents ?? item.price_cents * qty)) : '';
          return `<li><strong>${qty}x</strong> ${name}${lineTotal ? ` — ${escapeHtml(lineTotal)}` : ''}</li>`;
        })
        .join('');
    }
  } catch (_) {
    linesHtml = '';
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h2 style="margin-bottom: 6px;">Ô Cezam — Confirmation de commande</h2>
      <p>Bonjour ${prenom}, votre commande <strong>#${orderNum}</strong> a bien été enregistrée.</p>
      <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:14px; margin:16px 0;">
        <p style="margin:4px 0;"><strong>Mode :</strong> ${modeLabel}</p>
        <p style="margin:4px 0;"><strong>Créneau horaire :</strong> ${slotLabel}</p>
        <p style="margin:4px 0;"><strong>Total :</strong> ${totalLabel}</p>
      </div>
      ${linesHtml ? `<p><strong>Détail :</strong></p><ul>${linesHtml}</ul>` : ''}
      <p style="font-size:13px; color:#6b7280; margin-top:24px;">
        Cet e-mail confirme la prise en compte de votre commande sur Ô Cezam.
      </p>
    </div>
  `;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: order.prenom || undefined }],
      subject: `Confirmation de commande #${order.num || order.id || ''} — Ô Cezam`,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const shortMsg = errText.replace(/\s+/g, ' ').slice(0, 90);
    return { sent: false, reason: `brevo_${res.status}:${shortMsg}`, details: errText };
  }

  const data = await res.json().catch(() => ({}));
  return { sent: true, messageId: data.messageId || null };
}

/**
 * Envoie l'e-mail de réinitialisation de mot de passe via l'API Brevo.
 * Mêmes variables d'environnement que la confirmation de commande (MAIL_API_KEY, ...).
 */
export async function sendPasswordResetEmail(env, { email, prenom, link } = {}) {
  const apiKey = env?.MAIL_API_KEY;
  const toEmail = String(email || '').trim();
  if (!apiKey || !isValidEmail(toEmail) || !link) {
    return { sent: false, reason: !apiKey ? 'missing_mail_api_key' : 'invalid_email' };
  }

  const senderEmail = String(env?.MAIL_SENDER_EMAIL || 'commande@ocezam.com').trim();
  const senderName = String(env?.MAIL_SENDER_NAME || 'Ô Cezam 77').trim();
  const name = escapeHtml(prenom || 'Client');
  const safeLink = escapeHtml(link);

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <h2 style="margin-bottom: 6px;">Ô Cezam — Nouveau mot de passe</h2>
      <p>Bonjour ${name}, vous avez demandé à réinitialiser le mot de passe de votre compte Ô Cezam.</p>
      <p style="margin: 22px 0;">
        <a href="${safeLink}" style="background:#1565a8; color:#ffffff; text-decoration:none; padding:12px 20px; border-radius:4px; font-weight:bold;">Choisir un nouveau mot de passe</a>
      </p>
      <p style="font-size:13px; color:#6b7280;">Ce lien est valable 1 heure et ne peut servir qu'une seule fois.</p>
      <p style="font-size:13px; color:#6b7280;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste inchangé.</p>
    </div>
  `;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: prenom || undefined }],
      subject: 'Réinitialisation de votre mot de passe — Ô Cezam',
      htmlContent,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { sent: false, reason: `brevo_${res.status}:${errText.replace(/\s+/g, ' ').slice(0, 90)}` };
  }
  const data = await res.json().catch(() => ({}));
  return { sent: true, messageId: data.messageId || null };
}
