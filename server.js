const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_HOURS = 8;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMAGE_PATTERN = /^\/uploads\/[a-f0-9]{32}\.jpg$/;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json());

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

/* ---------- Sessions ---------- */

const sessions = new Map(); // token -> { adminId, username, expires }

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires < now) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie).admin_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const parts = [
    `admin_session=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Please log in as admin' });
  req.admin = session;
  next();
}

/* ---------- Login protection ---------- */

const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function isLockedOut(ip) {
  const record = attempts.get(ip);
  if (!record) return false;
  if (record.resetAt < Date.now()) {
    attempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const record = attempts.get(ip);
  if (!record || record.resetAt < Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + LOCK_MINUTES * 60 * 1000 });
  } else {
    record.count += 1;
  }
}


// TEMPORARY: updates the admin password. Remove this after use.
app.get('/api/setup-admin', (req, res) => {
  const SETUP_KEY = 'ahmad-reset-9042-temp';
  if (req.query.key !== SETUP_KEY) return res.status(404).send('Not found');

  const username = String(req.query.username || '').trim();
  const password = String(req.query.password || '');
  if (!username || password.length < 10) {
    return res.status(400).send('Provide ?username=...&password=... (password 10+ characters)');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const passwordHash = `${salt}:${hash}`;

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(passwordHash, username);
    return res.send(`Password updated for "${username}". Remove this route now.`);
  }

  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  res.send(`Admin "${username}" created. Remove this route now.`);
});

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;

  if (isLockedOut(ip)) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
  }

  const { username, password } = req.body || {};
  const admin = typeof username === 'string'
    ? db.prepare('SELECT * FROM admins WHERE username = ?').get(username)
    : null;

  let valid = false;
  if (admin && typeof password === 'string') {
    const [salt, hash] = admin.password_hash.split(':');
    const attempt = crypto.scryptSync(password, salt, 64);
    valid = crypto.timingSafeEqual(attempt, Buffer.from(hash, 'hex'));
  } else {
    // Do the same amount of work so timing does not reveal if a username exists
    crypto.scryptSync(typeof password === 'string' ? password : '', 'dummy-salt', 64);
  }

  if (!valid) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  attempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    adminId: admin.id,
    username: admin.username,
    expires: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
  });
  setSessionCookie(res, token, SESSION_HOURS * 60 * 60);
  res.json({ username: admin.username });
});

app.post('/api/admin/logout', (req, res) => {
  const session = getSession(req);
  if (session) sessions.delete(session.token);
  setSessionCookie(res, '', 0);
  res.json({ message: 'Logged out' });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

/* ---------- Photo upload (admin only) ---------- */

app.post(
  '/api/admin/upload',
  requireAdmin,
  express.raw({ type: 'image/jpeg', limit: '5mb' }),
  (req, res) => {
    const data = req.body;

    if (!Buffer.isBuffer(data) || data.length < 100) {
      return res.status(400).json({ error: 'No image received' });
    }

    // Check the file really is a JPEG, not just named like one
    const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (!isJpeg) {
      return res.status(400).json({ error: 'Only JPEG images are accepted' });
    }

    const name = crypto.randomBytes(16).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, name), data);
    res.status(201).json({ url: `/uploads/${name}` });
  }
);

// Deletes a photo file, but only if it is one of our own uploads
function deleteImageFile(url) {
  if (!url || !IMAGE_PATTERN.test(url)) return;
  fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}

/* ---------- Laptop helpers ---------- */

function withFinalPrice(laptop) {
  const finalPrice = laptop.price - (laptop.price * laptop.discount_percent) / 100;
  return { ...laptop, final_price: Math.round(finalPrice) };
}

function validateLaptop(body) {
  const required = ['brand', 'model', 'processor', 'ram_gb', 'storage_gb', 'price'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return `Missing field: ${field}`;
    }
  }
  if (!(Number(body.price) > 0)) return 'Price must be greater than 0';
  if (!(Number(body.ram_gb) > 0) || !(Number(body.storage_gb) > 0)) {
    return 'RAM and storage must be greater than 0';
  }
  const discount = Number(body.discount_percent || 0);
  if (!(discount >= 0 && discount <= 100)) return 'Discount must be between 0 and 100';
  if (!(Number(body.stock ?? 1) >= 0)) return 'Stock cannot be negative';
  if (body.image && !IMAGE_PATTERN.test(body.image)) return 'Invalid photo';
  return null;
}

/* ---------- Laptop routes ---------- */

// Public: anyone can view laptops
app.get('/api/laptops', (req, res) => {
  const laptops = db.prepare('SELECT * FROM laptops ORDER BY id DESC').all();
  res.json(laptops.map(withFinalPrice));
});

app.get('/api/laptops/:id', (req, res) => {
  const laptop = db.prepare('SELECT * FROM laptops WHERE id = ?').get(req.params.id);
  if (!laptop) return res.status(404).json({ error: 'Laptop not found' });
  res.json(withFinalPrice(laptop));
});

// Admin only: add, edit, delete
app.post('/api/laptops', requireAdmin, (req, res) => {
  const b = req.body || {};
  const error = validateLaptop(b);
  if (error) return res.status(400).json({ error });

  const result = db.prepare(`
    INSERT INTO laptops
      (brand, model, processor, ram_gb, storage_gb, storage_type, screen_size,
       battery_health, condition, price, discount_percent, image, stock, use_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.brand, b.model, b.processor, Number(b.ram_gb), Number(b.storage_gb),
    b.storage_type || 'SSD', b.screen_size ? Number(b.screen_size) : null,
    b.battery_health || null, b.condition || 'Used', Number(b.price),
    Number(b.discount_percent || 0), b.image || '', Number(b.stock ?? 1),
    b.use_tags || ''
  );

  const created = db.prepare('SELECT * FROM laptops WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json(withFinalPrice(created));
});

