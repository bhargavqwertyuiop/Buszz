const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());

const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';
const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3003';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3005';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';
const HOLD_TTL_MS = parseInt(process.env.HOLD_TTL_MS || '900000', 10); // default 15 minutes

const db = new Database('booking.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  seat_numbers TEXT NOT NULL, -- JSON array string
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL, -- HELD | CONFIRMED | CANCELLED | REFUNDED
  hold_created_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payment_id TEXT
);`);

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/hold', authenticate, async (req, res) => {
  const { tripId, seatNumbers, amountCents } = req.body;
  if (!tripId || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
    return res.status(400).json({ error: 'tripId and seatNumbers required' });
  }
  try {
    await axios.post(`${CATALOG_SERVICE_URL}/internal/trips/${tripId}/reserve`, { seatNumbers });
  } catch (e) {
    return res.status(409).json({ error: 'Seat conflict' });
  }
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare('INSERT INTO bookings (id, user_id, trip_id, seat_numbers, amount_cents, status, hold_created_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.user.userId, tripId, JSON.stringify(seatNumbers), amountCents ?? 0, 'HELD', now, now, now);
  return res.status(201).json({ bookingId: id, status: 'HELD' });
});

app.post('/:id/confirm', authenticate, async (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  if (booking.status !== 'HELD') return res.status(400).json({ error: 'Invalid state' });
  try {
    const payment = await axios.post(`${PAYMENT_SERVICE_URL}/charge`, {
      amountCents: booking.amount_cents,
      currency: 'USD',
      source: 'mock',
      metadata: { bookingId: booking.id }
    });
    db.prepare('UPDATE bookings SET status = ?, updated_at = ?, payment_id = ? WHERE id = ?')
      .run('CONFIRMED', new Date().toISOString(), payment.data.paymentId, booking.id);

    try {
      await axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, {
        userId: booking.user_id,
        type: 'BOOKING_CONFIRMED',
        payload: { bookingId: booking.id, tripId: booking.trip_id, seats: JSON.parse(booking.seat_numbers) }
      });
    } catch {}

    return res.json({ status: 'CONFIRMED' });
  } catch (e) {
    await axios.post(`${CATALOG_SERVICE_URL}/internal/trips/${booking.trip_id}/release`, { seatNumbers: JSON.parse(booking.seat_numbers) }).catch(() => {});
    db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?')
      .run('CANCELLED', new Date().toISOString(), booking.id);
    return res.status(402).json({ error: 'Payment failed' });
  }
});

app.post('/:id/cancel', authenticate, async (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  if (booking.status !== 'CONFIRMED') return res.status(400).json({ error: 'Only confirmed bookings can be cancelled' });
  try {
    if (booking.payment_id) {
      await axios.post(`${PAYMENT_SERVICE_URL}/refund`, { paymentId: booking.payment_id, amountCents: booking.amount_cents });
    }
  } catch {}
  await axios.post(`${CATALOG_SERVICE_URL}/internal/trips/${booking.trip_id}/release`, { seatNumbers: JSON.parse(booking.seat_numbers) }).catch(() => {});
  db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run('REFUNDED', new Date().toISOString(), booking.id);
  return res.json({ status: 'REFUNDED' });
});

app.get('/:id', authenticate, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  booking.seat_numbers = JSON.parse(booking.seat_numbers);
  return res.json(booking);
});

app.get('/mine', authenticate, (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId);
  for (const r of rows) {
    r.seat_numbers = JSON.parse(r.seat_numbers);
  }
  return res.json(rows);
});

async function releaseExpiredHolds() {
  const cutoff = new Date(Date.now() - HOLD_TTL_MS).toISOString();
  const expired = db.prepare('SELECT * FROM bookings WHERE status = ? AND hold_created_at < ?').all('HELD', cutoff);
  for (const b of expired) {
    try {
      await axios.post(`${CATALOG_SERVICE_URL}/internal/trips/${b.trip_id}/release`, { seatNumbers: JSON.parse(b.seat_numbers) });
    } catch {}
    db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run('CANCELLED', new Date().toISOString(), b.id);
  }
}

setInterval(() => {
  releaseExpiredHolds().catch(() => {});
}, Math.min(HOLD_TTL_MS, 60000)); // run at least every minute

app.listen(PORT, () => {
  console.log(`booking-service listening on ${PORT}`);
});