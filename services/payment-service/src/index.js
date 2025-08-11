const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());

const PORT = process.env.PORT || 3005;

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/charge', (req, res) => {
  const { amountCents } = req.body;
  if (!amountCents || amountCents <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (Math.random() < 0.1) return res.status(402).json({ error: 'Payment declined' });
  return res.json({ paymentId: uuidv4(), status: 'succeeded' });
});

app.post('/refund', (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
  return res.json({ refundId: uuidv4(), status: 'succeeded' });
});

app.listen(PORT, () => {
  console.log(`payment-service listening on ${PORT}`);
});