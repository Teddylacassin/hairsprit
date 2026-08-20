// Envoie chaque matin à 8h (heure de Belgique) un récap des RDV confirmés du lendemain,
// pour que Teddy puisse relancer ses clients avant leur rendez-vous.
const db = require('./db');
const { sendDailyReminderEmail } = require('./notify');

let lastSentDateKey = null;

function brusselsNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
}

function brusselsDateKey(date) {
  return new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Europe/Brussels' })).toISOString().slice(0, 10);
}

async function checkAndSendDailyReminder() {
  const now = brusselsNow();
  const dateKey = now.toISOString().slice(0, 10);

  // Fenêtre d'envoi : entre 8h00 et 8h09 (heure de Belgique), une seule fois par jour
  if (now.getHours() !== 8 || now.getMinutes() >= 10) return;
  if (lastSentDateKey === dateKey) return;
  lastSentDateKey = dateKey;

  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const tomorrowLabel = tomorrow.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  try {
    const rows = await db.all(`
      SELECT b.id, b.slot_datetime, b.booking_details,
             c.nom, c.prenom, c.telephone, c.address,
             s.name AS service_name
      FROM bookings b
      JOIN clients c ON c.id = b.client_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme' AND b.slot_datetime IS NOT NULL
      ORDER BY b.slot_datetime ASC
    `);
    const tomorrowBookings = rows.filter(b => brusselsDateKey(b.slot_datetime) === tomorrowKey);
    await sendDailyReminderEmail({ bookings: tomorrowBookings, dateLabel: tomorrowLabel });
  } catch (e) {
    console.error('[Hairsprit] Erreur lors du rappel quotidien:', e.message);
  }
}

function startReminderScheduler() {
  checkAndSendDailyReminder(); // au cas où le serveur redémarre pile dans la fenêtre de 8h
  setInterval(checkAndSendDailyReminder, 5 * 60 * 1000); // vérifie toutes les 5 minutes
}

module.exports = { startReminderScheduler };
