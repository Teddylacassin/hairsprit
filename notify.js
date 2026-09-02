// Envoie des emails via l'API Resend (https://resend.com).
// Domaine vérifié : mail.hairsprit.be — les emails partent maintenant vers n'importe quel
// destinataire (clients compris), plus seulement vers l'adresse du compte Resend.
// Nécessite RESEND_API_KEY sur le serveur.

const FROM_ADDRESS = 'Hairsprit <contact@mail.hairsprit.be>';

// Alerte email à Teddy à chaque nouvelle demande de réservation.
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
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

// Envoie un récap quotidien (chaque matin) des RDV confirmés du lendemain à Teddy.
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
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

// Alerte au client quand Teddy démarre le trajet vers chez lui.
async function sendDepartureAlertEmail({ client }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !client.email) return;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">🚐 Teddy est en route !</h2>
      <p style="color:#555;">Ta coupe approche — Teddy vient de partir pour venir chez toi. Suis sa position en direct sur ta carte de fidélité dans l'app.</p>
      <p style="margin-top:20px;">
        <a href="https://app.hairsprit.be/app" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
          Voir le suivi en direct
        </a>
      </p>
      <p style="color:#999;font-size:12px;margin-top:24px;">À tout de suite !<br>Teddy — Hairsprit</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [client.email],
        subject: '🚐 Teddy est en route vers chez toi !',
        html,
      }),
    });
    if (!res.ok) console.error('[Hairsprit] Erreur envoi alerte départ:', res.status, await res.text());
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi alerte départ:', e.message);
  }
}

// Rappel de rendez-vous envoyé au client, la veille.
async function sendAppointmentReminderEmail({ client, booking }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !client.email) return false;

  const dateLabel = new Date(booking.slot_datetime).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Brussels',
  });

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">Rappel de ton rendez-vous ✂️</h2>
      <p style="color:#555;">Petit rappel : ta coupe avec Hairsprit est prévue <strong>${dateLabel}</strong>.</p>
      ${booking.booking_details ? `<p style="color:#555;">${booking.booking_details}</p>` : ''}
      <p style="color:#999;font-size:12px;margin-top:24px;">À bientôt !<br>Teddy — Hairsprit</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [client.email],
        subject: `Rappel : RDV ${dateLabel}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error('[Hairsprit] Erreur envoi rappel RDV:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi rappel RDV:', e.message);
    return false;
  }
}

module.exports = { sendBookingAlertEmail, sendDailyReminderEmail, sendDepartureAlertEmail, sendAppointmentReminderEmail };
