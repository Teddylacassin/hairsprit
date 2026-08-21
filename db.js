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
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      description TEXT,
      image_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_id TEXT REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'en_attente',
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE orders ALTER COLUMN client_id DROP NOT NULL;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT,
      product_name TEXT NOT NULL,
      product_price NUMERIC NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1
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
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS slot_datetime TIMESTAMP;`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS pin_hash TEXT;`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS admin_notes TEXT;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id TEXT;`);
  await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS people_count INTEGER NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_duration_minutes INTEGER;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_details TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_revenue (
      id TEXT PRIMARY KEY,
      entry_date DATE NOT NULL,
      amount NUMERIC NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE manual_revenue ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'espece';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_settings (
      id TEXT PRIMARY KEY,
      open_days TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      slot_duration_minutes INTEGER NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE schedule_settings ADD COLUMN IF NOT EXISTS travel_buffer_minutes INTEGER NOT NULL DEFAULT 20;`);
  await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS group_price NUMERIC;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_dates (
      id TEXT PRIMARY KEY,
      blocked_date DATE UNIQUE NOT NULL,
      reason TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id TEXT PRIMARY KEY,
      slot_datetime TIMESTAMP UNIQUE NOT NULL,
      reason TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      rating INTEGER NOT NULL,
      comment TEXT,
      visible INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE(client_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_style_profile (
      client_id TEXT PRIMARY KEY REFERENCES clients(id),
      last_cut TEXT,
      usual_length TEXT,
      beard TEXT,
      products TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_style_photos (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id),
      photo_data TEXT NOT NULL,
      caption TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS urgent_availability (
      id TEXT PRIMARY KEY,
      active BOOLEAN NOT NULL DEFAULT false,
      expires_at TIMESTAMP,
      surcharge NUMERIC NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS urgent_surcharge NUMERIC NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_urgent INTEGER NOT NULL DEFAULT 0;`);

  const urgentCount = await get('SELECT COUNT(*) as c FROM urgent_availability');
  if (parseInt(urgentCount.c, 10) === 0) {
    await run('INSERT INTO urgent_availability (id, active, surcharge) VALUES (?,?,?)', ['default', false, 0]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      expense_date DATE NOT NULL,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL DEFAULT 'autre',
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS communes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      surcharge NUMERIC NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commune TEXT;`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commune_surcharge NUMERIC NOT NULL DEFAULT 0;`);

  const communeCount = await get('SELECT COUNT(*) as c FROM communes');
  if (parseInt(communeCount.c, 10) === 0) {
    await run('INSERT INTO communes (id, name, surcharge, sort_order) VALUES (?,?,?,?)', [uuidv4(), 'Liège', 0, 1]);
  }

  const scheduleCount = await get('SELECT COUNT(*) as c FROM schedule_settings');
  if (parseInt(scheduleCount.c, 10) === 0) {
    await run('INSERT INTO schedule_settings (id, open_days, start_time, end_time, slot_duration_minutes) VALUES (?,?,?,?,?)',
      ['default', '1,2,3,4,5,6', '09:00', '22:00', 120]);
  }

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
