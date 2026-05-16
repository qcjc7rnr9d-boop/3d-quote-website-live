import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'crypto';
import { db } from '../middleware/auth.js';
import { UPLOAD_MAX_MB } from '../config.js';
import { normaliseCart, validateCartForShop } from '../lib/cart.js';
import {
  buildShopifyDraftOrderInput,
  createShopifyDraftOrder,
  normaliseShopifyDomain,
} from '../lib/shopify-draft-order.js';
import {
  verifyShopifyAppProxySignature,
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
} from '../lib/shopify-auth.js';
import {
  ensureShopifyTables,
  findShopForShopifyDomain,
  findShopifySession,
  markShopifyUninstalled,
  recordShopifyQuoteSession,
  recordShopifyWebhookEvent,
  updateQuoteSessionDraftOrder,
  updateQuoteSessionPaidOrder,
  upsertShopifyInstallation,
} from '../lib/shopify-installation.js';
import {
  shopifyFileStorageStatus,
  storeShopifyQuoteFile,
} from '../lib/shopify-file-storage.js';

const router = Router();
export const shopifyProxyRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: UPLOAD_MAX_MB * 1024 * 1024,
    files: 20,
  },
});

const draftOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many Shopify checkout attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function shopifySecret() {
  return process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_SECRET || '';
}

function shopifyApiKey() {
  return process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID || '';
}

function shopifyScopes() {
  return (process.env.SHOPIFY_SCOPES || 'write_draft_orders,read_draft_orders,read_orders,write_app_proxy')
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean)
    .join(',');
}

