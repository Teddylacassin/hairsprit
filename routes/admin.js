const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAdminAuth } = require('../middleware/auth');

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

  const { telephone, address } = req.body;
  let tel = targetClient.telephone;
  if (telephone !== undefined) {
    tel = String(telephone).replace(/[\s.\-()]/g, '');
    if (tel.length < 8) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
    if (tel !== targetClient.telephone) {
      const existing = await db.get('SELECT id FROM clients WHERE telephone = ? AND id != ?', [tel, req.params.id]);
      if (existing) return res.status(409).json({ error: 'Un autre client utilise déjà ce numéro.' });
    }
  }

  await db.run('UPDATE clients SET telephone = ?, address = ? WHERE id = ?', [
    tel,
    address !== undefined ? ((address || '').trim() || null) : targetClient.address,
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
  const { name, price, description } = req.body;
  if (!name || price === undefined || price === '') return res.status(400).json({ error: 'Nom et prix requis.' });
  const id = uuidv4();
  const maxOrderRow = await db.get('SELECT COALESCE(MAX(sort_order),0) as m FROM services');
  const maxOrder = parseInt(maxOrderRow.m, 10);
  await db.run('INSERT INTO services (id, name, price, description, sort_order) VALUES (?,?,?,?,?)',
    [id, name.trim(), parseFloat(price), (description || '').trim(), maxOrder + 1]);
  res.json({ ok: true, id });
});

router.put('/services/:id', requireAdminAuth, async (req, res) => {
  const service = await db.get('SELECT * FROM services WHERE id = ?', [req.params.id]);
  if (!service) return res.status(404).json({ error: 'Prestation introuvable.' });
  const { name, price, description, active } = req.body;
  await db.run('UPDATE services SET name=?, price=?, description=?, active=? WHERE id=?', [
    name !== undefined ? name.trim() : service.name,
    price !== undefined ? parseFloat(price) : service.price,
    description !== undefined ? description.trim() : service.description,
    active !== undefined ? (active ? 1 : 0) : service.active,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.delete('/services/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM services WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// PRODUCTS (BOUTIQUE) CRUD
router.get('/products', requireAdminAuth, async (req, res) => {
  const products = await db.all('SELECT * FROM products ORDER BY sort_order ASC');
  res.json({ products });
});

router.post('/products', requireAdminAuth, async (req, res) => {
  const { name, price, description, image_url } = req.body;
  if (!name || price === undefined || price === '') return res.status(400).json({ error: 'Nom et prix requis.' });
  const id = uuidv4();
  const maxOrderRow = await db.get('SELECT COALESCE(MAX(sort_order),0) as m FROM products');
  const maxOrder = parseInt(maxOrderRow.m, 10);
  await db.run('INSERT INTO products (id, name, price, description, image_url, sort_order) VALUES (?,?,?,?,?,?)',
    [id, name.trim(), parseFloat(price), (description || '').trim(), (image_url || '').trim() || null, maxOrder + 1]);
  res.json({ ok: true, id });
});

router.put('/products/:id', requireAdminAuth, async (req, res) => {
  const product = await db.get('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
  const { name, price, description, image_url, active } = req.body;
  await db.run('UPDATE products SET name=?, price=?, description=?, image_url=?, active=? WHERE id=?', [
    name !== undefined ? name.trim() : product.name,
    price !== undefined ? parseFloat(price) : product.price,
    description !== undefined ? description.trim() : product.description,
    image_url !== undefined ? ((image_url || '').trim() || null) : product.image_url,
    active !== undefined ? (active ? 1 : 0) : product.active,
    req.params.id,
  ]);
  res.json({ ok: true });
});

router.delete('/products/:id', requireAdminAuth, async (req, res) => {
  await db.run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/orders -> all product orders with items
router.get('/orders', requireAdminAuth, async (req, res) => {
  const orders = await db.all(`
    SELECT o.id, o.status, o.note, o.created_at, c.nom, c.prenom, c.telephone, c.address
    FROM orders o JOIN clients c ON c.id = o.client_id
    ORDER BY o.created_at DESC
  `);
  const items = await db.all('SELECT * FROM order_items');
  const withItems = orders.map(o => ({
    ...o,
    items: items.filter(i => i.order_id === o.id),
  }));
  res.json({ orders: withItems });
});

// PUT /api/admin/orders/:id -> update order status (e.g. mark as delivered)
router.put('/orders/:id', requireAdminAuth, async (req, res) => {
  const { status } = req.body;
  await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

// GET /api/admin/schedule -> get schedule settings
router.get('/schedule', requireAdminAuth, async (req, res) => {
  const settings = await db.get('SELECT * FROM schedule_settings WHERE id = ?', ['default']);
  res.json({ settings });
});

// PUT /api/admin/schedule -> update schedule settings
router.put('/schedule', requireAdminAuth, async (req, res) => {
  const { open_days, start_time, end_time, slot_duration_minutes } = req.body;
  if (!open_days || !start_time || !end_time || !slot_duration_minutes) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  await db.run(
    'UPDATE schedule_settings SET open_days = ?, start_time = ?, end_time = ?, slot_duration_minutes = ? WHERE id = ?',
    [open_days, start_time, end_time, parseInt(slot_duration_minutes, 10), 'default']
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
    SELECT b.id, b.message, b.status, b.created_at, b.slot_datetime, c.nom, c.prenom, c.telephone, c.address, c.admin_notes,
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
  const { client_id, slot_datetime, service_id, message } = req.body;
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
  await db.run('INSERT INTO bookings (id, client_id, message, slot_datetime, service_id, status) VALUES (?,?,?,?,?,?)',
    [id, client_id, (message || '').trim().slice(0, 500), slot_datetime, service_id || null, 'confirme']);
  res.json({ ok: true, id });
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
    SELECT COALESCE(SUM(s.price),0) as total, COUNT(*) as c
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.status = 'confirme'
      AND date_trunc('month', b.slot_datetime) = date_trunc('month', now())
  `);

  res.json({
    totalClients: parseInt(totalClientsRow.c, 10),
    totalVisits: parseInt(totalVisitsRow.c, 10),
    totalPointsDistributed: parseInt(totalPointsDistributedRow.s, 10),
    totalPointsActive: parseInt(totalPointsActiveRow.s, 10),
    pendingBookings: parseInt(pendingBookingsRow.c, 10),
    newClients30: parseInt(newClients30Row.c, 10),
    monthRevenue: parseFloat(monthRevenueRow.total),
    monthRevenueCount: parseInt(monthRevenueRow.c, 10),
    last30: last30.map(r => ({ jour: r.jour, visites: parseInt(r.visites, 10) })),
    topClients,
  });
});

module.exports = router;
