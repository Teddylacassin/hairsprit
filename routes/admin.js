const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAdminAuth } = require('../middleware/auth');
const pointsEmitter = require('../events');
const { geocodeAddress } = require('../geocode');
const { sendDepartureAlertEmail } = require('../notify');
const { syncBankTransactions } = require('../bankSync');

const router = express.Router();

// Convertit une date+heure exprimée en heure de Belgique vers l'instant UTC correspondant
function zonedTimeToUtc(dateStr, hh, mm, timeZone) {
  const naiveUTC = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const tzDate = new Date(naiveUTC.toLocaleString('en-US', { timeZone }));
  const utcDate = new Date(naiveUTC.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return new Date(naiveUTC.getTime() + offset);
}

function clientPublic(client) {
  return {
    id: client.id,
    nom: client.nom,
    prenom: client.prenom,
    telephone: client.telephone,
    address: client.address,
    email: client.email,
    admin_notes: client.admin_notes,
    points: client.points,
    created_at: client.created_at,
  };
}

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Identifiants requis.' });
    const admin = await db.get('SELECT * FROM admins WHERE username = ?', [username.trim()]);
    if (!admin) return res.status(401).json({ error: 'Identifiants incorrects.' });
    const ok = bcrypt.compareSync(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Identifiants incorrects.' });
    const token = signToken({ id: admin.id, role: 'admin' });
    res.json({ token, username: admin.username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/admin/client-by-qr/:qrToken -> lookup client via scanned QR
router.get('/client-by-qr/:qrToken', requireAdminAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE qr_token = ?', [req.params.qrToken]);
  if (!client) return res.status(404).json({ error: 'QR code inconnu — client introuvable.' });
  res.json({ client: clientPublic(client) });
});

// POST /api/admin/client/:id/redeem -> use a reward, deduct points
router.post('/client/:id/redeem', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });

  const { reward_id } = req.body;
  const reward = await db.get('SELECT * FROM rewards WHERE id = ?', [reward_id]);
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable.' });

  if (targetClient.points < reward.points_required) {
    return res.status(400).json({ error: 'Ce client n\'a pas assez de points pour cette récompense.' });
  }

  const dbClient = await db.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('UPDATE clients SET points = points - $1 WHERE id = $2', [reward.points_required, targetClient.id]);
    await dbClient.query('INSERT INTO visits (id, client_id, points_added, note) VALUES ($1,$2,$3,$4)',
      [uuidv4(), targetClient.id, -reward.points_required, `Récompense utilisée : ${reward.name}`]);
    await dbClient.query('COMMIT');
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }

  const updated = await db.get('SELECT * FROM clients WHERE id = ?', [targetClient.id]);
  res.json({ client: clientPublic(updated) });
});

// PUT /api/admin/client/:id/notes -> save private notes about a client
router.put('/client/:id/notes', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });
  const { notes } = req.body;
  await db.run('UPDATE clients SET admin_notes = ? WHERE id = ?', [(notes || '').trim().slice(0, 1000) || null, req.params.id]);
  res.json({ ok: true });
});

router.put('/client/:id/reset-pin', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });
  await db.run('UPDATE clients SET pin_hash = NULL WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.post('/client/:id/reset', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });

  const dbClient = await db.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('INSERT INTO visits (id, client_id, points_added, note) VALUES ($1,$2,$3,$4)',
      [uuidv4(), targetClient.id, -targetClient.points, 'Récompense réclamée : points réinitialisés']);
    await dbClient.query('UPDATE clients SET points = 0 WHERE id = $1', [targetClient.id]);
    await dbClient.query('COMMIT');
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }

  const updated = await db.get('SELECT * FROM clients WHERE id = ?', [targetClient.id]);
  pointsEmitter.emit(`points:${targetClient.id}`, { type: 'reset', points: 0 });
  res.json({ client: clientPublic(updated) });
});

// POST /api/admin/client/:id/point -> add a point after a service
router.post('/client/:id/point', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });

  const points = Math.max(1, parseInt(req.body.points, 10) || 1);
  const note = (req.body.note || 'Prestation en salon').trim().slice(0, 200);

  const dbClient = await db.pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('UPDATE clients SET points = points + $1 WHERE id = $2', [points, targetClient.id]);
    await dbClient.query('INSERT INTO visits (id, client_id, points_added, note) VALUES ($1,$2,$3,$4)',
      [uuidv4(), targetClient.id, points, note]);
    await dbClient.query('COMMIT');
  } catch (e) {
    await dbClient.query('ROLLBACK');
    throw e;
  } finally {
    dbClient.release();
  }

  const updated = await db.get('SELECT * FROM clients WHERE id = ?', [targetClient.id]);
  pointsEmitter.emit(`points:${targetClient.id}`, { type: 'point_added', points: updated.points, added: points });
  res.json({ client: clientPublic(updated) });
});

// GET /api/admin/clients -> list all clients (with optional search)
router.get('/clients', requireAdminAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = await db.all(`SELECT * FROM clients WHERE nom ILIKE ? OR prenom ILIKE ? OR telephone ILIKE ? ORDER BY created_at DESC`,
      [like, like, like]);
  } else {
    rows = await db.all('SELECT * FROM clients ORDER BY created_at DESC');
  }
  res.json({ clients: rows.map(clientPublic) });
});

// POST /api/admin/clients -> manually create a client (walk-in, no app yet)
router.post('/clients', requireAdminAuth, async (req, res) => {
  const { nom, prenom, telephone, address } = req.body;
  if (!nom || !prenom || !telephone) {
    return res.status(400).json({ error: 'Nom, prénom et téléphone sont obligatoires.' });
  }
  const tel = String(telephone).replace(/[\s.\-()]/g, '');
  const existing = await db.get('SELECT id FROM clients WHERE telephone = ?', [tel]);
  if (existing) {
    return res.status(409).json({ error: 'Un client existe déjà avec ce numéro.' });
  }
  const id = uuidv4();
  const qrToken = uuidv4();
  await db.run('INSERT INTO clients (id, nom, prenom, telephone, address, qr_token, points) VALUES (?,?,?,?,?,?,0)',
    [id, nom.trim(), prenom.trim(), tel, (address || '').trim() || null, qrToken]);
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
  res.json({ client: clientPublic(client) });
});

