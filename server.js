require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const dns = require('dns');

// Corrige un souci fréquent sur les serveurs Docker/VPS (comme Hetzner) où une
// mauvaise configuration IPv6 fait planter les connexions sortantes (ex: vers l'API Ponto)
dns.setDefaultResultOrder('ipv4first');

const { initDb } = require('./db');
const { startReminderScheduler } = require('./reminders');
const { startBankSyncScheduler } = require('./bankSync');

const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Hairsprit Fidélité' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Alias explicite : /app ouvre la même carte de fidélité que la racine
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✂️  Hairsprit Fidélité en ligne sur http://localhost:${PORT}`);
    });
    startReminderScheduler();
    startBankSyncScheduler();
  })
  .catch((err) => {
    console.error('Erreur lors de l\'initialisation de la base de données :', err);
    process.exit(1);
  });
