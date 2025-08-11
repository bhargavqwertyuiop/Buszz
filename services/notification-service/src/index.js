const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());

const PORT = process.env.PORT || 3006;

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/notify', (req, res) => {
  const { userId, type, payload } = req.body;
  console.log(`[notification] user=${userId} type=${type} payload=${JSON.stringify(payload)}`);
  return res.json({ status: 'sent' });
});

app.listen(PORT, () => {
  console.log(`notification-service listening on ${PORT}`);
});