// GET /api/admin/client/:id -> single client detail + history
router.get('/client/:id', requireAdminAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const visits = await db.all('SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC', [client.id]);
  res.json({ client: clientPublic(client), visits });
});

// PUT /api/admin/client/:id -> edit client's phone and/or address
router.put('/client/:id', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });

  const { telephone, address, email } = req.body;
  let tel = targetClient.telephone;
  if (telephone !== undefined) {
    tel = String(telephone).replace(/[\s.\-()]/g, '');
    if (tel.length < 8) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    if (tel !== targetClient.telephone) {
      const existing = await db.get('SELECT id FROM clients WHERE telephone = ? AND id != ?', [tel, req.params.id]);
      if (existing) return res.status(409).json({ error: 'Un autre client utilise déjà ce numéro.' });
    }
  }
  let emailVal = targetClient.email;
  if (email !== undefined) {
    const emailTrimmed = (email || '').trim();
    if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      return res.status(400).json({ error: 'Adresse email invalide.' });
    }
    emailVal = emailTrimmed || null;
  }

  await db.run('UPDATE clients SET telephone = ?, address = ?, email = ? WHERE id = ?', [
    tel,
    address !== undefined ? ((address || '').trim() || null) : targetClient.address,
    emailVal,
    req.params.id,
  ]);
  const updated = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  res.json({ client: clientPublic(updated) });
});

// REWARDS CRUD
router.get('/rewards', requireAdminAuth, async (req, res) => {
  const rewards = await db.all('SELECT * FROM rewards ORDER BY sort_order ASC');
  res.json({ rewards });
});

router.post('/rewards', requireAdminAuth, async (req, res) => {
  const { name, points_required, description } = req.body;
  if (!name || !points_required) return res.status(400).json({ error: 'Nom et points requis.' });
  const id = uuidv4();
  const maxOrderRow = await db.get('SELECT COALESCE(MAX(sort_order),0) as m FROM rewards');
  const maxOrder = parseInt(maxOrderRow.m, 10);
  await db.run('INSERT INTO rewards (id, name, points_required, description, sort_order) VALUES (?,?,?,?,?)',
    [id, name.trim(), parseInt(points_required, 10), (description || '').trim(), maxOrder + 1]);
  res.json({ ok: true, id });
});

