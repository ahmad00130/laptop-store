const express = require('express');
const db = require('./db');

const router = express.Router();
const METHODS = ['Transfer', 'Cash', 'POS', 'Other'];

/* ---------- Small helpers ---------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function handle(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error(err.message);
      res.status(500).json({ error: 'Something went wrong' });
    }
  };
}

function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function naira(amount) {
  return '\u20A6' + Number(amount).toLocaleString();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function utc(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function toInt(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

/* ---------- Loading and calculating ---------- */

function getOrderRow(idParam) {
  const id = Number(idParam);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Order not found');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) throw new HttpError(404, 'Order not found');
  return order;
}

function sumPayments(orderId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ?').get(orderId).total;
}

// Adds paid amount, balance, next due date, overdue flag and the payment schedule
function decorate(order, payments) {
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const balance = Math.max(0, order.total_amount - paid);
  const today = todayISO();

  let nextDueDate = null;
  let nextDueAmount = 0;
  let overdue = false;
  let daysOverdue = 0;

  if (order.status === 'active' && balance > 0) {
    for (let k = 0; k <= order.months; k++) {
      const expected = Math.min(order.total_amount, order.deposit_amount + k * order.monthly_amount);
      if (expected > paid) {
        nextDueDate = addMonths(order.start_date, k);
        nextDueAmount = expected - paid;
        break;
      }
    }
    if (nextDueDate && nextDueDate < today) {
      overdue = true;
      daysOverdue = Math.round((utc(today) - utc(nextDueDate)) / 86400000);
    }
  }

  const schedule = [];
  for (let k = 0; k <= order.months; k++) {
    const cumulative = Math.min(order.total_amount, order.deposit_amount + k * order.monthly_amount);
    const amount = k === 0 ? order.deposit_amount : order.monthly_amount;
    if (amount <= 0) continue;
    schedule.push({
      label: k === 0 ? 'Deposit' : `Month ${k}`,
      due_date: addMonths(order.start_date, k),
      amount,
      done: paid >= cumulative,
    });
  }

  return {
    ...order,
    handed_over: Boolean(order.handed_over),
    payments,
    paid,
    balance,
    next_due_date: nextDueDate,
    next_due_amount: nextDueAmount,
    overdue,
    days_overdue: daysOverdue,
    schedule,
  };
}

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY paid_on, id').all(id);
  return decorate(order, payments);
}

// Marks an order completed when fully paid, or active again if a payment was removed
function refreshStatus(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status === 'cancelled') return;

  const status = sumPayments(orderId) >= order.total_amount ? 'completed' : 'active';
  if (status !== order.status) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
  }
}

/* ---------- Routes (all admin only, see server.js) ---------- */

// List all orders
router.get('/', handle((req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json(orders.map((order) => {
    const payments = db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY paid_on, id').all(order.id);
    return decorate(order, payments);
  }));
}));

