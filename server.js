require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db'); // init DB + seed

const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Hairsprit Fidélité' }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Fallback routes for direct URL access
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`✂️  Hairsprit Fidélité en ligne sur http://localhost:${PORT}`);
});
