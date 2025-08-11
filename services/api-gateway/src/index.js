const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(helmet());
app.use(cors());

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwt';

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Public routes
app.use('/auth', createProxyMiddleware({ target: process.env.AUTH_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/auth': '' } }));
app.use('/catalog', createProxyMiddleware({ target: process.env.CATALOG_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/catalog': '' } }));

// Protected routes
app.use('/users', authenticateToken, createProxyMiddleware({ target: process.env.USER_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/users': '' } }));
app.use('/booking', authenticateToken, createProxyMiddleware({ target: process.env.BOOKING_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/booking': '' } }));
app.use('/payments', authenticateToken, createProxyMiddleware({ target: process.env.PAYMENT_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/payments': '' } }));
app.use('/notifications', authenticateToken, createProxyMiddleware({ target: process.env.NOTIFICATION_SERVICE_URL, changeOrigin: true, pathRewrite: { '^/notifications': '' } }));

app.listen(PORT, () => {
  console.log(`API Gateway listening on port ${PORT}`);
});