function appBaseUrl(req) {
  return (process.env.SHOPIFY_APP_URL || process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function publicBaseUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function newToken() {
  return randomBytes(24).toString('base64url');
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function domainCandidate(req) {
  const explicit = firstValue(req.body?.shopDomain, req.body?.shopifyShopDomain, req.query?.shopDomain, req.query?.shopify_shop_domain);
  if (explicit) return explicit;
  const shop = firstValue(req.body?.shop, req.query?.shop);
  if (shop && String(shop).includes('.myshopify.com')) return shop;
  return null;
}

function slugCandidate(req) {
  const explicit = firstValue(req.body?.shopSlug, req.query?.shopSlug);
  if (explicit) return explicit;
  const shop = firstValue(req.body?.shop, req.query?.shop);
  if (shop && !String(shop).includes('.myshopify.com')) return shop;
  return null;
}

function resolveShop(req) {
  ensureShopifyTables(db);
  const domainRaw = domainCandidate(req);
  let shopDomain = null;
  let shop = null;

  if (domainRaw) {
    shopDomain = normaliseShopifyDomain(domainRaw);
    shop = findShopForShopifyDomain(db, shopDomain);
  }

  const slug = slugCandidate(req);
  if (!shop && slug) {
    shop = db.prepare("SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'").get(String(slug).trim());
    shopDomain = shopDomain || shop?.shopify_shop_domain || null;
  }

  if (!shop) {
    const err = new Error('Shop not found or Shopify app is not installed for this shop.');
    err.status = 404;
    throw err;
  }
  return { shop, shopDomain };
}

function validatedCartForRequest(req, shop) {
  const input = req.body?.cart || req.body?.orderData || {
    shopSlug: shop.slug,
    items: req.body?.items,
    ...req.body,
  };
  return validateCartForShop(db, shop, normaliseCart({
    ...input,
    shopSlug: shop.slug,
    items: Array.isArray(input?.items) && input.items.length ? input.items : null,
  }, shop.slug));
}

function quoteSessionFiles(token) {
  if (!token) return [];
  const row = db.prepare('SELECT file_metadata FROM shopify_quote_sessions WHERE token = ?').get(token);
  return parseJson(row?.file_metadata, []);
}

async function quotePreviewHandler(req, res) {
  try {
    const { shop, shopDomain } = resolveShop(req);
    const cart = validatedCartForRequest(req, shop);
    const token = req.body?.quoteSessionToken || req.body?.token || newToken();
    recordShopifyQuoteSession(db, {
      token,
      shop,
      shopDomain: shopDomain || `${shop.slug}.myshopify.com`,
      cart,
      quote: { cart },
      status: 'quoted',
    });
    res.json({ ok: true, token, cart, quote: { cart } });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not preview Shopify quote.' });
  }
}

async function modelFilesHandler(req, res) {
  try {
    const { shop, shopDomain } = resolveShop(req);
    const token = req.body?.quoteSessionToken || req.body?.token || newToken();
    const files = [];
    for (const file of req.files || []) {
      files.push(await storeShopifyQuoteFile(file, { shopId: shop.id, token }));
    }
    recordShopifyQuoteSession(db, {
      token,
      shop,
      shopDomain: shopDomain || `${shop.slug}.myshopify.com`,
      files,
      status: 'files_uploaded',
    });
    res.status(201).json({ ok: true, token, files, storage: shopifyFileStorageStatus() });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || 'Could not upload Shopify quote files.' });
  }
}

async function draftOrderHandler(req, res) {
  try {
    const { shop, shopDomain } = resolveShop(req);
    if (!shopDomain) {
      return res.status(409).json({ error: 'This shop is not linked to a Shopify installation yet.' });
    }
    const session = findShopifySession(db, shopDomain);
    if (!session && process.env.SHOPIFY_DRAFT_ORDER_DRY_RUN !== '1') {
      return res.status(409).json({ error: 'Shopify access token not found. Reinstall or reconnect the Shopify app.' });
    }

    const customerEmail = String(req.body?.customerEmail || req.body?.email || '').trim().toLowerCase();
    const customerName = String(req.body?.customerName || req.body?.name || '').trim();
    if (!isEmail(customerEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const cart = validatedCartForRequest(req, shop);
    const token = req.body?.quoteSessionToken || req.body?.token || newToken();
    const files = Array.isArray(req.body?.files) ? req.body.files : quoteSessionFiles(token);
    const quoteSession = { token, files };
    const input = buildShopifyDraftOrderInput({
      cart,
      customer: { email: customerEmail, name: customerName },
      shop,
      quoteSession,
    });

    recordShopifyQuoteSession(db, {
      token,
      shop,
      shopDomain,
      customerEmail,
      customerName,
      files,
      cart,
      quote: { cart },
      status: 'checkout_started',
    });

    if (process.env.SHOPIFY_DRAFT_ORDER_DRY_RUN === '1') {
      return res.json({ ok: true, dryRun: true, token, draftOrderInput: input });
    }

    const draftOrder = await createShopifyDraftOrder({
      shopDomain,
      accessToken: session.access_token,
      input,
    });
    updateQuoteSessionDraftOrder(db, token, draftOrder);
    res.json({
      ok: true,
      token,
      draftOrderId: draftOrder.id,
      draftOrderName: draftOrder.name,
      invoiceUrl: draftOrder.invoiceUrl,
    });
  } catch (err) {
    console.error('Shopify draft order error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Could not create Shopify draft order.' });
  }
}

router.get('/auth', (req, res) => {
  try {
    const apiKey = shopifyApiKey();
    const secret = shopifySecret();
    if (!apiKey || !secret) return res.status(503).json({ error: 'SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required.' });
    const shopDomain = normaliseShopifyDomain(req.query.shop);
    const state = newToken();
    req.session.shopifyOAuthState = state;
    const redirectUri = `${appBaseUrl(req)}/api/shopify/auth/callback`;
    const url = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    url.searchParams.set('client_id', apiKey);
    url.searchParams.set('scope', shopifyScopes());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not start Shopify OAuth.' });
  }
});

router.get('/auth/callback', async (req, res) => {
  try {
    const apiKey = shopifyApiKey();
    const secret = shopifySecret();
    if (!apiKey || !secret) return res.status(503).send('SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required.');
    if (!verifyShopifyOAuthHmac(req.query, secret)) return res.status(401).send('Invalid Shopify OAuth HMAC.');
    if (!req.query.state || req.query.state !== req.session.shopifyOAuthState) return res.status(401).send('Invalid Shopify OAuth state.');

    const shopDomain = normaliseShopifyDomain(req.query.shop);
    const tokenRes = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: secret,
        code: req.query.code,
      }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Shopify did not return an access token.');
    }
    const shop = upsertShopifyInstallation(db, {
      shopDomain,
      accessToken: tokenData.access_token,
      scope: tokenData.scope || shopifyScopes(),
    });
    req.session.shopId = shop.id;
    req.session.shopifyOAuthState = null;
    res.redirect(`/app?shop=${encodeURIComponent(shopDomain)}`);
  } catch (err) {
    res.status(400).send(err.message || 'Could not finish Shopify OAuth.');
  }
});

