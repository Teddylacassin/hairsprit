// Envoie une alerte email via l'API Resend (https://resend.com) à chaque nouvelle demande de réservation.
// Nécessite les variables d'environnement RESEND_API_KEY et NOTIFY_EMAIL sur Render.
// Sans domaine vérifié sur Resend, l'envoi ne fonctionne QUE vers l'email du compte Resend
// (avec l'expéditeur par défaut onboarding@resend.dev) — ce qui convient parfaitement ici,
// puisque c'est justement Teddy qui doit recevoir l'alerte.

async function sendBookingAlertEmail({ client, message, slotDatetime, serviceName, peopleCount, bookingDetails }) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) {
    console.log('[Hairsprit] Alerte email non envoyée : RESEND_API_KEY ou NOTIFY_EMAIL manquant.');
    return;
  }

  const dateLabel = slotDatetime
    ? new Date(slotDatetime).toLocaleString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Brussels',
      })
    : 'Créneau non précisé';

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">Nouvelle demande de réservation</h2>
      <p style="color:#555;margin-top:0;">Hairsprit</p>
      <p><strong>Client :</strong> ${client.prenom} ${client.nom}</p>
      <p><strong>Téléphone :</strong> ${client.telephone}</p>
      <p><strong>Créneau demandé :</strong> ${dateLabel}</p>
      ${peopleCount && peopleCount > 1 ? `<p><strong>Nombre de personnes :</strong> ${peopleCount}</p>` : ''}
      ${bookingDetails ? `<p><strong>Détail :</strong> ${bookingDetails}</p>` : (serviceName ? `<p><strong>Prestation :</strong> ${serviceName}</p>` : '')}
      ${client.address ? `<p><strong>Adresse :</strong> ${client.address}</p>` : ''}
      ${message ? `<p><strong>Message :</strong> ${message}</p>` : ''}
      <p style="margin-top:20px;">
        <a href="https://app.hairsprit.be/admin" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
          Ouvrir l'espace admin
        </a>
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hairsprit <onboarding@resend.dev>',
        to: [toEmail],
        subject: `Nouvelle réservation : ${client.prenom} ${client.nom}`,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Hairsprit] Erreur envoi email Resend:', res.status, errText);
    }
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi email:', e.message);
  }
}

// Envoie un récap quotidien (chaque matin) des RDV confirmés du lendemain,
// pour que Teddy puisse appeler/textoter les clients en amont pour éviter les oublis.
async function sendDailyReminderEmail({ bookings, dateLabel }) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) {
    console.log('[Hairsprit] Rappel quotidien non envoyé : RESEND_API_KEY ou NOTIFY_EMAIL manquant.');
    return;
  }

  if (bookings.length === 0) {
    console.log('[Hairsprit] Rappel quotidien : aucun RDV demain, email non envoyé.');
    return;
  }

  const rows = bookings.map(b => `
    <div style="border-bottom:1px solid #eee;padding:10px 0;">
      <p style="margin:0;"><strong>${new Date(b.slot_datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}</strong> — ${b.prenom} ${b.nom}</p>
      <p style="margin:2px 0;color:#555;">📞 ${b.telephone}</p>
      ${b.booking_details ? `<p style="margin:2px 0;color:#555;">${b.booking_details}</p>` : (b.service_name ? `<p style="margin:2px 0;color:#555;">${b.service_name}</p>` : '')}
      ${b.address ? `<p style="margin:2px 0;color:#555;">📍 ${b.address}</p>` : ''}
    </div>
  `).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">Rappel — RDV de demain (${dateLabel})</h2>
      <p style="color:#555;margin-top:0;">Hairsprit · ${bookings.length} rendez-vous prévu${bookings.length > 1 ? 's' : ''}</p>
      ${rows}
      <p style="margin-top:20px;">
        <a href="https://app.hairsprit.be/admin" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
          Ouvrir l'espace admin
        </a>
      </p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Hairsprit <onboarding@resend.dev>',
        to: [toEmail],
        subject: `Rappel : ${bookings.length} RDV demain (${dateLabel})`,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Hairsprit] Erreur envoi email rappel Resend:', res.status, errText);
    }
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi email rappel:', e.message);
  }
}

module.exports = { sendBookingAlertEmail, sendDailyReminderEmail };
