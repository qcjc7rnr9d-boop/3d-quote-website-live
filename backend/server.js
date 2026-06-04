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
import {
  EMBED_DNS_TARGET,
  EMBED_SCRIPT_HOST,
  frameAncestorsForOrigins,
  getEmbedSettingsForShop,
  normaliseRequestHost,
  parseEmbedAllowedOrigins,
  quoteDomainSettingsPayload,
  resolveShopForEmbed,
} from './lib/embed.js';
import { mailerStatus } from './lib/mailer.js';

import authRouter from './routes/auth.js';
import materialsRouter from './routes/materials.js';
import ordersRouter from './routes/orders.js';
import customersRouter from './routes/customers.js';
import pricingRouter from './routes/pricing.js';
import settingsRouter from './routes/settings.js';
import stripeRouter, { stripeWebhookHandler } from './routes/stripe.js';
import { resendWebhookHandler } from './routes/email-webhooks.js';
import platformRouter from './routes/platform.js';
import customerPortalRouter from './routes/customer-portal.js';
import shippingRouter from './routes/shipping.js';
import billingRouter from './routes/billing.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = join(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';
const sessionStore = new SQLiteSessionStore(db);
const startedAt = Date.now();
const appVersion = process.env.npm_package_version || '1.0.0';
const iframeQuoteFlowPages = new Set([
  '/',
  '/index.html',
  '/materials.html',
  '/options.html',
  '/quote.html',
  '/checkout.html',
]);

function embedFrameAncestorsForRequest(req) {
  const shop = resolveShopForEmbed(db, {
    tenant: req.query.tenant || req.query.tenant_id,
    shop: req.query.shop || req.query.slug,
    host: requestHost(req),
  });
  if (!shop) return "'self'";
  const settings = getEmbedSettingsForShop(db, shop.id);
  return frameAncestorsForOrigins(parseEmbedAllowedOrigins(settings.embed_allowed_origins));
}

function isIframeQuoteFlowRequest(req) {
  return req.query.embed === '1' && iframeQuoteFlowPages.has(req.path);
}

function requestHost(req) {
  return req.get('x-forwarded-host') || req.headers.host || '';
}

function isPlatformHost(host) {
  const value = normaliseRequestHost(host);
  if (!value) return true;
  if (['localhost', '127.0.0.1', '[::1]'].includes(value)) return true;
  const configured = [
    process.env.BASE_URL,
    process.env.EMBED_BASE_URL,
    process.env.QUOTE_BASE_URL,
    'https://app.trennen.co.nz',
    EMBED_SCRIPT_HOST,
    `https://${EMBED_DNS_TARGET}`,
  ].map(url => {
    try { return normaliseRequestHost(new URL(url).host); } catch { return ''; }
  }).filter(Boolean);
  return configured.includes(value);
}

function quoteFlowUrlForShop(shop) {
  const params = new URLSearchParams({
    shop: shop.slug,
    tenant: shop.public_tenant_id || '',
    embed: '1',
  });
  if (!shop.public_tenant_id) params.delete('tenant');
  return `/index.html?${params.toString()}`;
}

function sendUnknownQuoteHost(res) {
  res.status(404).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Quote domain setup required</title>
<style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f7f4ee;color:#20211f}.wrap{max-width:720px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #e4dfd7;border-radius:16px}h1{font-size:28px;margin:0 0 12px}p{line-height:1.6;color:#6f746d}</style></head>
<body><main class="wrap"><h1>Quote domain setup required</h1><p>This quote domain is not active yet. Check the merchant settings in Trennen and point the CNAME record to <strong>${EMBED_DNS_TARGET}</strong>.</p></main></body></html>`);
}

function assertProductionConfig() {
  if (!isProduction) return;
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-change-me') missing.push('SESSION_SECRET');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-jwt-secret') missing.push('JWT_SECRET');
  if (!process.env.BASE_URL || !/^https:\/\//.test(process.env.BASE_URL)) missing.push('BASE_URL=https://...');
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) missing.push('RESEND_API_KEY or SMTP_HOST');
  if (process.env.RESEND_API_KEY && !process.env.RESEND_WEBHOOK_SECRET) missing.push('RESEND_WEBHOOK_SECRET');
  if (process.env.RESEND_API_KEY && !process.env.APP_EMAIL_DOMAIN && !process.env.APP_EMAIL_FALLBACK) missing.push('APP_EMAIL_DOMAIN or APP_EMAIL_FALLBACK');
  if (!process.env.PLATFORM_CONFIG_ENCRYPTION_KEY || !hasSecretEncryptionKey()) missing.push('PLATFORM_CONFIG_ENCRYPTION_KEY');
  if (missing.length) {
    throw new Error(`Refusing to start in production. Missing/unsafe config: ${missing.join(', ')}`);
  }
}

assertProductionConfig();
app.disable('x-powered-by');
if (isProduction || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

// ── Security headers ──────────────────────────────────────────
app.use((req, res, next) => {
  const embedSurface = req.path.startsWith('/embed/');
  const iframeQuoteFlow = isIframeQuoteFlowRequest(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!embedSurface && !iframeQuoteFlow) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  if (iframeQuoteFlow) {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${embedFrameAncestorsForRequest(req)};`);
  }
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Stripe webhook (raw body BEFORE json parser) ──────────────
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler
);
app.post('/api/email/resend-webhook',
  express.raw({ type: 'application/json' }),
  resendWebhookHandler
);

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Disabled future surfaces for the lean quote + Stripe release ─
app.all(/^\/api\/shopify(?:\/|$)/, (req, res) => res.status(404).json({ error: 'Not found' }));
app.all(/^\/apps\/3d-quote(?:\/|$)/, (req, res) => res.status(404).send('Not found'));
app.all('/app', (req, res) => res.status(404).send('Not found'));

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
  '/catalog.html', '/checkout.html', '/confirmation.html', '/index.html',
  '/materials.html', '/options.html', '/privacy.html', '/quote.html',
  '/pricing.html', '/stripe-callback.html', '/terms.html'
]);

