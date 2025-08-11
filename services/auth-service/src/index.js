const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';

const db = new Database('auth.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);`);

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '2h' });
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/register',
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) return res.status(409).json({ error: 'Email already registered' });
      const id = cryptoRandomId();
      const passwordHash = await bcrypt.hash(password, 10);
      db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, email, passwordHash, new Date().toISOString());

      try {
        await axios.post(`${USER_SERVICE_URL}/profiles`, { userId: id, email });
      } catch (e) {
        // best-effort profile creation
      }

      const token = generateToken({ id, email });
      return res.status(201).json({ token });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

app.post('/login',
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password } = req.body;
    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      const token = generateToken({ id: user.id, email: user.email });
      return res.json({ token });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

function cryptoRandomId() {
  return 'usr_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

app.listen(PORT, () => {
  console.log(`auth-service listening on ${PORT}`);
});