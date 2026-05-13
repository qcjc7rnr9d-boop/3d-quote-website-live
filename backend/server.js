// Load .env from this file's directory so the server picks it up regardless
// of where node was launched from (e.g. project root vs backend/).
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import express from 'express';
import session from 'express-session';

import { db, requireShopAuth } from './middleware/auth.js';
import { SESSION_DAYS } from './config.js';

import authRouter from './routes/auth.js';
import materialsRouter from './routes/materials.js';
import ordersRouter from './routes/orders.js';
import customersRouter from './routes/customers.js';
import pricingRouter from './routes/pricing.js';
import settingsRouter from './routes/settings.js';
import stripeRouter, { stripeWebhookHandler } from './routes/stripe.js';
import platformRouter from './routes/platform.js';
import customerPortalRouter from './routes/customer-portal.js';
import shippingRouter from './routes/shipping.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Stripe webhook (raw body BEFORE json parser) ──────────────
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Session ───────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  }
}));

// ── Static files (public website) ────────────────────────────
app.use(express.static(join(__dirname, '..')));

// ── API routes ────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/customers', customersRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/platform', platformRouter);
app.use('/api/customer', customerPortalRouter);
app.use('/api/shipping', shippingRouter);

// ── Public: platform identity (Trennen) ────────────────────────
// Lets unauthenticated pages (admin auth screens, platform login,
// the brand applier) display the platform name without leaking any
// shop-level data.
app.get('/api/platform-info', (req, res) => {
  res.json({
    name:   (process.env.PLATFORM_NAME   || 'Trennen').trim()      || 'Trennen',
    domain: (process.env.PLATFORM_DOMAIN || 'trennen.co.nz').trim() || 'trennen.co.nz',
  });
});

// ── Dashboard stats ───────────────────────────────────────────
app.get('/api/dashboard/stats', requireShopAuth, (req, res) => {
  try {
    const shopId = req.shop.id;
    const totalOrders = db.prepare(
      'SELECT COUNT(*) as c FROM orders WHERE shop_id = ?'
    ).get(shopId).c;

    const thisWeek = db.prepare(
      "SELECT COUNT(*) as c FROM orders WHERE shop_id = ? AND created_at >= datetime('now','-7 days')"
    ).get(shopId).c;

    const monthRevenue = db.prepare(
      "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE shop_id = ? AND payment_status = 'paid' AND created_at >= datetime('now','start of month')"
    ).get(shopId).s;

    const materialCount = db.prepare(
      'SELECT COUNT(*) as c FROM materials WHERE shop_id = ? AND active = 1'
    ).get(shopId).c;

    const customerCount = db.prepare(
      'SELECT COUNT(*) as c FROM customers WHERE shop_id = ?'
    ).get(shopId).c;

    res.json({ totalOrders, thisWeek, monthRevenue, materialCount, customerCount });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 404 fallback ──────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, '../index.html'));
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`RF DEWI backend running on http://localhost:${PORT}`);
});
