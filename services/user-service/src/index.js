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

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';

const db = new Database('users.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/profiles', (req, res) => {
  const { userId, email } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const exists = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(userId);
  if (exists) return res.status(200).json({ status: 'exists' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO profiles (user_id, email, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, email || null, null, null, now, now);
  return res.status(201).json({ status: 'created' });
});

app.get('/me', authenticate, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId);
  if (!profile) {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO profiles (user_id, email, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.userId, req.user.email || null, null, null, now, now);
    return res.json({ user_id: req.user.userId, email: req.user.email, full_name: null, phone: null });
  }
  return res.json(profile);
});

app.patch('/me', authenticate, (req, res) => {
  const { full_name, phone } = req.body;
  const now = new Date().toISOString();
  db.prepare('UPDATE profiles SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone), updated_at = ? WHERE user_id = ?')
    .run(full_name ?? null, phone ?? null, now, req.user.userId);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.userId);
  return res.json(profile);
});

app.listen(PORT, () => {
  console.log(`user-service listening on ${PORT}`);
});