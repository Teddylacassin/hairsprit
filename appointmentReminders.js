// Envoie un rappel par email au client entre 20h et 30h avant son rendez-vous confirmé,
// s'il a renseigné son adresse email.
const db = require('./db');
const { sendAppointmentReminderEmail } = require('./notify');

async function checkAndSendAppointmentReminders() {
  try {
    const rows = await db.all(`
      SELECT b.id AS booking_id, b.slot_datetime, b.booking_details, c.*
      FROM bookings b
      JOIN clients c ON c.id = b.client_id
      WHERE b.status = 'confirme'
        AND b.reminder_sent = false
        AND c.email IS NOT NULL AND c.email != ''
        AND b.slot_datetime >= now() + interval '20 hours'
        AND b.slot_datetime <= now() + interval '30 hours'
    `);

    for (const row of rows) {
      const ok = await sendAppointmentReminderEmail({
        client: row,
        booking: { slot_datetime: row.slot_datetime, booking_details: row.booking_details },
      });
      if (ok) {
        await db.run('UPDATE bookings SET reminder_sent = true WHERE id = ?', [row.booking_id]);
        console.log(`[Hairsprit] Rappel de RDV envoyé à ${row.prenom} ${row.nom} (${row.email})`);
      }
    }
  } catch (e) {
    console.error('[Hairsprit] Erreur planificateur rappels RDV client:', e.message);
  }
}

function startAppointmentReminderScheduler() {
  checkAndSendAppointmentReminders();
  setInterval(checkAndSendAppointmentReminders, 30 * 60 * 1000);
}

module.exports = { startAppointmentReminderScheduler };
