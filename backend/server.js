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
import { SQLiteSessionStore } from './lib/sqlite-session-store.js';
import { csrfProtection, csrfTokenHandler } from './lib/csrf.js';
import { hasSecretEncryptionKey } from './lib/secret-vault.js';
import { frameAncestorsForOrigins, parseEmbedAllowedOrigins } from './lib/embed.js';
import { shopifyFileStorageStatus } from './lib/shopify-file-storage.js';

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
import shopifyRouter, {
  shopifyEmbeddedAdminPage,
  shopifyProxyRouter,
  shopifyWebhookHandler,
} from './routes/shopify.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = join(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';
const sessionStore = new SQLiteSessionStore(db);
const startedAt = Date.now();
const appVersion = process.env.npm_package_version || '1.0.0';

function assertProductionConfig() {
  if (!isProduction) return;
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-change-me') missing.push('SESSION_SECRET');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-jwt-secret') missing.push('JWT_SECRET');
  if (!process.env.BASE_URL || !/^https:\/\//.test(process.env.BASE_URL)) missing.push('BASE_URL=https://...');
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) missing.push('RESEND_API_KEY or SMTP_HOST');
  if (!process.env.PLATFORM_CONFIG_ENCRYPTION_KEY || !hasSecretEncryptionKey()) missing.push('PLATFORM_CONFIG_ENCRYPTION_KEY');
  if (missing.length) {
    throw new Error(`Refusing to start in production. Missing/unsafe config: ${missing.join(', ')}`);
  }
}

assertProductionConfig();
app.disable('x-powered-by');

// ── Security headers ──────────────────────────────────────────
app.use((req, res, next) => {
  const shopifySurface = req.path === '/app'
    || req.path.startsWith('/apps/3d-quote')
    || req.path.startsWith('/api/shopify');
  const embedSurface = req.path.startsWith('/embed/');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!shopifySurface && !embedSurface) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  } else {
    if (shopifySurface) {
      res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com;");
    }
  }
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Stripe webhook (raw body BEFORE json parser) ──────────────
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);
app.post('/api/shopify/webhooks',
  express.raw({ type: 'application/json' }),
  shopifyWebhookHandler
);

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Session ───────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  }
}));
setInterval(() => {
  try { sessionStore.clearExpired(); } catch {}
}, 60 * 60 * 1000).unref();
app.get('/api/csrf-token', csrfTokenHandler);
app.use(csrfProtection);

// ── Static files (public website only) ───────────────────────
const privatePrefixes = [
  '/backend', '/.git', '/node_modules', '/package.json', '/package-lock.json',
  '/trennen-site.zip', '/.env', '/.DS_Store', '/security.md', '/payments_setup.md',
  '/milestone_stability_security.md', '/security_review_post_milestone.md', '/research'
];
app.use((req, res, next) => {
  const path = req.path.toLowerCase();
  if (privatePrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))) {
    return res.status(404).send('Not found');
  }
  next();
});
app.use('/assets', express.static(join(ROOT_DIR, 'assets'), { dotfiles: 'deny', index: false }));
app.use('/admin', express.static(join(ROOT_DIR, 'admin'), { dotfiles: 'deny', index: false }));
app.use('/customer', express.static(join(ROOT_DIR, 'customer'), { dotfiles: 'deny', index: false }));
app.use('/platform', express.static(join(ROOT_DIR, 'platform'), { dotfiles: 'deny', index: false }));
app.use('/uploads', express.static(join(ROOT_DIR, 'uploads'), {
  dotfiles: 'deny',
  index: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));
const publicRootPages = new Set([
  '/', '/index.html', '/catalog.html', '/checkout.html', '/confirmation.html',
  '/materials.html', '/onboarding.html', '/options.html', '/privacy.html', '/quote.html',
  '/stripe-callback.html', '/terms.html'
]);

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 as ok').get();
    res.json({
      ok: true,
      version: appVersion,
      environment: process.env.NODE_ENV || 'development',
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      database: {
        engine: 'sqlite',
        status: 'ok',
      },
      storage: {
        shopify: shopifyFileStorageStatus(),
        uploads: {
          mode: 'local',
          publicPath: '/uploads',
        },
      },
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      version: appVersion,
      database: {
        engine: 'sqlite',
        status: 'error',
        error: err.message,
      },
    });
  }
});

app.get('/embed/v1/widget.js', (req, res) => {
  res.type('application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(`(() => {
  const script = document.currentScript;
  if (!script) return;
  const shop = script.dataset.shop || script.getAttribute('data-shop');
  if (!shop) return;
  const scriptUrl = new URL(script.src, window.location.href);
  const baseUrl = (script.dataset.baseUrl || scriptUrl.origin).replace(/\\/$/, '');
  const iframe = document.createElement('iframe');
  iframe.src = baseUrl + '/embed/quote?shop=' + encodeURIComponent(shop);
  iframe.title = script.dataset.title || 'Instant 3D quote';
  iframe.loading = 'lazy';
  iframe.style.width = '100%';
  iframe.style.minHeight = script.dataset.height || '760px';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.setAttribute('allow', 'payment');
  const mountSelector = script.dataset.mount;
  const mount = mountSelector ? document.querySelector(mountSelector) : null;
  (mount || script.parentNode).insertBefore(iframe, mount ? null : script.nextSibling);
})();`);
});

app.get('/embed/quote', (req, res) => {
  const slug = String(req.query.shop || req.query.slug || '').trim();
  if (!slug) return res.status(400).send('Shop is required.');
  const shop = db.prepare("SELECT id, slug FROM shops WHERE slug = ? AND plan != 'suspended'").get(slug);
  if (!shop) return res.status(404).send('Shop not found.');
  const settings = db.prepare('SELECT embed_allowed_origins FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestorsForOrigins(parseEmbedAllowedOrigins(settings.embed_allowed_origins))};`);
  res.sendFile(join(ROOT_DIR, 'quote.html'));
});

app.get([...publicRootPages], (req, res) => {
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(join(ROOT_DIR, page));
});

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
app.use('/api/shopify', shopifyRouter);
app.use('/apps/3d-quote', shopifyProxyRouter);
app.get('/app', shopifyEmbeddedAdminPage);

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
  res.sendFile(join(ROOT_DIR, 'index.html'));
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