router.get('/admin/status', (req, res) => {
  try {
    const { shop, shopDomain } = resolveShop(req);
    const session = shopDomain ? findShopifySession(db, shopDomain) : null;
    res.json({
      ok: true,
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        shopifyShopDomain: shopDomain,
      },
      installed: !!session,
      hasAccessToken: !!session?.access_token,
      scopes: session?.scope || shopifyScopes(),
      appProxyPath: '/apps/3d-quote',
      themeBlock: 'Instant 3D Quote',
      detailedAdminUrl: `/admin/dashboard.html?shop=${encodeURIComponent(shop.slug)}`,
      storage: shopifyFileStorageStatus(),
    });
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message || 'Shopify app status unavailable.' });
  }
});

router.post('/model-files', upload.array('files', 20), modelFilesHandler);
router.post('/quote-preview', quotePreviewHandler);
router.post('/draft-order', draftOrderLimiter, draftOrderHandler);

function proxyAllowedUnsigned() {
  return process.env.NODE_ENV !== 'production' && process.env.SHOPIFY_ALLOW_UNSIGNED_PROXY === '1';
}

function requireProxySignature(req, res, next) {
  const secret = shopifySecret();
  if (proxyAllowedUnsigned()) return next();
  if (!secret) return res.status(503).send('SHOPIFY_API_SECRET is required for app proxy verification.');
  if (!verifyShopifyAppProxySignature(req.query, secret)) {
    return res.status(401).send('Invalid Shopify app proxy signature.');
  }
  next();
}

function shopSlugForProxy(req) {
  const domain = req.query.shop ? normaliseShopifyDomain(req.query.shop) : null;
  const shop = domain ? findShopForShopifyDomain(db, domain) : null;
  return shop?.slug || domain?.replace(/\.myshopify\.com$/, '') || req.query.shopSlug || 'mahi3d';
}

