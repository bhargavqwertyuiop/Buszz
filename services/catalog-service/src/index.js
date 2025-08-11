const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());

const PORT = process.env.PORT || 3003;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';

const db = new Database('catalog.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  mode TEXT NOT NULL, -- 'bus' | 'train'
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  total_seats INTEGER NOT NULL,
  base_price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  is_reserved INTEGER NOT NULL DEFAULT 0,
  UNIQUE(trip_id, seat_number)
);`);

function authOptional(req, _res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {}
  }
  next();
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM trips').get().c;
  if (count > 0) return;
  const trips = [
    { id: 't_bus_1', operator: 'InterCity', mode: 'bus', origin: 'CityA', destination: 'CityB', departure_time: '2025-08-12T08:00:00Z', arrival_time: '2025-08-12T12:00:00Z', total_seats: 40, base_price_cents: 2500 },
    { id: 't_train_1', operator: 'RailExpress', mode: 'train', origin: 'CityA', destination: 'CityC', departure_time: '2025-08-12T09:30:00Z', arrival_time: '2025-08-12T13:30:00Z', total_seats: 120, base_price_cents: 4500 }
  ];
  const insertTrip = db.prepare('INSERT INTO trips (id, operator, mode, origin, destination, departure_time, arrival_time, total_seats, base_price_cents) VALUES (@id, @operator, @mode, @origin, @destination, @departure_time, @arrival_time, @total_seats, @base_price_cents)');
  const insertSeat = db.prepare('INSERT INTO seats (id, trip_id, seat_number, is_reserved) VALUES (?, ?, ?, 0)');
  for (const trip of trips) {
    insertTrip.run(trip);
    for (let i = 1; i <= trip.total_seats; i++) {
      insertSeat.run(`${trip.id}_${i}`, trip.id, String(i));
    }
  }
}
seedIfEmpty();

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/search', authOptional, (req, res) => {
  const { origin, destination, date } = req.query;
  const rows = db.prepare(`SELECT * FROM trips WHERE 1=1
    ${origin ? 'AND origin = ?' : ''}
    ${destination ? 'AND destination = ?' : ''}
  `).all(...[origin, destination].filter(Boolean));
  return res.json(rows);
});

app.get('/trips/:id', authOptional, (req, res) => {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  return res.json(trip);
});

app.get('/trips/:id/seats', authOptional, (req, res) => {
  const seats = db.prepare('SELECT seat_number, is_reserved FROM seats WHERE trip_id = ? ORDER BY CAST(seat_number as INT)').all(req.params.id);
  return res.json(seats);
});

// Admin to create trips
app.post('/trips', (req, res) => {
  const { id, operator, mode, origin, destination, departure_time, arrival_time, total_seats, base_price_cents } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  db.prepare('INSERT INTO trips (id, operator, mode, origin, destination, departure_time, arrival_time, total_seats, base_price_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, operator, mode, origin, destination, departure_time, arrival_time, total_seats, base_price_cents);
  const insertSeat = db.prepare('INSERT INTO seats (id, trip_id, seat_number, is_reserved) VALUES (?, ?, ?, 0)');
  for (let i = 1; i <= total_seats; i++) {
    insertSeat.run(`${id}_${i}`, id, String(i));
  }
  return res.status(201).json({ status: 'created' });
});

// Internal: reserve seats
app.post('/internal/trips/:id/reserve', (req, res) => {
  const { seatNumbers } = req.body;
  const tripId = req.params.id;
  const placeholders = seatNumbers.map(() => '?').join(',');
  const tx = db.transaction(() => {
    const rows = db.prepare(`SELECT seat_number, is_reserved FROM seats WHERE trip_id = ? AND seat_number IN (${placeholders})`).all(tripId, ...seatNumbers);
    if (rows.some(r => r.is_reserved === 1)) {
      throw new Error('Some seats already reserved');
    }
    db.prepare(`UPDATE seats SET is_reserved = 1 WHERE trip_id = ? AND seat_number IN (${placeholders})`).run(tripId, ...seatNumbers);
  });
  try {
    tx();
    return res.json({ status: 'reserved' });
  } catch (e) {
    return res.status(409).json({ error: 'Seat conflict' });
  }
});

// Internal: release seats
app.post('/internal/trips/:id/release', (req, res) => {
  const { seatNumbers } = req.body;
  const tripId = req.params.id;
  const placeholders = seatNumbers.map(() => '?').join(',');
  db.prepare(`UPDATE seats SET is_reserved = 0 WHERE trip_id = ? AND seat_number IN (${placeholders})`).run(tripId, ...seatNumbers);
  return res.json({ status: 'released' });
});

app.listen(PORT, () => {
  console.log(`catalog-service listening on ${PORT}`);
});