app.put('/api/laptops/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM laptops WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Laptop not found' });

  const b = req.body || {};
  const error = validateLaptop(b);
  if (error) return res.status(400).json({ error });

  db.prepare(`
    UPDATE laptops SET
      brand = ?, model = ?, processor = ?, ram_gb = ?, storage_gb = ?,
      storage_type = ?, screen_size = ?, battery_health = ?, condition = ?,
      price = ?, discount_percent = ?, image = ?, stock = ?, use_tags = ?
    WHERE id = ?
  `).run(
    b.brand, b.model, b.processor, Number(b.ram_gb), Number(b.storage_gb),
    b.storage_type || 'SSD', b.screen_size ? Number(b.screen_size) : null,
    b.battery_health || null, b.condition || 'Used', Number(b.price),
    Number(b.discount_percent || 0), b.image || '', Number(b.stock ?? 1),
    b.use_tags || '', req.params.id
  );

  // The photo was replaced or removed, so delete the old file
  if (existing.image && existing.image !== (b.image || '')) {
    deleteImageFile(existing.image);
  }

  const updated = db.prepare('SELECT * FROM laptops WHERE id = ?').get(req.params.id);
  res.json(withFinalPrice(updated));
});

app.delete('/api/laptops/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM laptops WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Laptop not found' });

  db.prepare('DELETE FROM laptops WHERE id = ?').run(req.params.id);
  deleteImageFile(existing.image);
  res.json({ message: 'Laptop deleted' });
});

// Orders and payments (admin only)
app.use('/api/admin/orders', requireAdmin, require('./orders'));

// Customer requests: customers send them, the seller manages them
const requests = require('./requests');
app.use('/api/requests', requests.publicRouter);
app.use('/api/admin/requests', requireAdmin, requests.adminRouter);

// Handles bad JSON, oversized uploads and other unexpected errors
app.use((err, req, res, next) => {
  if (err.status === 413) {
    return res.status(413).json({ error: 'The photo is too large' });
  }
  console.error(err.message);
  res.status(400).json({ error: 'Invalid request' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});