app.use((req, res, next) => {
  if (isPlatformHost(requestHost(req))) return next();
  if (!iframeQuoteFlowPages.has(req.path) && req.path !== '/embed/quote') return next();

  const shop = resolveShopForEmbed(db, { host: requestHost(req) });
  if (!shop) return sendUnknownQuoteHost(res);

  if (req.path === '/' || req.path === '/embed/quote') {
    return res.redirect(302, quoteFlowUrlForShop(shop));
  }

  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${embedFrameAncestorsForRequest(req)};`);
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  return res.sendFile(join(ROOT_DIR, page));
});

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(join(ROOT_DIR, 'index.html'));
});

app.get('/onboarding.html', (req, res) => {
  res.redirect(302, '/admin/payments.html');
});

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 as ok').get();
    const mail = mailerStatus();
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
        uploads: {
          mode: 'local',
          publicPath: '/uploads',
        },
      },
      readiness: {
        proxy: {
          trustProxy: !!app.get('trust proxy'),
        },
        email: {
          provider: mail.provider,
          configured: mail.provider === 'resend'
            ? !!(process.env.RESEND_API_KEY && (process.env.APP_EMAIL_DOMAIN || process.env.APP_EMAIL_FALLBACK) && process.env.RESEND_WEBHOOK_SECRET)
            : mail.provider === 'smtp'
              ? !!(process.env.SMTP_HOST && (process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER))
              : false,
          domain: process.env.APP_EMAIL_DOMAIN || null,
          fallbackConfigured: !!process.env.APP_EMAIL_FALLBACK,
          webhookConfigured: !!process.env.RESEND_WEBHOOK_SECRET,
        },
        payments: {
          stripeConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY),
          connectConfigured: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CLIENT_ID),
          webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        },
        secrets: {
          platformEncryptionConfigured: hasSecretEncryptionKey(),
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
      readiness: {
        database: false,
      },
    });
  }
});

function sendEmbedWidget(req, res) {
  res.type('application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(`(() => {
  const script = document.currentScript;
  if (!script) return;
  const tenant = script.dataset.tenantId || script.getAttribute('data-tenant-id') || script.dataset.tenant || script.getAttribute('data-tenant');
  const shop = script.dataset.shop || script.getAttribute('data-shop');
  if (!tenant && !shop) return;
  const scriptUrl = new URL(script.src, window.location.href);
  const baseUrl = (script.dataset.baseUrl || scriptUrl.origin).replace(/\\/$/, '');
  const quoteBaseUrl = (script.dataset.quoteBaseUrl || baseUrl).replace(/\\/$/, '');
  const minHeight = Math.max(220, parseInt(script.dataset.minHeight || script.getAttribute('data-min-height') || script.dataset.height || '760', 10) || 760);
  const maxHeight = Math.max(minHeight, parseInt(script.dataset.maxHeight || script.getAttribute('data-max-height') || '8000', 10) || 8000);
  const clampHeight = value => Math.min(maxHeight, Math.max(minHeight, Math.ceil(Number(value) || minHeight)));
  const themePrimary = script.dataset.themePrimary || script.getAttribute('data-theme-primary') || '';
  const themeFont = script.dataset.themeFont || script.getAttribute('data-theme-font') || '';
  const query = new URLSearchParams({ embed: '1' });
  if (tenant) query.set('tenant', tenant);
  if (shop) query.set('shop', shop);
  if (themePrimary) query.set('theme_primary', themePrimary);
  if (themeFont) query.set('theme_font', themeFont);
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.dataset.trennenQuoteStatus = 'loading';
  status.textContent = 'Loading quote tool...';
  status.style.cssText = [
    'box-sizing:border-box',
    'width:100%',
    'padding:12px 14px',
    'margin:0 0 10px',
    'border:1px solid #dfe5db',
    'border-radius:10px',
    'background:#f7f4ee',
    'color:#354037',
    'font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  ].join(';');
  const iframe = document.createElement('iframe');
  iframe.src = quoteBaseUrl + '/index.html?' + query.toString();
  iframe.title = script.dataset.title || 'Instant 3D quote';
  iframe.loading = 'eager';
  iframe.style.width = '100%';
  iframe.style.minHeight = minHeight + 'px';
  iframe.style.height = minHeight + 'px';
  iframe.style.border = '0';
  iframe.style.display = 'block';
  iframe.style.overflow = 'hidden';
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('allow', 'payment');
  iframe.dataset.trennenQuoteFrame = 'true';
  let frameReady = false;
  const markFrameReady = () => {
    frameReady = true;
    status.hidden = true;
    if (loadTimer) window.clearTimeout(loadTimer);
  };
  const loadTimer = window.setTimeout(() => {
    if (frameReady) return;
    const link = document.createElement('a');
    link.href = iframe.src || quoteBaseUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open the quote page';
    status.dataset.trennenQuoteStatus = 'error';
    status.setAttribute('role', 'alert');
    status.textContent = 'The quote tool did not finish loading. ';
    status.appendChild(link);
    status.appendChild(document.createTextNode('.'));
  }, 9000);
  if (tenant) {
    fetch(baseUrl + '/api/embed/config?tenant=' + encodeURIComponent(tenant), { credentials: 'omit' })
      .then(res => res.ok ? res.json() : null)
      .then(config => {
        if (!config || !config.quote_url) return;
        const target = new URL(config.quote_url, baseUrl);
        query.forEach((value, key) => target.searchParams.set(key, value));
        if (!target.searchParams.get('shop') && config.shop_slug) {
          target.searchParams.set('shop', config.shop_slug);
        }
        iframe.src = target.toString();
      })
      .catch(() => {});
  }
  window.addEventListener('message', event => {
    if (event.source !== iframe.contentWindow) return;
    try {
      const frameOrigin = new URL(iframe.src).origin;
      if (event.origin !== frameOrigin) return;
    } catch {
      if (event.origin !== baseUrl) return;
    }
    const data = event.data || {};
    if (data.type !== 'trennen:embed-resize') return;
    markFrameReady();
    iframe.style.height = clampHeight(data.height) + 'px';
  });
  const mountSelector = script.dataset.mount;
  const explicitMount = mountSelector ? document.querySelector(mountSelector) : null;
  const defaultMount = document.getElementById('trennen-quote-widget');
  const mount = explicitMount || defaultMount;
  if (mount) {
    mount.appendChild(status);
    mount.appendChild(iframe);
  } else if (script.parentNode) {
    script.parentNode.insertBefore(status, script.nextSibling);
    script.parentNode.insertBefore(iframe, status.nextSibling);
  }
})();`);
}

app.get(['/embed/v1/widget.js', '/widget.js'], sendEmbedWidget);

app.get('/api/embed/config', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const tenant = String(req.query.tenant || req.query.tenant_id || '').trim();
  const shop = resolveShopForEmbed(db, { tenant });
  if (!tenant || !shop) return res.status(404).json({ error: 'Tenant not found.' });
  const settings = getEmbedSettingsForShop(db, shop.id);
  const domain = quoteDomainSettingsPayload(settings);
  res.json({
    tenant_id: shop.public_tenant_id,
    shop_slug: shop.slug,
    shop_name: shop.name,
    custom_domain: domain,
    quote_url: domain.active ? `https://${domain.domain}/index.html` : `/index.html`,
  });
});

app.options('/api/embed/config', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});

app.get('/embed/quote', (req, res) => {
  const shop = resolveShopForEmbed(db, {
    tenant: req.query.tenant || req.query.tenant_id,
    shop: req.query.shop || req.query.slug,
    host: requestHost(req),
  });
  if (!shop) return res.status(req.query.tenant || req.query.shop || req.query.slug ? 404 : 400).send('Quote shop is not configured.');
  if (!req.query.shop && !req.query.slug) {
    return res.redirect(302, quoteFlowUrlForShop(shop));
  }
  const settings = getEmbedSettingsForShop(db, shop.id);
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestorsForOrigins(parseEmbedAllowedOrigins(settings.embed_allowed_origins))};`);
  res.sendFile(join(ROOT_DIR, 'index.html'));
});

app.get([...publicRootPages], (req, res) => {
  const page = req.path.slice(1);
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
app.use('/api/billing', billingRouter);

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
  res.status(404).send('Not found');
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