// Create an order
router.post('/', handle((req, res) => {
  const b = req.body || {};

  const laptopId = toInt(b.laptop_id);
  const customerName = String(b.customer_name || '').trim();
  const customerPhone = String(b.customer_phone || '').trim();
  const deposit = toInt(b.deposit_amount);
  const months = toInt(b.months);
  const markup = b.markup_percent === '' || b.markup_percent === undefined ? 0 : toInt(b.markup_percent);
  const startDate = b.start_date ? String(b.start_date) : todayISO();
  const notes = String(b.notes || '').trim().slice(0, 300);

  if (!Number.isInteger(laptopId)) throw new HttpError(400, 'Choose a laptop');
  if (customerName.length < 2 || customerName.length > 100) throw new HttpError(400, 'Enter the customer name');
  if (!/^[0-9+\s()-]{7,20}$/.test(customerPhone)) throw new HttpError(400, 'Enter a valid phone number');
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new HttpError(400, 'Months must be between 1 and 12');
  if (!Number.isInteger(markup) || markup < 0 || markup > 100) throw new HttpError(400, 'Extra charge must be between 0 and 100');
  if (!isValidDate(startDate)) throw new HttpError(400, 'Enter a valid start date');

  const laptop = db.prepare('SELECT * FROM laptops WHERE id = ?').get(laptopId);
  if (!laptop) throw new HttpError(404, 'Laptop not found');
  if (laptop.stock <= 0) throw new HttpError(400, 'This laptop is out of stock');

  // The price is always worked out here on the server, never taken from the browser
  const price = Math.round(laptop.price - (laptop.price * laptop.discount_percent) / 100);

  if (!Number.isInteger(deposit) || deposit < 0 || deposit > price) {
    throw new HttpError(400, `Deposit must be between ${naira(0)} and ${naira(price)}`);
  }

  const balance = price - deposit;
  const extra = Math.round((balance * markup) / 100);
  const monthly = Math.ceil((balance + extra) / months);
  const total = deposit + monthly * months;
  const laptopName = `${laptop.brand} ${laptop.model}`;

  const orderId = inTransaction(() => {
    const stock = db.prepare('UPDATE laptops SET stock = stock - 1 WHERE id = ? AND stock > 0').run(laptop.id);
    if (stock.changes === 0) throw new HttpError(400, 'This laptop just went out of stock');

    const result = db.prepare(`
      INSERT INTO orders
        (laptop_id, laptop_name, customer_name, customer_phone, price_amount, deposit_amount,
         months, markup_percent, monthly_amount, total_amount, start_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(laptop.id, laptopName, customerName, customerPhone, price, deposit,
           months, markup, monthly, total, startDate, notes);
    return Number(result.lastInsertRowid);
  });

  res.status(201).json(loadOrder(orderId));
}));

// Record a payment
router.post('/:id/payments', handle((req, res) => {
  const order = getOrderRow(req.params.id);
  if (order.status === 'cancelled') throw new HttpError(400, 'This order is cancelled');

  const b = req.body || {};
  const amount = toInt(b.amount);
  const paidOn = b.paid_on ? String(b.paid_on) : todayISO();
  const method = b.method ? String(b.method) : 'Transfer';
  const note = String(b.note || '').trim().slice(0, 200);

  if (!(amount > 0)) throw new HttpError(400, 'Enter the amount received');
  if (!isValidDate(paidOn)) throw new HttpError(400, 'Enter a valid payment date');
  if (paidOn > todayISO()) throw new HttpError(400, 'The payment date cannot be in the future');
  if (!METHODS.includes(method)) throw new HttpError(400, 'Choose a payment method');

  const balance = order.total_amount - sumPayments(order.id);
  if (balance <= 0) throw new HttpError(400, 'This order is already fully paid');
  if (amount > balance) throw new HttpError(400, `That is more than the balance of ${naira(balance)}`);

  db.prepare('INSERT INTO payments (order_id, amount, paid_on, method, note) VALUES (?, ?, ?, ?, ?)')
    .run(order.id, amount, paidOn, method, note);
  refreshStatus(order.id);

  res.status(201).json(loadOrder(order.id));
}));

// Remove a payment that was entered by mistake
router.delete('/:id/payments/:paymentId', handle((req, res) => {
  const order = getOrderRow(req.params.id);
  if (order.status === 'cancelled') throw new HttpError(400, 'This order is cancelled');

  const paymentId = Number(req.params.paymentId);
  const payment = Number.isInteger(paymentId)
    ? db.prepare('SELECT * FROM payments WHERE id = ? AND order_id = ?').get(paymentId, order.id)
    : null;
  if (!payment) throw new HttpError(404, 'Payment not found');

  db.prepare('DELETE FROM payments WHERE id = ?').run(payment.id);
  refreshStatus(order.id);

  res.json(loadOrder(order.id));
}));

// Mark the laptop as handed over (or undo it)
router.post('/:id/handover', handle((req, res) => {
  const order = getOrderRow(req.params.id);
  if (order.status === 'cancelled') throw new HttpError(400, 'This order is cancelled');

  const handedOver = (req.body || {}).handed_over === true;

  if (handedOver && sumPayments(order.id) < order.deposit_amount) {
    throw new HttpError(400, 'The deposit has not been fully paid yet');
  }

  db.prepare('UPDATE orders SET handed_over = ? WHERE id = ?').run(handedOver ? 1 : 0, order.id);
  res.json(loadOrder(order.id));
}));

// Cancel an order and put the laptop back in stock
router.post('/:id/cancel', handle((req, res) => {
  const order = getOrderRow(req.params.id);
  if (order.status !== 'active') throw new HttpError(400, 'Only active orders can be cancelled');
  if (order.handed_over) {
    throw new HttpError(400, 'The laptop was handed over. Once it is returned, undo "handed over", then cancel.');
  }

  inTransaction(() => {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    if (order.laptop_id) {
      db.prepare('UPDATE laptops SET stock = stock + 1 WHERE id = ?').run(order.laptop_id);
    }
  });

  res.json(loadOrder(order.id));
}));

module.exports = router;