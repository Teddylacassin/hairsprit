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
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiants requis.' });
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());
  if (!admin) return res.status(401).json({ error: 'Identifiants incorrects.' });
  const ok = bcrypt.compareSync(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Identifiants incorrects.' });
  const token = signToken({ id: admin.id, role: 'admin' });
  res.json({ token, username: admin.username });
});

// GET /api/admin/client-by-qr/:qrToken -> lookup client via scanned QR
router.get('/client-by-qr/:qrToken', requireAdminAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE qr_token = ?').get(req.params.qrToken);
  if (!client) return res.status(404).json({ error: 'QR code inconnu — client introuvable.' });
  res.json({ client: clientPublic(client) });
});

// POST /api/admin/client/:id/point -> add a point after a service
router.post('/client/:id/point', requireAdminAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });

  const points = Math.max(1, parseInt(req.body.points, 10) || 1);
  const note = (req.body.note || 'Prestation en salon').trim().slice(0, 200);

  const tx = db.transaction(() => {
    db.prepare('UPDATE clients SET points = points + ? WHERE id = ?').run(points, client.id);
    db.prepare('INSERT INTO visits (id, client_id, points_added, note) VALUES (?,?,?,?)')
      .run(uuidv4(), client.id, points, note);
  });
  tx();

  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
  res.json({ client: clientPublic(updated) });
});

// GET /api/admin/clients -> list all clients (with optional search)
router.get('/clients', requireAdminAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`SELECT * FROM clients WHERE nom LIKE ? OR prenom LIKE ? OR telephone LIKE ? ORDER BY created_at DESC`)
      .all(like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  }
  res.json({ clients: rows.map(clientPublic) });
});

// GET /api/admin/client/:id -> single client detail + history
router.get('/client/:id', requireAdminAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  const visits = db.prepare('SELECT * FROM visits WHERE client_id = ? ORDER BY created_at DESC').all(client.id);
  res.json({ client: clientPublic(client), visits });
});

// REWARDS CRUD
router.get('/rewards', requireAdminAuth, (req, res) => {
  const rewards = db.prepare('SELECT * FROM rewards ORDER BY sort_order ASC').all();
  res.json({ rewards });
});

router.post('/rewards', requireAdminAuth, (req, res) => {
  const { name, points_required, description } = req.body;
  if (!name || !points_required) return res.status(400).json({ error: 'Nom et points requis.' });
  const id = uuidv4();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM rewards').get().m;
  db.prepare('INSERT INTO rewards (id, name, points_required, description, sort_order) VALUES (?,?,?,?,?)')
    .run(id, name.trim(), parseInt(points_required, 10), (description || '').trim(), maxOrder + 1);
  res.json({ ok: true, id });
});

router.put('/rewards/:id', requireAdminAuth, (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Récompense introuvable.' });
  const { name, points_required, description, active } = req.body;
  db.prepare('UPDATE rewards SET name=?, points_required=?, description=?, active=? WHERE id=?')
    .run(
      name !== undefined ? name.trim() : reward.name,
      points_required !== undefined ? parseInt(points_required, 10) : reward.points_required,
      description !== undefined ? description.trim() : reward.description,
      active !== undefined ? (active ? 1 : 0) : reward.active,
      req.params.id
    );
  res.json({ ok: true });
});

router.delete('/rewards/:id', requireAdminAuth, (req, res) => {
  db.prepare('DELETE FROM rewards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/bookings
router.get('/bookings', requireAdminAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.message, b.status, b.created_at, c.nom, c.prenom, c.telephone
    FROM bookings b JOIN clients c ON c.id = b.client_id
    ORDER BY b.created_at DESC
  `).all();
  res.json({ bookings: rows });
});

router.put('/bookings/:id', requireAdminAuth, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/stats
router.get('/stats', requireAdminAuth, (req, res) => {
  const totalClients = db.prepare('SELECT COUNT(*) c FROM clients').get().c;
  const totalVisits = db.prepare('SELECT COUNT(*) c FROM visits').get().c;
  const totalPointsDistributed = db.prepare('SELECT COALESCE(SUM(points_added),0) s FROM visits').get().s;
  const totalPointsActive = db.prepare('SELECT COALESCE(SUM(points),0) s FROM clients').get().s;
  const pendingBookings = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status = 'en_attente'`).get().c;

  const last30 = db.prepare(`
    SELECT date(created_at) as jour, COUNT(*) as visites
    FROM visits
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY jour ASC
  `).all();

  const topClients = db.prepare(`
    SELECT nom, prenom, points FROM clients ORDER BY points DESC LIMIT 5
  `).all();

  const newClients30 = db.prepare(`
    SELECT COUNT(*) c FROM clients WHERE created_at >= datetime('now', '-30 days')
  `).get().c;

  res.json({
    totalClients,
    totalVisits,
    totalPointsDistributed,
    totalPointsActive,
    pendingBookings,
    newClients30,
    last30,
    topClients,
  });
});

module.exports = router;
