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

    const newClient = await db.get('SELECT * FROM clients WHERE id = ?', [id]);
    const token = signToken({ id, role: 'client' });
    res.json({ token, client: clientPublic(newClient) });
  } catch (e) {
    console.error('REGISTER ERROR:', e);
    res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
});

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
    console.error('LOGIN ERROR:', e);
    res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
});

router.get('/me', requireClientAuth, async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.clientId]);
  if (!client) return res.status(404).json({ error: 'Client introuvable.' });
  res.json({ client: clientPublic(client) });
});

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

router.get('/history', requireClientAuth, async (req, res) => {
  const visits = await db.all('SELECT id, points_added, note, created_at FROM visits WHERE client_id = ? ORDER BY created_at DESC', [req.clientId]);
  res.json({ visits });
});

router.get('/rewards', requireClientAuth, async (req, res) => {
  const rewards = await db.all('SELECT id, name, points_required, description FROM rewards WHERE active = 1 ORDER BY sort_order ASC');
  res.json({ rewards });
});

router.post('/booking', requireClientAuth, async (req, res) => {
  const { message } = req.body;
  const id = uuidv4();
  await db.run('INSERT INTO bookings (id, client_id, message) VALUES (?,?,?)',
    [id, req.clientId, (message || '').trim().slice(0, 500)]);
  res.json({ ok: true, bookingId: id });
});

module.exports = router;
