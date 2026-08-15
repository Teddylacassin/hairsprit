const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireClientAuth, verifyToken } = require('../middleware/auth');
const { sendBookingAlertEmail } = require('../notify');
const pointsEmitter = require('../events');

const router = express.Router();

// Convertit une date+heure exprimée en heure de Belgique vers l'instant UTC correspondant
// (gère automatiquement le changement heure d'été/hiver)
function brusselsDateStr(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
}
function zonedTimeToUtc(dateStr, hh, mm, timeZone) {
  const naiveUTC = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const tzDate = new Date(naiveUTC.toLocaleString('en-US', { timeZone }));
  const utcDate = new Date(naiveUTC.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return new Date(naiveUTC.getTime() + offset);
}

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

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

// POST /api/client/register
router.post('/register', async (req, res) => {
  try {
    const { nom, prenom, telephone, address, pin, ref } = req.body;
    if (!nom || !prenom || !telephone) {
      return res.status(400).json({ error: 'Nom, prénom et téléphone sont obligatoires.' });
    }
    if (!isValidPin(pin)) {
      return res.status(400).json({ error: 'Choisissez un code PIN à 4 chiffres.' });
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
    const pinHash = bcrypt.hashSync(pin, 10);
    await db.run('INSERT INTO clients (id, nom, prenom, telephone, address, qr_token, points, pin_hash) VALUES (?,?,?,?,?,?,0,?)',
      [id, nom.trim(), prenom.trim(), tel, (address || '').trim() || null, qrToken, pinHash]);

    // Bonus de parrainage : si le client arrive via le lien/QR d'un ami, les deux reçoivent 1 point
    if (ref) {
      const referrer = await db.get('SELECT * FROM clients WHERE qr_token = ?', [ref]);
      if (referrer && referrer.id !== id) {
        await db.run('UPDATE clients SET points = points + 1 WHERE id = ?', [id]);
        await db.run('INSERT INTO visits (id, client_id, points_added, note) VALUES (?,?,?,?)',
          [uuidv4(), id, 1, 'Bonus de bienvenue - parrainage']);
        await db.run('UPDATE clients SET points = points + 1 WHERE id = ?', [referrer.id]);
        await db.run('INSERT INTO visits (id, client_id, points_added, note) VALUES (?,?,?,?)',
          [uuidv4(), referrer.id, 1, `Parrainage - ${nom.trim()} ${prenom.trim()} a rejoint Hairsprit`]);
      }
    }

    const client = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
    const token = signToken({ id, role: 'client' });
    res.json({ token, client: clientPublic(client) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/client/check-phone -> tells the app whether a PIN already exists for this number
router.post('/check-phone', async (req, res) => {
  const { telephone } = req.body;
  if (!telephone) return res.status(400).json({ error: 'Téléphone requis.' });
  const tel = normalizePhone(telephone);
  const client = await db.get('SELECT id, pin_hash FROM clients WHERE telephone = ?', [tel]);
  if (!client) return res.status(404).json({ error: "Aucun compte trouvé avec ce numéro." });
  res.json({ needsPinSetup: !client.pin_hash });
});

// POST /api/client/set-pin -> for accounts created before the PIN system existed
router.post('/set-pin', async (req, res) => {
  try {
    const { telephone, pin } = req.body;
    if (!isValidPin(pin)) return res.status(400).json({ error: 'Choisissez un code PIN à 4 chiffres.' });
    const tel = normalizePhone(telephone);
    const client = await db.get('SELECT * FROM clients WHERE telephone = ?', [tel]);
    if (!client) return res.status(404).json({ error: "Aucun compte trouvé avec ce numéro." });
    if (client.pin_hash) return res.status(409).json({ error: 'Un code PIN est déjà configuré. Connectez-vous normalement.' });
    const pinHash = bcrypt.hashSync(pin, 10);
    await db.run('UPDATE clients SET pin_hash = ? WHERE id = ?', [pinHash, client.id]);
    const token = signToken({ id: client.id, role: 'client' });
    res.json({ token, client: clientPublic(client) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/client/login
router.post('/login', async (req, res) => {
  try {
    const { telephone, pin } = req.body;
    if (!telephone || !pin) return res.status(400).json({ error: 'Téléphone et code PIN requis.' });
    const tel = normalizePhone(telephone);
    const client = await db.get('SELECT * FROM clients WHERE telephone = ?', [tel]);
    if (!client) return res.status(404).json({ error: "Aucun compte trouvé avec ce numéro." });
    if (!client.pin_hash) return res.status(409).json({ error: 'Aucun code PIN configuré pour ce compte.' });
    const ok = bcrypt.compareSync(pin, client.pin_hash);
    if (!ok) return res.status(401).json({ error: 'Code PIN incorrect.' });
    const token = signToken({ id: client.id, role: 'client' });
    res.json({ token, client: clientPublic(client) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/client/points-stream?token=... -> flux temps réel (SSE) prévenant le client
// dès qu'un point lui est ajouté. Le token est passé en paramètre d'URL car le navigateur
// ne permet pas d'ajouter d'en-tête d'authentification à ce type de connexion.
router.get('/points-stream', (req, res) => {
  let decoded;
  try {
    decoded = verifyToken(req.query.token);
    if (decoded.role !== 'client') throw new Error('rôle invalide');
  } catch (e) {
    return res.status(401).end();
  }
  const clientId = decoded.id;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n');

  const listener = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { /* connexion fermée */ }
  };
  pointsEmitter.on(`points:${clientId}`, listener);

  const keepAlive = setInterval(() => {
    try { res.write(':\n\n'); } catch (e) { /* connexion fermée */ }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    pointsEmitter.off(`points:${clientId}`, listener);
  });
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

// GET /api/client/qrcode -> data URL of QR encoding qr_token (used by admin scanner)
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

// GET /api/client/referral-qrcode -> QR code encoding the client's personal referral link
router.get('/referral-qrcode', requireClientAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const referralUrl = `https://hairsprit.onrender.com/app?ref=${client.qr_token}`;
  try {
    const dataUrl = await QRCode.toDataURL(referralUrl, {
      margin: 1,
      width: 320,
      color: { dark: '#0B0B0C', light: '#F7F6F3' },
    });
    res.json({ qrcode: dataUrl, url: referralUrl });
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

// GET /api/client/public-services -> active services, no auth required (used by the public landing page)
router.get('/public-services', async (req, res) => {
  const services = await db.all('SELECT id, name, price, description, duration_minutes, group_price FROM services WHERE active = 1 ORDER BY sort_order ASC');
  res.json({ services });
});

router.get('/services', requireClientAuth, async (req, res) => {
  const services = await db.all('SELECT id, name, price, description, duration_minutes, group_price FROM services WHERE active = 1 ORDER BY sort_order ASC');
  res.json({ services });
});

// GET /api/client/available-slots -> compute upcoming available slots from schedule settings
// ?duration=N (minutes) -> durée totale nécessaire (ex: plusieurs personnes). Par défaut, durée du créneau standard.
router.get('/available-slots', requireClientAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM schedule_settings WHERE id = ?', ['default']);
  if (!settings) return res.json({ slots: [] });

  const openDays = settings.open_days.split(',').map(d => parseInt(d, 10));
  const [startH, startM] = settings.start_time.split(':').map(Number);
  const [endH, endM] = settings.end_time.split(':').map(Number);
  const gridStep = settings.slot_duration_minutes;
  const travelBuffer = settings.travel_buffer_minutes || 0;
  const requestedDuration = Math.max(15, parseInt(req.query.duration, 10) || gridStep);

  // Fenêtres occupées : réservations existantes (avec leur propre durée totale) + créneaux bloqués manuellement
  // On ajoute la marge de trajet de part et d'autre pour laisser le temps de se déplacer
  const bookingRows = await db.all(
    `SELECT slot_datetime, total_duration_minutes FROM bookings WHERE slot_datetime IS NOT NULL AND status != 'annule' AND slot_datetime >= now() - interval '1 day'`
  );
  const blockedSlotRows = await db.all('SELECT slot_datetime FROM blocked_slots');
  const occupied = [
    ...bookingRows.map(r => ({
      start: new Date(r.slot_datetime).getTime() - travelBuffer * 60000,
      end: new Date(r.slot_datetime).getTime() + (r.total_duration_minutes || gridStep) * 60000 + travelBuffer * 60000,
    })),
    ...blockedSlotRows.map(r => ({
      start: new Date(r.slot_datetime).getTime() - travelBuffer * 60000,
      end: new Date(r.slot_datetime).getTime() + gridStep * 60000 + travelBuffer * 60000,
    })),
  ];

  function overlaps(startMs, endMs) {
    return occupied.some(o => startMs < o.end && o.start < endMs);
  }

  const blockedRows = await db.all('SELECT blocked_date FROM blocked_dates');
  const blockedDates = new Set(blockedRows.map(r => new Date(r.blocked_date).toISOString().slice(0, 10)));

  const slots = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const dayInstant = new Date(now.getTime() + dayOffset * 86400000);
    const dateStr = brusselsDateStr(dayInstant);
    const weekday = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    if (!openDays.includes(weekday)) continue;
    if (blockedDates.has(dateStr)) continue;

    let cursor = zonedTimeToUtc(dateStr, startH, startM, 'Europe/Brussels');
    const dayEnd = zonedTimeToUtc(dateStr, endH, endM, 'Europe/Brussels');

    while (cursor.getTime() + requestedDuration * 60000 <= dayEnd.getTime()) {
      const startMs = cursor.getTime();
      const endMs = startMs + requestedDuration * 60000;
      if (startMs > now.getTime() && !overlaps(startMs, endMs)) {
        slots.push(new Date(startMs).toISOString());
      }
      cursor = new Date(cursor.getTime() + gridStep * 60000);
    }
  }

  res.json({ slots, durationMinutes: requestedDuration });
});

// GET /api/client/bookings -> client's own booking requests with status
router.get('/bookings', requireClientAuth, async (req, res) => {
  const bookings = await db.all(
    `SELECT b.id, b.message, b.status, b.slot_datetime, b.created_at, b.people_count, b.total_duration_minutes, b.booking_details,
            s.name AS service_name, s.price AS service_price
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
  const { message, slot_datetime, service_id, people_count, total_duration_minutes, booking_details } = req.body;
  const id = uuidv4();
  const duration = parseInt(total_duration_minutes, 10) || 30;

  if (slot_datetime) {
    const startMs = new Date(slot_datetime).getTime();
    const endMs = startMs + duration * 60000;
    const settings = await db.get('SELECT slot_duration_minutes, travel_buffer_minutes FROM schedule_settings WHERE id = ?', ['default']);
    const gridStep = settings ? settings.slot_duration_minutes : 30;
    const travelBuffer = settings ? (settings.travel_buffer_minutes || 0) : 0;

    const others = await db.all(
      `SELECT slot_datetime, total_duration_minutes FROM bookings WHERE slot_datetime IS NOT NULL AND status != 'annule'`
    );
    const blockedSlots = await db.all('SELECT slot_datetime FROM blocked_slots');
    const occupied = [
      ...others.map(r => ({
        start: new Date(r.slot_datetime).getTime() - travelBuffer * 60000,
        end: new Date(r.slot_datetime).getTime() + (r.total_duration_minutes || gridStep) * 60000 + travelBuffer * 60000,
      })),
      ...blockedSlots.map(r => ({
        start: new Date(r.slot_datetime).getTime() - travelBuffer * 60000,
        end: new Date(r.slot_datetime).getTime() + gridStep * 60000 + travelBuffer * 60000,
      })),
    ];
    const conflict = occupied.some(o => startMs < o.end && o.start < endMs);
    if (conflict) {
      return res.status(409).json({ error: 'Ce créneau vient d\'être réservé par quelqu\'un d\'autre. Choisissez-en un autre.' });
    }
  }

  const peopleCountVal = Math.max(1, parseInt(people_count, 10) || 1);

  await db.run('INSERT INTO bookings (id, client_id, message, slot_datetime, service_id, people_count, total_duration_minutes, booking_details) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.clientId, (message || '').trim().slice(0, 500), slot_datetime || null, service_id || null, peopleCountVal, duration, (booking_details || '').trim().slice(0, 800) || null]);

  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
  let serviceName = null;
  if (service_id) {
    const service = await db.get('SELECT name FROM services WHERE id = ?', [service_id]);
    serviceName = service ? service.name : null;
  }
  sendBookingAlertEmail({
    client,
    message: (message || '').trim(),
    slotDatetime: slot_datetime,
    serviceName,
    peopleCount: peopleCountVal,
    bookingDetails: booking_details,
  }).catch(() => {});

  res.json({ ok: true, bookingId: id });
});

// GET /api/client/style-profile -> mes préférences coiffure + les photos ajoutées par le barbier
router.get('/style-profile', requireClientAuth, async (req, res) => {
  const profile = await db.get('SELECT * FROM client_style_profile WHERE client_id = ?', [req.clientId]);
  const photos = await db.all('SELECT id, photo_data, caption, created_at FROM client_style_photos WHERE client_id = ? ORDER BY created_at DESC', [req.clientId]);
  res.json({
    profile: profile || { last_cut: '', usual_length: '', beard: '', products: '' },
    photos,
  });
});

// PUT /api/client/style-profile -> le client renseigne lui-même ses préférences (pas les photos)
router.put('/style-profile', requireClientAuth, async (req, res) => {
  const { last_cut, usual_length, beard, products } = req.body;
  const existing = await db.get('SELECT client_id FROM client_style_profile WHERE client_id = ?', [req.clientId]);
  if (existing) {
    await db.run(
      'UPDATE client_style_profile SET last_cut=?, usual_length=?, beard=?, products=?, updated_at=now() WHERE client_id=?',
      [(last_cut || '').trim().slice(0, 500), (usual_length || '').trim().slice(0, 200), (beard || '').trim().slice(0, 200), (products || '').trim().slice(0, 500), req.clientId]
    );
  } else {
    await db.run(
      'INSERT INTO client_style_profile (client_id, last_cut, usual_length, beard, products) VALUES (?,?,?,?,?)',
      [req.clientId, (last_cut || '').trim().slice(0, 500), (usual_length || '').trim().slice(0, 200), (beard || '').trim().slice(0, 200), (products || '').trim().slice(0, 500)]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
