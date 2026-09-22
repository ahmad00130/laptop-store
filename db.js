const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'store.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS laptops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    processor TEXT NOT NULL,
    ram_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    storage_type TEXT NOT NULL DEFAULT 'SSD',
    screen_size REAL,
    battery_health TEXT,
    condition TEXT NOT NULL DEFAULT 'Used',
    price INTEGER NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    stock INTEGER NOT NULL DEFAULT 1,
    use_tags TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laptop_id INTEGER,
    laptop_name TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    price_amount INTEGER NOT NULL,
    deposit_amount INTEGER NOT NULL,
    months INTEGER NOT NULL,
    markup_percent INTEGER NOT NULL DEFAULT 0,
    monthly_amount INTEGER NOT NULL,
    total_amount INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    handed_over INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    paid_on TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'Transfer',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    laptop_id INTEGER,
    laptop_name TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    pay_mode TEXT NOT NULL DEFAULT 'full',
    deposit_percent INTEGER,
    months INTEGER,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;