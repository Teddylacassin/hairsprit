const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Convertit les "?" de nos requêtes en $1, $2... attendus par Postgres
function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function run(sql, params = []) {
  return pool.query(toPgParams(sql), params);
}
async function get(sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows[0];
}
async function all(sql, params = []) {
  const res = await pool.query(toPgParams(sql), params);
  return res.rows;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      telephone TEXT UNIQUE NOT NULL,
      qr_token TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      points_added INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      points_required INTEGER NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      message TEXT,
      status TEXT NOT NULL DEFAULT 'en_attente',
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);

  const rewardCount = await get('SELECT COUNT(*) as c FROM rewards');
  if (parseInt(rewardCount.c, 10) === 0) {
    await run('INSERT INTO rewards (id, name, points_required, description, sort_order) VALUES (?,?,?,?,?)',
      [uuidv4(), 'Réduction 5€', 5, "5€ de réduction sur votre prochaine prestation", 1]);
    await run('INSERT INTO rewards (id, name, points_required, description, sort_order) VALUES (?,?,?,?,?)',
      [uuidv4(), 'Coupe offerte', 10, "Une coupe offerte ou un produit au choix", 2]);
  }

  const adminCount = await get('SELECT COUNT(*) as c FROM admins');
  if (parseInt(adminCount.c, 10) === 0) {
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'hairsprit2026';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    await run('INSERT INTO admins (id, username, password_hash) VALUES (?,?,?)',
      [uuidv4(), process.env.ADMIN_DEFAULT_USERNAME || 'admin', hash]);
    console.log(`[Hairsprit] Compte admin par défaut créé -> identifiant: ${process.env.ADMIN_DEFAULT_USERNAME || 'admin'} / mot de passe: ${defaultPassword}`);
    console.log('[Hairsprit] Change ce mot de passe en production (voir README).');
  }
}

module.exports = { pool, run, get, all, initDb };