shopifyProxyRouter.use(requireProxySignature);
shopifyProxyRouter.get('/', (req, res) => {
  const shopDomain = req.query.shop ? normaliseShopifyDomain(req.query.shop) : '';
  const shopSlug = shopSlugForProxy(req);
  const quoteUrl = `${publicBaseUrl(req)}/quote.html?shop=${encodeURIComponent(shopSlug)}&checkout=shopify&shopify_shop=${encodeURIComponent(shopDomain)}`;
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Instant 3D Quote</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; color: #17211d; background: #f7f9f5; }
    .wrap { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(23,33,29,.12); border-radius: 8px; background: #fff; }
    h2 { margin: 0; font-size: 22px; line-height: 1.15; }
    p { margin: 0; color: #526159; line-height: 1.45; }
    a { width: fit-content; display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 16px; border-radius: 6px; background: #315f46; color: #fff; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main class="wrap">
    <h2>Instant 3D quote</h2>
    <p>Upload STL or OBJ files, choose material and finish, then continue through Shopify checkout.</p>
    <a href="${quoteUrl}" target="_top" rel="noopener">Start quote</a>
  </main>
</body>
</html>`);
});
shopifyProxyRouter.post('/api/model-files', upload.array('files', 20), modelFilesHandler);
shopifyProxyRouter.post('/api/quote-preview', quotePreviewHandler);
shopifyProxyRouter.post('/api/draft-order', draftOrderLimiter, draftOrderHandler);

export function shopifyEmbeddedAdminPage(req, res) {
  const shopParam = String(req.query.shop || '').trim();
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trennen 3D Quote for Shopify</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17211d; background: #f5f7f3; }
    main { max-width: 960px; margin: 0 auto; padding: 28px; display: grid; gap: 18px; }
    section { background: #fff; border: 1px solid rgba(23,33,29,.1); border-radius: 8px; padding: 18px; }
    h1, h2, p { margin-top: 0; }
    code { background: #edf2eb; padding: 2px 5px; border-radius: 4px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .pill { display: inline-flex; width: fit-content; padding: 5px 9px; border-radius: 999px; background: #edf2eb; font-weight: 700; }
    a { color: #315f46; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <section>
      <span class="pill">Shopify custom app</span>
      <h1>Trennen 3D Quote</h1>
      <p>Use this page to confirm the app install, app proxy, theme block, and file storage status.</p>
    </section>
    <section>
      <h2>Status</h2>
      <div class="grid" id="statusGrid"><p>Loading...</p></div>
    </section>
    <section>
      <h2>Theme setup</h2>
      <p>Add the <strong>Instant 3D Quote</strong> app block in the Shopify theme editor. The block points customers to <code>/apps/3d-quote</code>.</p>
      <p><a href="/admin/dashboard.html" id="adminLink">Open detailed Trennen admin</a></p>
    </section>
  </main>
  <script>
    const shop = ${JSON.stringify(shopParam)};
    const statusGrid = document.getElementById('statusGrid');
    const adminLink = document.getElementById('adminLink');
    fetch('/api/shopify/admin/status?shop=' + encodeURIComponent(shop), { cache: 'no-store' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Status unavailable');
        adminLink.href = data.detailedAdminUrl;
        const rows = [
          ['Installed', data.installed ? 'Yes' : 'No'],
          ['Access token', data.hasAccessToken ? 'Stored' : 'Missing'],
          ['App proxy', data.appProxyPath],
          ['Theme block', data.themeBlock],
          ['File storage', data.storage.productionReady ? 'S3 ready' : 'Local dev storage'],
          ['Scopes', data.scopes],
        ];
        statusGrid.innerHTML = rows.map(([label, value]) => '<div><strong>' + label + '</strong><p>' + value + '</p></div>').join('');
      })
      .catch(err => { statusGrid.innerHTML = '<p>' + err.message + '</p>'; });
  </script>
</body>
</html>`);
}

export function shopifyWebhookHandler(req, res) {
  const secret = shopifySecret();
  const topic = req.get('x-shopify-topic') || '';
  const shopDomain = req.get('x-shopify-shop-domain') || '';
  const supplied = req.get('x-shopify-hmac-sha256') || '';
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

  if (!secret) return res.status(503).json({ error: 'SHOPIFY_API_SECRET is required for webhooks.' });
  if (!verifyShopifyWebhookHmac(rawBody, supplied, secret)) {
    return res.status(401).json({ error: 'Invalid Shopify webhook HMAC.' });
  }

  try {
    const payload = JSON.parse(rawBody.toString('utf8') || '{}');
    recordShopifyWebhookEvent(db, { shopDomain, topic, payload });
    if (topic === 'app/uninstalled') {
      markShopifyUninstalled(db, shopDomain);
    }
    if (topic === 'orders/paid' || topic === 'orders/create') {
      const draftOrderId = payload.draft_order_id ? `gid://shopify/DraftOrder/${payload.draft_order_id}` : null;
      const orderId = payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
      updateQuoteSessionPaidOrder(db, { draftOrderId, orderId });
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Shopify webhook error:', err);
    res.status(500).json({ error: 'Shopify webhook failed.' });
  }
}

export default router;