router.put('/rewards/:id', requireAdminAuth, async (req, res) => {
  const reward = await db.get('SELECT * FROM rewards WHERE id = ?', [req.params.id]);
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable.' });
  const { name, points_required, description, active } = req.body;
  await db.run('UPDATE rewards SET name=?, points_required=?, description=?, active=? WHERE id=?', [
    name !== undefined ? name.trim() : reward.name,
    points_required !== undefined ? parseInt(points_required, 10) : reward.points_required,
    description !== undefined ? description.trim() : reward.description,
    active !== undefined ? (active ? 1 : 0) : reward.active,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.delete('/rewards/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM rewards WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// SERVICES (TARIFS) CRUD
router.get('/services', requireAdminAuth, async (req, res) => {
  const services = await db.all('SELECT * FROM services ORDER BY sort_order ASC');
  res.json({ services });
});

router.post('/services', requireAdminAuth, async (req, res) => {
  const { name, price, description, duration_minutes, group_price, is_wedding } = req.body;
  if (!name || price === undefined || price === '') return res.status(400).json({ error: 'Nom et prix requis.' });
  const id = uuidv4();
  const maxOrderRow = await db.get('SELECT COALESCE(MAX(sort_order),0) as m FROM services');
  const maxOrder = parseInt(maxOrderRow.m, 10);
  await db.run('INSERT INTO services (id, name, price, description, duration_minutes, group_price, is_wedding, sort_order) VALUES (?,?,?,?,?,?,?,?)',
    [id, name.trim(), parseFloat(price), (description || '').trim(), parseInt(duration_minutes, 10) || 30, (group_price !== undefined && group_price !== '') ? parseFloat(group_price) : null, !!is_wedding, maxOrder + 1]);
  res.json({ ok: true, id });
});

router.put('/services/:id', requireAdminAuth, async (req, res) => {
  const service = await db.get('SELECT * FROM services WHERE id = ?', [req.params.id]);
  if (!service) return res.status(404).json({ error: 'Prestation introuvable.' });
  const { name, price, description, duration_minutes, group_price, active, is_wedding } = req.body;
  await db.run('UPDATE services SET name=?, price=?, description=?, duration_minutes=?, group_price=?, active=?, is_wedding=? WHERE id=?', [
    name !== undefined ? name.trim() : service.name,
    price !== undefined ? parseFloat(price) : service.price,
    description !== undefined ? description.trim() : service.description,
    duration_minutes !== undefined ? (parseInt(duration_minutes, 10) || service.duration_minutes) : service.duration_minutes,
    group_price !== undefined ? ((group_price === '' || group_price === null) ? null : parseFloat(group_price)) : service.group_price,
    active !== undefined ? (active ? 1 : 0) : service.active,
    is_wedding !== undefined ? !!is_wedding : service.is_wedding,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.delete('/services/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM services WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/schedule -> get schedule settings
router.get('/schedule', requireAdminAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM schedule_settings WHERE id = ?', ['default']);
  res.json({ settings });
});

// PUT /api/admin/schedule -> update schedule settings
router.put('/schedule', requireAdminAuth, async (req, res) => {
  const { open_days, start_time, end_time, slot_duration_minutes, travel_buffer_minutes } = req.body;
  if (!open_days || !start_time || !end_time || !slot_duration_minutes) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  await db.run(
    'UPDATE schedule_settings SET open_days = ?, start_time = ?, end_time = ?, slot_duration_minutes = ?, travel_buffer_minutes = ? WHERE id = ?',
    [open_days, start_time, end_time, parseInt(slot_duration_minutes, 10), parseInt(travel_buffer_minutes, 10) || 0, 'default']
  );
  res.json({ ok: true });
});

// GET /api/admin/blocked-dates -> list all blocked dates
router.get('/blocked-dates', requireAdminAuth, async (req, res) => {
  const rows = await db.all('SELECT id, blocked_date, reason FROM blocked_dates ORDER BY blocked_date ASC');
  res.json({ blockedDates: rows });
});

// POST /api/admin/blocked-dates -> block a date
router.post('/blocked-dates', requireAdminAuth, async (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise.' });
  const existing = await db.get('SELECT id FROM blocked_dates WHERE blocked_date = ?', [date]);
  if (existing) return res.status(409).json({ error: 'Cette date est déjà bloquée.' });
  const id = uuidv4();
  await db.run('INSERT INTO blocked_dates (id, blocked_date, reason) VALUES (?,?,?)', [id, date, (reason || '').trim().slice(0, 200)]);
  res.json({ ok: true, id });
});

// DELETE /api/admin/blocked-dates/:id -> unblock a date
router.delete('/blocked-dates/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM blocked_dates WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/slots-for-date/:date -> compute the schedule's fixed slot times for a given date
router.get('/slots-for-date/:date', requireAdminAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM schedule_settings WHERE id = ?', ['default']);
  if (!settings) return res.json({ slots: [] });

  const [startH, startM] = settings.start_time.split(':').map(Number);
  const [endH, endM] = settings.end_time.split(':').map(Number);
  const duration = settings.slot_duration_minutes;

  let cursor = zonedTimeToUtc(req.params.date, startH, startM, 'Europe/Brussels');
  const dayEnd = zonedTimeToUtc(req.params.date, endH, endM, 'Europe/Brussels');

  const takenRows = await db.all(
    `SELECT slot_datetime FROM bookings WHERE slot_datetime IS NOT NULL AND status != 'annule'`
  );
  const taken = new Set(takenRows.map(r => new Date(r.slot_datetime).toISOString()));
  const blockedRows = await db.all('SELECT slot_datetime FROM blocked_slots');
  const blocked = new Set(blockedRows.map(r => new Date(r.slot_datetime).toISOString()));

  const slots = [];
  while (cursor.getTime() + duration * 60000 <= dayEnd.getTime()) {
    const iso = cursor.toISOString();
    slots.push({ datetime: iso, taken: taken.has(iso), blocked: blocked.has(iso) });
    cursor = new Date(cursor.getTime() + duration * 60000);
  }

  res.json({ slots });
});

// GET /api/admin/blocked-slots -> list all manually blocked time slots
router.get('/blocked-slots', requireAdminAuth, async (req, res) => {
  const rows = await db.all('SELECT id, slot_datetime, reason FROM blocked_slots WHERE slot_datetime >= now() ORDER BY slot_datetime ASC');
  res.json({ blockedSlots: rows });
});

// POST /api/admin/blocked-slots -> block a specific time slot
router.post('/blocked-slots', requireAdminAuth, async (req, res) => {
  const { slot_datetime, reason } = req.body;
  if (!slot_datetime) return res.status(400).json({ error: 'Créneau requis.' });
  const existing = await db.get('SELECT id FROM blocked_slots WHERE slot_datetime = ?', [slot_datetime]);
  if (existing) return res.status(409).json({ error: 'Ce créneau est déjà bloqué.' });
  const id = uuidv4();
  await db.run('INSERT INTO blocked_slots (id, slot_datetime, reason) VALUES (?,?,?)', [id, slot_datetime, (reason || '').trim().slice(0, 200)]);
  res.json({ ok: true, id });
});

// DELETE /api/admin/blocked-slots/:id -> unblock a time slot
router.delete('/blocked-slots/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM blocked_slots WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/bookings
router.get('/bookings', requireAdminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT b.id, b.client_id, b.message, b.status, b.created_at, b.slot_datetime, b.people_count, b.total_duration_minutes, b.booking_details, b.commune, b.commune_surcharge,
           b.wedding_stage, b.linked_booking_id, b.deposit_amount, b.deposit_paid,
           c.nom, c.prenom, c.telephone, c.address, c.admin_notes,
           s.name AS service_name, s.price AS service_price
    FROM bookings b
    JOIN clients c ON c.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    ORDER BY b.created_at DESC
  `);
  res.json({ bookings: rows });
});

// POST /api/admin/bookings -> manually create a confirmed appointment for a client
router.post('/bookings', requireAdminAuth, async (req, res) => {
  const { client_id, slot_datetime, service_id, message, booking_details } = req.body;
  if (!client_id || !slot_datetime) {
    return res.status(400).json({ error: 'Client et créneau requis.' });
  }
  const client = await db.get('SELECT id FROM clients WHERE id = ?', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });

  const existing = await db.get(
    `SELECT id FROM bookings WHERE slot_datetime = ? AND status != 'annule'`,
    [slot_datetime]
  );
  if (existing) return res.status(409).json({ error: 'Ce créneau est déjà pris.' });

  const id = uuidv4();
  await db.run('INSERT INTO bookings (id, client_id, message, slot_datetime, service_id, booking_details, status) VALUES (?,?,?,?,?,?,?)',
    [id, client_id, (message || '').trim().slice(0, 500), slot_datetime, service_id || null, (booking_details || '').trim().slice(0, 500) || null, 'confirme']);
  res.json({ ok: true, id });
});

// POST /api/admin/bookings/wedding -> crée la formule mariage : 2 RDV liés (essai + jour J) + acompte
router.post('/bookings/wedding', requireAdminAuth, async (req, res) => {
  const { client_id, service_id, essai_datetime, jour_j_datetime, deposit_amount, message } = req.body;
  if (!client_id || !service_id || !essai_datetime || !jour_j_datetime) {
    return res.status(400).json({ error: 'Client, prestation et les deux créneaux sont requis.' });
  }
  const client = await db.get('SELECT id FROM clients WHERE id = ?', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });

  for (const dt of [essai_datetime, jour_j_datetime]) {
    const existing = await db.get(`SELECT id FROM bookings WHERE slot_datetime = ? AND status != 'annule'`, [dt]);
    if (existing) return res.status(409).json({ error: `Le créneau ${new Date(dt).toLocaleString('fr-FR')} est déjà pris.` });
  }

  const depositVal = (deposit_amount !== undefined && deposit_amount !== '' && deposit_amount !== null) ? parseFloat(deposit_amount) : null;

  const essaiId = uuidv4();
  const jourJId = uuidv4();
  await db.run(
    'INSERT INTO bookings (id, client_id, message, slot_datetime, service_id, status, wedding_stage, linked_booking_id, deposit_amount) VALUES (?,?,?,?,?,?,?,?,?)',
    [essaiId, client_id, (message || '').trim().slice(0, 500), essai_datetime, service_id, 'confirme', 'essai', jourJId, depositVal]
  );
  await db.run(
    'INSERT INTO bookings (id, client_id, message, slot_datetime, service_id, status, wedding_stage, linked_booking_id) VALUES (?,?,?,?,?,?,?,?)',
    [jourJId, client_id, (message || '').trim().slice(0, 500), jour_j_datetime, service_id, 'confirme', 'jour_j', essaiId]
  );

  res.json({ ok: true, essaiId, jourJId });
});

// PUT /api/admin/bookings/:id/deposit -> marquer l'acompte reçu ou non
router.put('/bookings/:id/deposit', requireAdminAuth, async (req, res) => {
  const { deposit_paid } = req.body;
  await db.run('UPDATE bookings SET deposit_paid = ? WHERE id = ?', [!!deposit_paid, req.params.id]);
  res.json({ ok: true });
});

router.put('/bookings/:id', requireAdminAuth, async (req, res) => {
  const { status } = req.body;
  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/stats
router.get('/stats', requireAdminAuth, async (req, res) => {
  const totalClientsRow = await db.get('SELECT COUNT(*) c FROM clients');
  const totalVisitsRow = await db.get('SELECT COUNT(*) c FROM visits');
  const totalPointsDistributedRow = await db.get('SELECT COALESCE(SUM(points_added),0) s FROM visits');
  const totalPointsActiveRow = await db.get('SELECT COALESCE(SUM(points),0) s FROM clients');
  const pendingBookingsRow = await db.get(`SELECT COUNT(*) c FROM bookings WHERE status = 'en_attente'`);

  const last30 = await db.all(`
    SELECT date(created_at) as jour, COUNT(*) as visites
    FROM visits
    WHERE created_at >= now() - interval '30 days'
    GROUP BY date(created_at)
    ORDER BY jour ASC
  `);

  const topClients = await db.all(`
    SELECT nom, prenom, points FROM clients ORDER BY points DESC LIMIT 5
  `);

  const newClients30Row = await db.get(`
    SELECT COUNT(*) c FROM clients WHERE created_at >= now() - interval '30 days'
  `);

  const monthRevenueRow = await db.get(`
    SELECT COALESCE(SUM(s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)),0) as total, COUNT(*) as c
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.status = 'confirme'
      AND date_trunc('month', b.slot_datetime) = date_trunc('month', now())
  `);

  const lastMonthRevenueRow = await db.get(`
    SELECT COALESCE(SUM(s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)),0) as total
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.status = 'confirme'
      AND date_trunc('month', b.slot_datetime) = date_trunc('month', now() - interval '1 month')
  `);

  const avgBasketRow = await db.get(`
    SELECT COALESCE(AVG(s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)),0) as avg_price
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.status = 'confirme'
  `);

  const monthManualRow = await db.get(`
    SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as c
    FROM manual_revenue
    WHERE date_trunc('month', entry_date) = date_trunc('month', now())
  `);

  const lastMonthManualRow = await db.get(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM manual_revenue
    WHERE date_trunc('month', entry_date) = date_trunc('month', now() - interval '1 month')
  `);

  const paymentBreakdownRows = await db.all(`
    SELECT payment_method, COALESCE(SUM(amount),0) as total
    FROM manual_revenue
    WHERE date_trunc('month', entry_date) = date_trunc('month', now())
    GROUP BY payment_method
  `);

  const paymentBreakdownWeekRows = await db.all(`
    SELECT payment_method, COALESCE(SUM(amount),0) as total
    FROM manual_revenue
    WHERE date_trunc('week', entry_date) = date_trunc('week', now())
    GROUP BY payment_method
  `);

  const paymentBreakdownYearRows = await db.all(`
    SELECT payment_method, COALESCE(SUM(amount),0) as total
    FROM manual_revenue
    WHERE date_trunc('year', entry_date) = date_trunc('year', now())
    GROUP BY payment_method
  `);

  const returningRow = await db.get(`
    SELECT
      COUNT(*) FILTER (WHERE cnt > 1) as returning,
      COUNT(*) as total
    FROM (SELECT client_id, COUNT(*) as cnt FROM visits GROUP BY client_id) t
  `);

  const busiestRow = await db.get(`
    SELECT extract(dow from slot_datetime) as dow, extract(hour from slot_datetime) as hr, COUNT(*) as c
    FROM bookings
    WHERE status = 'confirme'
    GROUP BY dow, hr
    ORDER BY c DESC
    LIMIT 1
  `);

  const recentManual = await db.all(`
    SELECT id, entry_date, amount, note, payment_method FROM manual_revenue ORDER BY entry_date DESC, created_at DESC LIMIT 10
  `);

  const weekRevenueRow = await db.get(`
    WITH combined AS (
      SELECT b.slot_datetime::date AS rev_date, (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme'
      UNION ALL
      SELECT entry_date AS rev_date, amount FROM manual_revenue
    )
    SELECT COALESCE(SUM(amount),0) as total FROM combined
    WHERE date_trunc('week', rev_date) = date_trunc('week', now())
  `);

  const yearRevenueRow = await db.get(`
    WITH combined AS (
      SELECT b.slot_datetime::date AS rev_date, (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme'
      UNION ALL
      SELECT entry_date AS rev_date, amount FROM manual_revenue
    )
    SELECT COALESCE(SUM(amount),0) as total FROM combined
    WHERE date_trunc('year', rev_date) = date_trunc('year', now())
  `);

  const monthlyBreakdownRows = await db.all(`
    WITH combined AS (
      SELECT b.slot_datetime::date AS rev_date, (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme'
      UNION ALL
      SELECT entry_date AS rev_date, amount FROM manual_revenue
    )
    SELECT to_char(date_trunc('month', rev_date), 'YYYY-MM') as mois, COALESCE(SUM(amount),0) as total
    FROM combined
    WHERE rev_date >= date_trunc('month', now()) - interval '11 months'
    GROUP BY mois
    ORDER BY mois ASC
  `);

  const weekExpensesRow = await db.get(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses
    WHERE date_trunc('week', expense_date) = date_trunc('week', now())
  `);
  const monthExpensesRow = await db.get(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses
    WHERE date_trunc('month', expense_date) = date_trunc('month', now())
  `);
  const yearExpensesRow = await db.get(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses
    WHERE date_trunc('year', expense_date) = date_trunc('year', now())
  `);
  const recentExpenses = await db.all(`
    SELECT id, expense_date, amount, category, note FROM expenses ORDER BY expense_date DESC, created_at DESC LIMIT 10
  `);
  const expensesByCategoryRows = await db.all(`
    SELECT category, COALESCE(SUM(amount),0) as total
    FROM expenses
    WHERE date_trunc('month', expense_date) = date_trunc('month', now())
    GROUP BY category
    ORDER BY total DESC
  `);

  const monthRevenue = parseFloat(monthRevenueRow.total) + parseFloat(monthManualRow.total);
  const lastMonthRevenue = parseFloat(lastMonthRevenueRow.total) + parseFloat(lastMonthManualRow.total);
  let revenueGrowthPct = null;
  if (lastMonthRevenue > 0) {
    revenueGrowthPct = ((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
  } else if (monthRevenue > 0) {
    revenueGrowthPct = 100;
  }

  const monthRevenueCount = parseInt(monthRevenueRow.c, 10) + parseInt(monthManualRow.c, 10);
  const avgBasket = monthRevenueCount > 0
    ? (parseFloat(avgBasketRow.avg_price) * parseInt(monthRevenueRow.c, 10) + parseFloat(monthManualRow.total)) / monthRevenueCount
    : parseFloat(avgBasketRow.avg_price);

  const totalWithVisits = parseInt(returningRow.total, 10);
  const returningCount = parseInt(returningRow.returning, 10);
  const returningRatePct = totalWithVisits > 0 ? (returningCount / totalWithVisits) * 100 : 0;

  const DOW_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const busiest = busiestRow ? {
    day: DOW_NAMES_FR[parseInt(busiestRow.dow, 10)],
    hour: parseInt(busiestRow.hr, 10),
    count: parseInt(busiestRow.c, 10),
  } : null;

  res.json({
    totalClients: parseInt(totalClientsRow.c, 10),
    totalVisits: parseInt(totalVisitsRow.c, 10),
    totalPointsDistributed: parseInt(totalPointsDistributedRow.s, 10),
    totalPointsActive: parseInt(totalPointsActiveRow.s, 10),
    pendingBookings: parseInt(pendingBookingsRow.c, 10),
    newClients30: parseInt(newClients30Row.c, 10),
    monthRevenue,
    monthRevenueCount,
    revenueGrowthPct,
    avgBasket,
    returningRatePct,
    busiest,
    last30: last30.map(r => ({ jour: r.jour, visites: parseInt(r.visites, 10) })),
    topClients,
    recentManual: recentManual.map(r => ({ id: r.id, date: r.entry_date, amount: parseFloat(r.amount), note: r.note, paymentMethod: r.payment_method })),
    paymentBreakdown: paymentBreakdownRows.map(r => ({ method: r.payment_method, total: parseFloat(r.total) })),
    paymentBreakdownWeek: paymentBreakdownWeekRows.map(r => ({ method: r.payment_method, total: parseFloat(r.total) })),
    paymentBreakdownYear: paymentBreakdownYearRows.map(r => ({ method: r.payment_method, total: parseFloat(r.total) })),
    weekRevenue: parseFloat(weekRevenueRow.total),
    yearRevenue: parseFloat(yearRevenueRow.total),
    monthlyBreakdown: monthlyBreakdownRows.map(r => ({ mois: r.mois, total: parseFloat(r.total) })),
    weekExpenses: parseFloat(weekExpensesRow.total),
    monthExpenses: parseFloat(monthExpensesRow.total),
    yearExpenses: parseFloat(yearExpensesRow.total),
    recentExpenses: recentExpenses.map(r => ({ id: r.id, date: r.expense_date, amount: parseFloat(r.amount), category: r.category, note: r.note })),
    expensesByCategory: expensesByCategoryRows.map(r => ({ category: r.category, total: parseFloat(r.total) })),
  });
});

// DÉPENSES
router.post('/expenses', requireAdminAuth, async (req, res) => {
  const { date, amount, category, note } = req.body;
  if (!date || amount === undefined || amount === null || amount === '') {
    return res.status(400).json({ error: 'Date et montant requis.' });
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const id = uuidv4();
  await db.run('INSERT INTO expenses (id, expense_date, amount, category, note) VALUES (?,?,?,?,?)',
    [id, date, parsedAmount, (category || 'autre').trim().slice(0, 50), (note || '').trim().slice(0, 200) || null]);
  res.json({ ok: true, id });
});

router.delete('/expenses/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// CA manuel (clients hors app / hors tarifs)
router.post('/manual-revenue', requireAdminAuth, async (req, res) => {
  const { date, amount, note, payment_method } = req.body;
  if (!date || amount === undefined || amount === null || amount === '') {
    return res.status(400).json({ error: 'Date et montant requis.' });
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const method = payment_method === 'virement' ? 'virement' : 'espece';
  const id = uuidv4();
  await db.run('INSERT INTO manual_revenue (id, entry_date, amount, note, payment_method) VALUES (?,?,?,?,?)',
    [id, date, parsedAmount, (note || '').trim().slice(0, 200) || null, method]);
  res.json({ ok: true, id });
});

router.delete('/manual-revenue/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM manual_revenue WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// PROFIL COIFFURE ("Mon barber habituel")
router.get('/client/:id/style-profile', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });
  const profile = await db.get('SELECT * FROM client_style_profile WHERE client_id = ?', [req.params.id]);
  const photos = await db.all('SELECT id, photo_data, caption, created_at FROM client_style_photos WHERE client_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({
    profile: profile || { last_cut: '', usual_length: '', beard: '', products: '' },
    photos,
  });
});

router.put('/client/:id/style-profile', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });
  const { last_cut, usual_length, beard, products } = req.body;
  const existing = await db.get('SELECT client_id FROM client_style_profile WHERE client_id = ?', [req.params.id]);
  if (existing) {
    await db.run(
      'UPDATE client_style_profile SET last_cut=?, usual_length=?, beard=?, products=?, updated_at=now() WHERE client_id=?',
      [(last_cut || '').trim().slice(0, 500), (usual_length || '').trim().slice(0, 200), (beard || '').trim().slice(0, 200), (products || '').trim().slice(0, 500), req.params.id]
    );
  } else {
    await db.run(
      'INSERT INTO client_style_profile (client_id, last_cut, usual_length, beard, products) VALUES (?,?,?,?,?)',
      [req.params.id, (last_cut || '').trim().slice(0, 500), (usual_length || '').trim().slice(0, 200), (beard || '').trim().slice(0, 200), (products || '').trim().slice(0, 500)]
    );
  }
  res.json({ ok: true });
});

router.post('/client/:id/style-photos', requireAdminAuth, async (req, res) => {
  const targetClient = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!targetClient) return res.status(404).json({ error: 'Client introuvable.' });
  const { photo_data, caption } = req.body;
  if (!photo_data) return res.status(400).json({ error: 'Photo requise.' });
  const id = uuidv4();
  await db.run('INSERT INTO client_style_photos (id, client_id, photo_data, caption) VALUES (?,?,?,?)',
    [id, req.params.id, photo_data, (caption || '').trim().slice(0, 200) || null]);
  res.json({ ok: true, id });
});

router.delete('/style-photos/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM client_style_photos WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// DISPONIBLE MAINTENANT / URGENCE
router.get('/urgent-availability', requireAdminAuth, async (req, res) => {
  const row = await db.get('SELECT * FROM urgent_availability WHERE id = ?', ['default']);
  const isLive = row && row.active && row.expires_at && new Date(row.expires_at) > new Date();
  res.json({
    active: !!isLive,
    expiresAt: isLive ? row.expires_at : null,
    surcharge: row ? parseFloat(row.surcharge) : 0,
  });
});

router.put('/urgent-availability', requireAdminAuth, async (req, res) => {
  const { active, duration_minutes, surcharge } = req.body;
  if (active) {
    const minutes = Math.max(5, Math.min(240, parseInt(duration_minutes, 10) || 30));
    const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();
    const surchargeVal = (surcharge !== undefined && surcharge !== '' && surcharge !== null) ? Math.max(0, parseFloat(surcharge)) : 0;
    await db.run('UPDATE urgent_availability SET active = true, expires_at = ?, surcharge = ? WHERE id = ?', [expiresAt, surchargeVal, 'default']);
  } else {
    await db.run('UPDATE urgent_availability SET active = false WHERE id = ?', ['default']);
  }
  const row = await db.get('SELECT * FROM urgent_availability WHERE id = ?', ['default']);
  res.json({
    active: row.active && new Date(row.expires_at) > new Date(),
    expiresAt: row.active ? row.expires_at : null,
    surcharge: parseFloat(row.surcharge),
  });
});

// COMMUNES (supplément hors Liège)
router.get('/communes', requireAdminAuth, async (req, res) => {
  const communes = await db.all('SELECT * FROM communes ORDER BY sort_order ASC');
  res.json({ communes });
});

router.post('/communes', requireAdminAuth, async (req, res) => {
  const { name, surcharge } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom de la commune requis.' });
  const existing = await db.get('SELECT id FROM communes WHERE name ILIKE ?', [name.trim()]);
  if (existing) return res.status(409).json({ error: 'Cette commune existe déjà.' });
  const id = uuidv4();
  const maxOrderRow = await db.get('SELECT COALESCE(MAX(sort_order),0) as m FROM communes');
  await db.run('INSERT INTO communes (id, name, surcharge, sort_order) VALUES (?,?,?,?)',
    [id, name.trim(), parseFloat(surcharge) || 0, parseInt(maxOrderRow.m, 10) + 1]);
  res.json({ ok: true, id });
});

router.put('/communes/:id', requireAdminAuth, async (req, res) => {
  const commune = await db.get('SELECT * FROM communes WHERE id = ?', [req.params.id]);
  if (!commune) return res.status(404).json({ error: 'Commune introuvable.' });
  const { name, surcharge } = req.body;
  await db.run('UPDATE communes SET name=?, surcharge=? WHERE id=?', [
    name !== undefined ? name.trim() : commune.name,
    surcharge !== undefined ? (parseFloat(surcharge) || 0) : commune.surcharge,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.delete('/communes/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM communes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/orders -> commandes passées sur la boutique
router.get('/orders', requireAdminAuth, async (req, res) => {
  const orders = await db.all(`
    SELECT o.id, o.status, o.note, o.created_at, o.guest_name, o.guest_phone,
           c.id AS client_id, c.nom, c.prenom, c.telephone
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    ORDER BY o.created_at DESC
  `);
  const items = await db.all(`SELECT order_id, product_name, product_price, quantity FROM order_items ORDER BY id ASC`);
  const itemsByOrder = {};
  items.forEach(it => {
    if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
    itemsByOrder[it.order_id].push(it);
  });
  res.json({
    orders: orders.map(o => ({
      id: o.id,
      status: o.status,
      note: o.note,
      created_at: o.created_at,
      client_name: o.client_id ? `${o.prenom} ${o.nom}` : (o.guest_name || 'Client non reconnu'),
      telephone: o.telephone || o.guest_phone,
      recognized: !!o.client_id,
      items: itemsByOrder[o.id] || [],
      total: (itemsByOrder[o.id] || []).reduce((sum, it) => sum + parseFloat(it.product_price) * it.quantity, 0),
    })),
  });
});

router.put('/orders/:id', requireAdminAuth, async (req, res) => {
  const { status } = req.body;
  await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

// SUIVI EN DIRECT (trajet vers le client, façon "Uber Eats")
router.post('/trip/start', requireAdminAuth, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'Client requis.' });
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });

  // Géocode l'adresse du client si ce n'est pas déjà fait (mise en cache)
  if ((client.address_lat == null || client.address_lng == null) && client.address) {
    const coords = await geocodeAddress(client.address);
    if (coords) {
      await db.run('UPDATE clients SET address_lat = ?, address_lng = ? WHERE id = ?', [coords.lat, coords.lng, client_id]);
    }
  }

  await db.run('UPDATE live_trip SET active = true, client_id = ?, lat = NULL, lng = NULL, updated_at = now() WHERE id = ?', [client_id, 'default']);
  sendDepartureAlertEmail({ client }).catch(() => {});
  res.json({ ok: true });
});

router.post('/trip/update', requireAdminAuth, async (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) return res.status(400).json({ error: 'Position requise.' });
  await db.run('UPDATE live_trip SET lat = ?, lng = ?, updated_at = now() WHERE id = ?', [parseFloat(lat), parseFloat(lng), 'default']);
  res.json({ ok: true });
});

router.post('/trip/stop', requireAdminAuth, async (req, res) => {
  await db.run('UPDATE live_trip SET active = false WHERE id = ?', ['default']);
  res.json({ ok: true });
});

router.get('/trip/status', requireAdminAuth, async (req, res) => {
  const trip = await db.get('SELECT * FROM live_trip WHERE id = ?', ['default']);
  res.json({
    active: !!(trip && trip.active),
    clientId: trip ? trip.client_id : null,
  });
});

// GET /api/admin/accounting?month=YYYY-MM -> compte de résultat + journal comptable du mois
router.get('/accounting', requireAdminAuth, async (req, res) => {
  const monthParam = req.query.month; // format 'YYYY-MM', par défaut le mois en cours
  const monthFilterSql = monthParam
    ? `date_trunc('month', %COL%) = to_date(?, 'YYYY-MM')`
    : `date_trunc('month', %COL%) = date_trunc('month', now())`;
  const monthParams = monthParam ? [monthParam] : [];

  // Revenus : prestations confirmées (avec suppléments éventuels)
  const bookingRows = await db.all(
    `SELECT b.slot_datetime AS d, c.prenom, c.nom, s.name AS service_name,
            (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
     FROM bookings b
     JOIN clients c ON c.id = b.client_id
     JOIN services s ON s.id = b.service_id
     WHERE b.status = 'confirme' AND ${monthFilterSql.replace('%COL%', 'b.slot_datetime')}
     ORDER BY b.slot_datetime DESC`,
    monthParams
  );

  // Revenus manuels (espèce / virement)
  const manualRows = await db.all(
    `SELECT entry_date AS d, amount, note, payment_method
     FROM manual_revenue
     WHERE ${monthFilterSql.replace('%COL%', 'entry_date')}
     ORDER BY entry_date DESC`,
    monthParams
  );

  // Dépenses
  const expenseRows = await db.all(
    `SELECT expense_date AS d, amount, category, note
     FROM expenses
     WHERE ${monthFilterSql.replace('%COL%', 'expense_date')}
     ORDER BY expense_date DESC`,
    monthParams
  );

  const EXPENSE_LABELS = { essence: 'Essence / déplacement', produits: 'Produits', materiel: 'Matériel', assurance: 'Assurance', autre: 'Autre' };

  const entries = [];

  let prestationsTotal = 0;
  bookingRows.forEach(b => {
    const amount = parseFloat(b.amount);
    prestationsTotal += amount;
    entries.push({
      date: b.d,
      label: `Prestation — ${b.prenom} ${b.nom}${b.service_name ? ` (${b.service_name})` : ''}`,
      category: 'Prestations coiffure',
      type: 'revenu',
      amount,
    });
  });

  let especeTotal = 0;
  let virementTotal = 0;
  manualRows.forEach(m => {
    const amount = parseFloat(m.amount);
    if (m.payment_method === 'virement') virementTotal += amount; else especeTotal += amount;
    entries.push({
      date: m.d,
      label: `CA manuel${m.note ? ` — ${m.note}` : ''}`,
      category: m.payment_method === 'virement' ? '💳 Virement' : '💵 Espèce',
      type: 'revenu',
      amount,
    });
  });

  const expensesByCategory = {};
  let expensesTotal = 0;
  expenseRows.forEach(e => {
    const amount = parseFloat(e.amount);
    expensesTotal += amount;
    expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + amount;
    entries.push({
      date: e.d,
      label: e.note || (EXPENSE_LABELS[e.category] || e.category),
      category: EXPENSE_LABELS[e.category] || e.category,
      type: 'depense',
      amount,
    });
  });

  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const revenueTotal = prestationsTotal + especeTotal + virementTotal;
  const netResult = revenueTotal - expensesTotal;

  const settingsRow = await db.get('SELECT setaside_percent FROM accounting_settings WHERE id = ?', ['default']);
  const setasidePercent = settingsRow ? parseFloat(settingsRow.setaside_percent) : 25;
  const setasideAmount = Math.max(0, netResult * (setasidePercent / 100));

  res.json({
    month: monthParam || new Date().toISOString().slice(0, 7),
    revenue: {
      prestations: prestationsTotal,
      espece: especeTotal,
      virement: virementTotal,
      total: revenueTotal,
    },
    expenses: {
      byCategory: Object.entries(expensesByCategory).map(([cat, total]) => ({ category: EXPENSE_LABELS[cat] || cat, total })),
      total: expensesTotal,
    },
    net: netResult,
    setasidePercent,
    setasideAmount,
    availableAfterSetaside: netResult - setasideAmount,
    entries,
  });
});

// MISE DE CÔTÉ / OBJECTIF D'ÉPARGNE
router.get('/accounting-settings', requireAdminAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM accounting_settings WHERE id = ?', ['default']);
  res.json({
    setasidePercent: settings ? parseFloat(settings.setaside_percent) : 25,
    goalAmount: settings && settings.goal_amount != null ? parseFloat(settings.goal_amount) : null,
    goalLabel: settings ? settings.goal_label : null,
    goalStartDate: settings ? settings.goal_start_date : null,
  });
});

router.put('/accounting-settings', requireAdminAuth, async (req, res) => {
  const { setaside_percent, goal_amount, goal_label, goal_start_date } = req.body;
  const existing = await db.get('SELECT * FROM accounting_settings WHERE id = ?', ['default']);
  await db.run(
    'UPDATE accounting_settings SET setaside_percent = ?, goal_amount = ?, goal_label = ?, goal_start_date = ? WHERE id = ?',
    [
      setaside_percent !== undefined ? Math.max(0, Math.min(100, parseFloat(setaside_percent) || 0)) : existing.setaside_percent,
      goal_amount !== undefined ? ((goal_amount === '' || goal_amount === null) ? null : parseFloat(goal_amount)) : existing.goal_amount,
      goal_label !== undefined ? ((goal_label || '').trim() || null) : existing.goal_label,
      goal_start_date !== undefined ? (goal_start_date || null) : existing.goal_start_date,
      'default',
    ]
  );
  res.json({ ok: true });
});

// GET /api/admin/accounting-goal -> progression de l'objectif d'épargne (cumul automatique depuis la date de départ)
router.get('/accounting-goal', requireAdminAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM accounting_settings WHERE id = ?', ['default']);
  if (!settings || settings.goal_amount == null || !settings.goal_start_date) {
    return res.json({ hasGoal: false });
  }
  const startDate = settings.goal_start_date;
  const percent = parseFloat(settings.setaside_percent);

  const revenueRow = await db.get(`
    WITH combined AS (
      SELECT b.slot_datetime::date AS rev_date, (s.price + COALESCE(b.urgent_surcharge,0) + COALESCE(b.commune_surcharge,0)) AS amount
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.status = 'confirme'
      UNION ALL
      SELECT entry_date AS rev_date, amount FROM manual_revenue
    )
    SELECT COALESCE(SUM(amount),0) as total FROM combined WHERE rev_date >= ?
  `, [startDate]);
  const expensesRow = await db.get(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date >= ?`, [startDate]);

  const netSinceStart = parseFloat(revenueRow.total) - parseFloat(expensesRow.total);
  const cumulativeSetAside = Math.max(0, netSinceStart * (percent / 100));
  const goalAmount = parseFloat(settings.goal_amount);
  const pct = goalAmount > 0 ? Math.min(100, (cumulativeSetAside / goalAmount) * 100) : 0;

  res.json({
    hasGoal: true,
    goalLabel: settings.goal_label,
    goalAmount,
    goalStartDate: startDate,
    cumulativeSetAside,
    pct,
    reached: cumulativeSetAside >= goalAmount,
  });
});

// SYNCHRONISATION BANCAIRE (Ponto / Belfius)
router.post('/bank/sync', requireAdminAuth, async (req, res) => {
  try {
    const newCount = await syncBankTransactions();
    res.json({ ok: true, newTransactions: newCount });
  } catch (e) {
    console.error('[Hairsprit] Erreur synchronisation bancaire:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/bank/transactions -> historique récent des transactions (déjà classées automatiquement)
router.get('/bank/transactions', requireAdminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT * FROM bank_transactions
    WHERE ignored = false
    ORDER BY value_date DESC NULLS LAST, created_at DESC
    LIMIT 100
  `);
  res.json({
    transactions: rows.map(r => ({
      id: r.id,
      date: r.value_date,
      amount: parseFloat(r.amount),
      description: r.description,
      counterpartName: r.counterpart_name,
      linkedExpenseId: r.linked_expense_id,
      linkedRevenueId: r.linked_revenue_id,
    })),
  });
});

// PUT /api/admin/bank/transactions/:id -> ajuster la catégorie d'une dépense déjà classée automatiquement
router.put('/bank/transactions/:id/category', requireAdminAuth, async (req, res) => {
  const { category } = req.body;
  const tx = await db.get('SELECT * FROM bank_transactions WHERE id = ?', [req.params.id]);
  if (!tx || !tx.linked_expense_id) return res.status(404).json({ error: 'Dépense liée introuvable.' });
  await db.run('UPDATE expenses SET category = ? WHERE id = ?', [category, tx.linked_expense_id]);
  res.json({ ok: true });
});

// DELETE /api/admin/bank/transactions/:id -> retirer une transaction de la comptabilité (ex: erreur, virement interne)
router.delete('/bank/transactions/:id', requireAdminAuth, async (req, res) => {
  const tx = await db.get('SELECT * FROM bank_transactions WHERE id = ?', [req.params.id]);
  if (!tx) return res.status(404).json({ error: 'Transaction introuvable.' });
  if (tx.linked_expense_id) await db.run('DELETE FROM expenses WHERE id = ?', [tx.linked_expense_id]);
  if (tx.linked_revenue_id) await db.run('DELETE FROM manual_revenue WHERE id = ?', [tx.linked_revenue_id]);
  await db.run('UPDATE bank_transactions SET ignored = true, linked_expense_id = NULL, linked_revenue_id = NULL WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// DIAGNOSTIC TEMPORAIRE : teste la connexion sortante vers plusieurs adresses
// pour comprendre si le blocage est général au serveur, ou spécifique à Ponto/Ibanity.
router.get('/network-test', async (req, res) => {
  const targets = [
    { name: 'Google', url: 'https://www.google.com' },
    { name: 'GitHub API', url: 'https://api.github.com' },
    { name: 'Resend (déjà utilisé, marche normalement)', url: 'https://api.resend.com' },
    { name: 'Ibanity (Ponto)', url: 'https://api.ibanity.com' },
    { name: 'Ponto (myponto)', url: 'https://api.myponto.com' },
  ];
  const results = [];
  for (const t of targets) {
    try {
      const start = Date.now();
      const r = await fetch(t.url, { method: 'GET' });
      results.push({ name: t.name, url: t.url, ok: true, status: r.status, ms: Date.now() - start });
    } catch (e) {
      results.push({ name: t.name, url: t.url, ok: false, error: e.message, cause: e.cause ? (e.cause.code || String(e.cause)) : null });
    }
  }
  res.json({ results });
});

module.exports = router;
