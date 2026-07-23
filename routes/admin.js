const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAdminAuth } = require('../middleware/auth');

const router = express.Router();

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

// GET /api/admin/client/:id -> single client detail + history
router.get('/client/:id', requireAdminAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const visits = await db.all('SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC', [client.id]);
  res.json({ client: clientPublic(client), visits });
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

// GET /api/admin/bookings
router.get('/bookings', requireAdminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT b.id, b.message, b.status, b.created_at, c.nom, c.prenom, c.telephone
    FROM bookings b JOIN clients c ON c.id = b.client_id
    ORDER BY b.created_at DESC
  `);
  res.json({ bookings: rows });
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

  res.json({
    totalClients: parseInt(totalClientsRow.c, 10),
    totalVisits: parseInt(totalVisitsRow.c, 10),
    totalPointsDistributed: parseInt(totalPointsDistributedRow.s, 10),
    totalPointsActive: parseInt(totalPointsActiveRow.s, 10),
    pendingBookings: parseInt(pendingBookingsRow.c, 10),
    newClients30: parseInt(newClients30Row.c, 10),
    last30: last30.map(r => ({ jour: r.jour, visites: parseInt(r.visites, 10) })),
    topClients,
  });
});

module.exports = router;
