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
router.post('/register', (req, res) => {
  const { nom, prenom, telephone } = req.body;
  if (!nom || !prenom || !telephone) {
    return res.status(400).json({ error: 'Nom, prénom et téléphone sont obligatoires.' });
  }
  const tel = normalizePhone(telephone);
  if (tel.length < 8) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
  }

  const existing = db.prepare('SELECT * FROM clients WHERE telephone = ?').get(tel);
  if (existing) {
    return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro. Connectez-vous.' });
  }

  const id = uuidv4();
  const qrToken = uuidv4();
  db.prepare('INSERT INTO clients (id, nom, prenom, telephone, qr_token, points) VALUES (?,?,?,?,?,0)')
    .run(id, nom.trim(), prenom.trim(), tel, qrToken);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  const token = signToken({ id, role: 'client' });
  res.json({ token, client: clientPublic(client) });
});

// POST /api/client/login
router.post('/login', (req, res) => {
  const { telephone } = req.body;
  if (!telephone) return res.status(400).json({ error: 'Téléphone requis.' });
  const tel = normalizePhone(telephone);
  const client = db.prepare('SELECT * FROM clients WHERE telephone = ?').get(tel);
  if (!client) return res.status(404).json({ error: "Aucun compte trouvé avec ce numéro." });
  const token = signToken({ id: client.id, role: 'client' });
  res.json({ token, client: clientPublic(client) });
});

// GET /api/client/me
router.get('/me', requireClientAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.clientId);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  res.json({ client: clientPublic(client) });
});

// GET /api/client/qrcode -> data URL of QR encoding qr_token
router.get('/qrcode', requireClientAuth, async (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.clientId);
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
router.get('/history', requireClientAuth, (req, res) => {
  const visits = db.prepare('SELECT id, points_added, note, created_at FROM visits WHERE client_id = ? ORDER BY created_at DESC')
    .all(req.clientId);
  res.json({ visits });
});

// GET /api/client/rewards -> active rewards list
router.get('/rewards', requireClientAuth, (req, res) => {
  const rewards = db.prepare('SELECT id, name, points_required, description FROM rewards WHERE active = 1 ORDER BY sort_order ASC')
    .all();
  res.json({ rewards });
});

// POST /api/client/booking
router.post('/booking', requireClientAuth, (req, res) => {
  const { message } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO bookings (id, client_id, message) VALUES (?,?,?)')
    .run(id, req.clientId, (message || '').trim().slice(0, 500));
  res.json({ ok: true, bookingId: id });
});

module.exports = router;
