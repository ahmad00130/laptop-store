const express = require('express');
const db = require('./db');

const publicRouter = express.Router(); // used by customers on the store page
const adminRouter = express.Router();  // used by the seller (login required)

const STATUSES = ['new', 'contacted', 'converted', 'declined'];
const PHONE_PATTERN = /^[0-9+\s()-]{7,20}$/;

/* ---------- Spam protection ---------- */

const hits = new Map(); // ip -> { count, resetAt }
const MAX_PER_HOUR = 5;

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of hits) {
    if (record.resetAt < now) hits.delete(ip);
  }
}, 30 * 60 * 1000).unref();

function tooMany(ip) {
  const now = Date.now();
  const record = hits.get(ip);
  if (!record || record.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  record.count += 1;
  return record.count > MAX_PER_HOUR;
}

function whole(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/* ---------- Public: a customer sends a request ---------- */

publicRouter.post('/', (req, res) => {
  const b = req.body || {};

  // Hidden trap field: real visitors never see it, bots fill it in
  if (b.website) return res.status(201).json({ ok: true });

  if (tooMany(req.ip)) {
    return res.status(429).json({
      error: 'Too many requests from this device. Please try again later or message us on WhatsApp.',
    });
  }

  const name = String(b.customer_name || '').trim();
  const phone = String(b.customer_phone || '').trim();
  const message = String(b.message || '').trim().slice(0, 300);
  const laptopId = whole(b.laptop_id);
  const payMode = b.pay_mode === 'installment' ? 'installment' : 'full';

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!PHONE_PATTERN.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!Number.isInteger(laptopId)) {
    return res.status(400).json({ error: 'Please choose a laptop.' });
  }

  let depositPercent = null;
  let months = null;
  if (payMode === 'installment') {
    depositPercent = whole(b.deposit_percent);
    months = whole(b.months);
    if (!(depositPercent >= 0 && depositPercent <= 100) || !(months >= 1 && months <= 12)) {
      return res.status(400).json({ error: 'Please choose a valid installment plan.' });
    }
  }

  const laptop = db.prepare('SELECT id, brand, model, stock FROM laptops WHERE id = ?').get(laptopId);
  if (!laptop || laptop.stock <= 0) {
    return res.status(400).json({ error: 'Sorry, this laptop is no longer available.' });
  }

  // The same person asking twice for the same laptop in a day only counts once
  const duplicate = db.prepare(`
    SELECT id FROM requests
    WHERE laptop_id = ? AND customer_phone = ? AND status = 'new'
      AND created_at > datetime('now', '-1 day')
  `).get(laptop.id, phone);
  if (duplicate) return res.status(201).json({ ok: true });

  db.prepare(`
    INSERT INTO requests
      (laptop_id, laptop_name, customer_name, customer_phone, message, pay_mode, deposit_percent, months)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(laptop.id, `${laptop.brand} ${laptop.model}`, name, phone, message, payMode, depositPercent, months);

  res.status(201).json({ ok: true });
});

/* ---------- Admin: the seller manages requests ---------- */

function findRequest(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id)) return null;
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id) || null;
}

adminRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM requests
    ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, id DESC
  `).all();
  res.json(rows);
});

adminRouter.post('/:id/status', (req, res) => {
  const request = findRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const status = (req.body || {}).status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, request.id);
  res.json(db.prepare('SELECT * FROM requests WHERE id = ?').get(request.id));
});

adminRouter.delete('/:id', (req, res) => {
  const request = findRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare('DELETE FROM requests WHERE id = ?').run(request.id);
  res.json({ message: 'Request deleted' });
});

module.exports = { publicRouter, adminRouter };