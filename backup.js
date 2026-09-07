// Sauvegarde automatique quotidienne de toute la base de données.
// Envoie un export JSON complet par email, en pièce jointe — indépendant de Neon
// (qui ne garde que 6h d'historique en plan gratuit). Permet de restaurer les données
// manuellement en cas de gros problème (suppression accidentelle, corruption, etc.).
const db = require('./db');

const TABLES = [
  'clients', 'visits', 'rewards', 'services', 'products', 'orders', 'order_items',
  'bookings', 'manual_revenue', 'schedule_settings', 'blocked_dates', 'blocked_slots',
  'reviews', 'admins', 'client_style_profile', 'client_style_photos', 'urgent_availability',
  'expenses', 'communes', 'live_trip', 'accounting_settings', 'bank_transactions',
];

async function generateBackup() {
  const backup = { generated_at: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    try {
      backup.tables[table] = await db.all(`SELECT * FROM ${table}`);
    } catch (e) {
      backup.tables[table] = { error: e.message };
    }
  }
  return backup;
}

async function sendBackupEmail() {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !toEmail) {
    console.log('[Hairsprit] Sauvegarde non envoyée : RESEND_API_KEY ou NOTIFY_EMAIL manquant.');
    return;
  }

  const backup = await generateBackup();
  const jsonStr = JSON.stringify(backup, null, 2);
  const base64Content = Buffer.from(jsonStr, 'utf-8').toString('base64');
  const sizeMB = (base64Content.length / (1024 * 1024)).toFixed(2);
  const dateStr = new Date().toISOString().slice(0, 10);

  const totalRows = Object.values(backup.tables).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">💾 Sauvegarde quotidienne Hairsprit</h2>
      <p style="color:#555;">Export complet de ta base de données du ${dateStr}, en pièce jointe (fichier JSON).</p>
      <p style="color:#555;">${totalRows} lignes au total, ${sizeMB} Mo.</p>
      <p style="color:#999;font-size:12px;margin-top:20px;">Garde cet email de côté — en cas de gros problème, ce fichier permet de récupérer toutes tes données (clients, réservations, comptabilité...).</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Hairsprit <contact@mail.hairsprit.be>',
        to: [toEmail],
        subject: `💾 Sauvegarde Hairsprit — ${dateStr}`,
        html,
        attachments: [
          { content: base64Content, filename: `hairsprit-backup-${dateStr}.json` },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[Hairsprit] Erreur envoi sauvegarde:', res.status, await res.text());
    } else {
      console.log(`[Hairsprit] Sauvegarde envoyée avec succès (${totalRows} lignes, ${sizeMB} Mo).`);
    }
  } catch (e) {
    console.error('[Hairsprit] Erreur envoi sauvegarde:', e.message);
  }
}

async function checkAndSendDailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const state = await db.get('SELECT * FROM backup_state WHERE id = ?', ['default']);
  const lastSent = state && state.last_sent_date ? new Date(state.last_sent_date).toISOString().slice(0, 10) : null;
  if (lastSent === today) return; // déjà envoyée aujourd'hui, on ne renvoie pas

  await sendBackupEmail();

  if (state) {
    await db.run('UPDATE backup_state SET last_sent_date = ? WHERE id = ?', [today, 'default']);
  } else {
    await db.run('INSERT INTO backup_state (id, last_sent_date) VALUES (?,?)', ['default', today]);
  }
}

function startBackupScheduler() {
  // Vérifie toutes les 30 minutes si la sauvegarde du jour a déjà été envoyée.
  // Résiste aux redémarrages/redéploiements fréquents : jamais plus d'une sauvegarde par jour.
  checkAndSendDailyBackup().catch(e => console.error(e));
  setInterval(() => { checkAndSendDailyBackup().catch(e => console.error(e)); }, 30 * 60 * 1000);
}

module.exports = { generateBackup, sendBackupEmail, checkAndSendDailyBackup, startBackupScheduler };
