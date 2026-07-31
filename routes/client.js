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
    address: client.address,
    points: client.points,
    created_at: client.created_at,
  };
}

// POST /api/client/register
router.post('/register', async (req, res) => {
  try {
    const { nom, prenom, telephone, address } = req.body;
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
    await db.run('INSERT INTO clients (id, nom, prenom, telephone, address, qr_token, points) VALUES (?,?,?,?,?,?,0)',
      [id, nom.trim(), prenom.trim(), tel, (address || '').trim() || null, qrToken]);

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

// PUT /api/client/me -> update own address
router.put('/me', requireClientAuth, async (req, res) => {
  const { address } = req.body;
  await db.run('UPDATE clients SET address = ? WHERE id = ?', [
    (address || '').trim() || null,
    req.clientId,
  ]);
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
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

// GET /api/client/services -> active services (tarifs) list
router.get('/services', requireClientAuth, async (req, res) => {
  const services = await db.all('SELECT id, name, price, description FROM services WHERE active = 1 ORDER BY sort_order ASC');
  res.json({ services });
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

  const blockedSlotRows = await db.all('SELECT slot_datetime FROM blocked_slots');
  blockedSlotRows.forEach(r => taken.add(new Date(r.slot_datetime).toISOString()));

  const blockedRows = await db.all('SELECT blocked_date FROM blocked_dates');
  const blockedDates = new Set(blockedRows.map(r => new Date(r.blocked_date).toISOString().slice(0, 10)));

  const slots = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);
    if (!openDays.includes(day.getDay())) continue;
    if (blockedDates.has(day.toISOString().slice(0, 10))) continue;

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

// GET /api/client/bookings -> client's own booking requests with status
router.get('/bookings', requireClientAuth, async (req, res) => {
  const bookings = await db.all(
    `SELECT b.id, b.message, b.status, b.slot_datetime, b.created_at, s.name AS service_name, s.price AS service_price
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     WHERE b.client_id = ? ORDER BY b.created_at DESC`,
    [req.clientId]
  );
  res.json({ bookings });
});

// PUT /api/client/booking/:id/cancel -> cancel own booking
router.put('/booking/:id/cancel', requireClientAuth, async (req, res) => {
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking || booking.client_id !== req.clientId) {
    return res.status(404).json({ error: 'Réservation introuvable.' });
  }
  if (booking.status === 'annule') {
    return res.status(400).json({ error: 'Cette réservation est déjà annulée.' });
  }
  await db.run('UPDATE bookings SET status = ? WHERE id = ?', ['annule', req.params.id]);
  res.json({ ok: true });
});

// POST /api/client/booking
router.post('/booking', requireClientAuth, async (req, res) => {
  const { message, slot_datetime, service_id } = req.body;
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

  await db.run('INSERT INTO bookings (id, client_id, message, slot_datetime, service_id) VALUES (?,?,?,?,?)',
    [id, req.clientId, (message || '').trim().slice(0, 500), slot_datetime || null, service_id || null]);

  res.json({ ok: true, bookingId: id });
});

module.exports = router;
