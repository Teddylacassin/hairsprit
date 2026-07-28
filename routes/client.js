const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const db = require('../db');
const { signToken, requireClientAuth } = require('../middleware/auth');

const router = express.Router();

function normalizePhone(tel) {
  return String(tel || '').replace(/[\s.\-()]/g, '');
}

function clientPublic(client) {
  return {
    id: client.id,
    nom: client.nom,
    prenom: client.prenom,
    telephone: client.telephone,
    points: client.points,
    created_at: client.created_at,
  };
}

// POST /api/client/register
router.post('/register', async (req, res) => {
  try {
    const { nom, prenom, telephone } = req.body;
    if (!nom || !prenom || !telephone) {
      return res.status(400).json({ error: 'Nom, prénom et téléphone sont obligatoires.' });
    }
    const tel = normalizePhone(telephone);
    if (tel.length < 8) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    }

    const existing = await db.get('SELECT * FROM clients WHERE telephone = ?', [tel]);
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro. Connectez-vous.' });
    }

    const id = uuidv4();
    const qrToken = uuidv4();
    await db.run('INSERT INTO clients (id, nom, prenom, telephone, qr_token, points) VALUES (?,?,?,?,?,0)',
      [id, nom.trim(), prenom.trim(), tel, qrToken]);

    const client = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
    const token = signToken({ id, role: 'client' });
    res.json({ token, client: clientPublic(client) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/client/login
router.post('/login', async (req, res) => {
  try {
    const { telephone } = req.body;
    if (!telephone) return res.status(400).json({ error: 'Téléphone requis.' });
    const tel = normalizePhone(telephone);
    const client = await db.get('SELECT * FROM clients WHERE telephone = ?', [tel]);
    if (!client) return res.status(404).json({ error: "Aucun compte trouvé avec ce numéro." });
    const token = signToken({ id: client.id, role: 'client' });
    res.json({ token, client: clientPublic(client) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/client/me
router.get('/me', requireClientAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  res.json({ client: clientPublic(client) });
});

// GET /api/client/qrcode -> data URL of QR encoding qr_token
router.get('/qrcode', requireClientAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  try {
    const dataUrl = await QRCode.toDataURL(client.qr_token, {
      margin: 1,
      width: 320,
      color: { dark: '#0B0B0C', light: '#F7F6F3' },
    });
    res.json({ qrcode: dataUrl });
  } catch (e) {
    res.status(500).json({ error: 'Erreur de génération du QR code.' });
  }
});

// GET /api/client/history
router.get('/history', requireClientAuth, async (req, res) => {
  const visits = await db.all('SELECT id, points_added, note, created_at FROM visits WHERE client_id = ? ORDER BY created_at DESC', [req.clientId]);
  res.json({ visits });
});

// GET /api/client/rewards -> active rewards list
router.get('/rewards', requireClientAuth, async (req, res) => {
  const rewards = await db.all('SELECT id, name, points_required, description FROM rewards WHERE active = 1 ORDER BY sort_order ASC');
  res.json({ rewards });
});

// GET /api/client/available-slots -> compute upcoming available slots from schedule settings
router.get('/available-slots', requireClientAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM schedule_settings WHERE id = ?', ['default']);
  if (!settings) return res.json({ slots: [] });

  const openDays = settings.open_days.split(',').map(d => parseInt(d, 10));
  const [startH, startM] = settings.start_time.split(':').map(Number);
  const [endH, endM] = settings.end_time.split(':').map(Number);
  const duration = settings.slot_duration_minutes;

  const takenRows = await db.all(
    `SELECT slot_datetime FROM bookings WHERE slot_datetime IS NOT NULL AND status != 'annule' AND slot_datetime >= now()`
  );
  const taken = new Set(takenRows.map(r => new Date(r.slot_datetime).toISOString()));

  const slots = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);
    if (!openDays.includes(day.getDay())) continue;

    let cursor = new Date(day);
    cursor.setHours(startH, startM, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(endH, endM, 0, 0);

    while (cursor.getTime() + duration * 60000 <= dayEnd.getTime()) {
      if (cursor.getTime() > now.getTime()) {
        const iso = cursor.toISOString();
        if (!taken.has(iso)) {
          slots.push(iso);
        }
      }
      cursor = new Date(cursor.getTime() + duration * 60000);
    }
  }

  res.json({ slots, durationMinutes: duration });
});

// POST /api/client/booking
router.post('/booking', requireClientAuth, async (req, res) => {
  const { message, slot_datetime } = req.body;
  const id = uuidv4();

  if (slot_datetime) {
    const existing = await db.get(
      `SELECT id FROM bookings WHERE slot_datetime = ? AND status != 'annule'`,
      [slot_datetime]
    );
    if (existing) {
      return res.status(409).json({ error: 'Ce créneau vient d\'être réservé par quelqu\'un d\'autre. Choisissez-en un autre.' });
    }
  }

  await db.run('INSERT INTO bookings (id, client_id, message, slot_datetime) VALUES (?,?,?,?)',
    [id, req.clientId, (message || '').trim().slice(0, 500), slot_datetime || null]);
  res.json({ ok: true, bookingId: id });
});

module.exports = router;
