const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'hairsprit.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  telephone TEXT UNIQUE NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  points_added INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  points_required INTEGER NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
`);

// Seed default rewards if none exist
const rewardCount = db.prepare('SELECT COUNT(*) as c FROM rewards').get().c;
if (rewardCount === 0) {
  const { v4: uuidv4 } = require('uuid');
  const insert = db.prepare('INSERT INTO rewards (id, name, points_required, description, sort_order) VALUES (?,?,?,?,?)');
  insert.run(uuidv4(), 'Réduction 5€', 5, "5€ de réduction sur votre prochaine prestation", 1);
  insert.run(uuidv4(), 'Coupe offerte', 10, "Une coupe offerte ou un produit au choix", 2);
}

// Seed default admin if none exists (username: admin / password: hairsprit2026)
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
if (adminCount === 0) {
  const { v4: uuidv4 } = require('uuid');
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'hairsprit2026';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO admins (id, username, password_hash) VALUES (?,?,?)')
    .run(uuidv4(), process.env.ADMIN_DEFAULT_USERNAME || 'admin', hash);
  console.log(`[Hairsprit] Compte admin par défaut créé -> identifiant: ${process.env.ADMIN_DEFAULT_USERNAME || 'admin'} / mot de passe: ${defaultPassword}`);
  console.log('[Hairsprit] Change ce mot de passe en production (voir README).');
}

module.exports = db;
