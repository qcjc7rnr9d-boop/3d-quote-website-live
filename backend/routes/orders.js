import { Router } from 'express';
import { randomBytes } from 'crypto';
import { db, requireShopAuth } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate } from '../lib/email-templates/index.js';
import { attachOrderFiles, attachOrderFilesList, saveOrderFiles, saveOrderItems } from '../lib/order-files.js';

const STATUS_LABELS = {
  pending:       'Order Received',
  processing:    'Order Confirmed',
  in_production: 'In Production',
  shipped:       'Shipped',
  complete:      'Delivered',
  cancelled:     'Cancelled'
};
const ALLOWED_STATUSES = new Set(Object.keys(STATUS_LABELS));

const router = Router();

const ADMIN_ORDER_FIELDS = `
  o.id, o.shop_id, o.customer_email, o.customer_name, o.file_name,
  o.material_id, o.colour, o.finish, o.quantity,
  o.subtotal, o.tax, o.shipping, o.total,
  o.stripe_payment_id,
  o.payment_processing_fee_cents, o.checkout_platform_fee_cents, o.customer_total_cents,
  o.payment_status, o.fulfilment_status,
  o.notes, o.tracking_number, o.tracking_url, o.customer_message,
  o.created_at,
  m.name as material_name, m.name as material
`;

function getAdminOrder(orderId, shopId) {
  return db.prepare(`
    SELECT ${ADMIN_ORDER_FIELDS}
    FROM orders o
    LEFT JOIN materials m ON m.id = o.material_id
    WHERE o.id = ? AND o.shop_id = ?
  `).get(orderId, shopId);
}

function ensureOrderPublicTokenColumn() {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('public_token')) {
    db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
  }
  if (!cols.includes('payment_processing_fee_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN payment_processing_fee_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('checkout_platform_fee_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN checkout_platform_fee_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('customer_total_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN customer_total_cents INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token
      ON orders(public_token)
      WHERE public_token IS NOT NULL
  `);
}

function newPublicOrderToken() {
  return randomBytes(24).toString('base64url');
}

function publicOrderResponse(order) {
  const attached = attachOrderFiles(db, order);
  return {
    ...attached,
    items: (attached.items || []).map(({ quoteSnapshot, ...item }) => item),
  };
}

function normaliseOptionalText(value, maxLength, label) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maxLength) {
    const err = new Error(`${label} is too long.`);
    err.status = 400;
    throw err;
  }
  return text;
}

function normaliseTrackingUrl(value) {
  const text = normaliseOptionalText(value, 500, 'Tracking URL');
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    return url.href;
  } catch {
    const err = new Error('Tracking URL must start with http:// or https://.');
    err.status = 400;
    throw err;
  }
}

// Export createOrder for use by the stripe webhook handler
export function createOrder({
  shopId,
  customerEmail,
  customerName,
  fileName = null,
  materialId = null,
  colour = null,
  finish = null,
  quantity = 1,
  subtotal = 0,
  tax = 0,
  shipping = 0,
  total = 0,
  stripePaymentId = null,
  notes = null,
  files = [],
  items = []
}) {
  ensureOrderPublicTokenColumn();
  const publicToken = newPublicOrderToken();
  const result = db.prepare(`
    INSERT INTO orders
      (shop_id, customer_email, customer_name, file_name, material_id,
       colour, finish, quantity, subtotal, tax, shipping, total,
       stripe_payment_id, notes, public_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    shopId,
    customerEmail,
    customerName,
    fileName,
    materialId,
    colour,
    finish,
    quantity,
    subtotal,
    tax,
    shipping,
    total,
    stripePaymentId,
    notes,
    publicToken
  );
  if (items?.length) saveOrderItems(db, result.lastInsertRowid, items);
  else if (files?.length) saveOrderFiles(db, result.lastInsertRowid, files);
  return { ...result, publicToken };
}

// GET /api/orders/public/:id  (public — used by the customer confirmation page)
// Returns just enough data for the customer to see their order was placed,
// without exposing other shops' details. Confirmation page fetches this
// immediately after Stripe redirects the customer back.
router.get('/public/:id', (req, res) => {
  ensureOrderPublicTokenColumn();
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Confirmation token required' });
  const row = db.prepare(`
    SELECT o.id, o.file_name,
           o.colour, o.finish, o.quantity, o.subtotal, o.shipping, o.tax, o.total,
           o.payment_processing_fee_cents, o.checkout_platform_fee_cents, o.customer_total_cents,
           o.payment_status, o.fulfilment_status, o.created_at,
           m.name AS material_name, m.name AS material,
           s.name AS shop_name, s.slug AS shop_slug
    FROM orders o
    LEFT JOIN materials m ON m.id = o.material_id
    LEFT JOIN shops s     ON s.id = o.shop_id
    WHERE o.id = ? AND o.public_token = ?
  `).get(req.params.id, token);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(publicOrderResponse(row));
});

// GET /api/orders/
router.get('/', requireShopAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  const { status, search, from, to } = req.query;

  const conditions = ['o.shop_id = ?'];
  const params = [req.shop.id];

  if (status) {
    conditions.push('o.fulfilment_status = ?');
    params.push(status);
  }

  if (search) {
    conditions.push('(LOWER(o.customer_email) LIKE ? OR LOWER(o.customer_name) LIKE ?)');
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term);
  }

  if (from) {
    conditions.push('o.created_at >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('o.created_at <= ?');
    params.push(to);
  }

  const where = 'WHERE ' + conditions.join(' AND ');

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM orders o ${where}`).get(...params);
  const total = totalRow.c;

  const orders = db.prepare(
    `SELECT ${ADMIN_ORDER_FIELDS}
     FROM orders o
     LEFT JOIN materials m ON m.id = o.material_id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({
    orders: attachOrderFilesList(db, orders),
    total,
    page,
    pages: Math.ceil(total / limit)
  });
});

// GET /api/orders/:id
router.get('/:id', requireShopAuth, (req, res) => {
  const order = getAdminOrder(req.params.id, req.shop.id);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json(attachOrderFiles(db, order));
});

// PATCH /api/orders/:id
router.patch('/:id', requireShopAuth, async (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM orders WHERE id = ? AND shop_id = ?')
      .get(req.params.id, req.shop.id);

    if (!existing) return res.status(404).json({ error: 'Order not found' });

    const {
      fulfilment_status = existing.fulfilment_status,
      notes = existing.notes,
      tracking_number = existing.tracking_number,
      tracking_url    = existing.tracking_url,
      customer_message = existing.customer_message,
      notify_customer = false
    } = req.body;

    if (!ALLOWED_STATUSES.has(fulfilment_status)) {
      return res.status(400).json({ error: 'Invalid fulfilment status.' });
    }

    const safeNotes = normaliseOptionalText(notes, 4000, 'Internal notes');
    const safeTrackingNumber = normaliseOptionalText(tracking_number, 160, 'Tracking number');
    const safeTrackingUrl = normaliseTrackingUrl(tracking_url);
    const safeCustomerMessage = normaliseOptionalText(customer_message, 2000, 'Customer message');

    db.prepare(`
      UPDATE orders SET
        fulfilment_status = ?,
        notes             = ?,
        tracking_number   = ?,
        tracking_url      = ?,
        customer_message  = ?
      WHERE id = ? AND shop_id = ?
    `).run(
      fulfilment_status, safeNotes,
      safeTrackingNumber,
      safeTrackingUrl,
      safeCustomerMessage,
      req.params.id, req.shop.id
    );

    // Send customer email notification if requested
    if (notify_customer && existing.customer_email) {
      try {
        const shop = db.prepare('SELECT id, name, slug, email FROM shops WHERE id = ?').get(req.shop.id);
        const order = {
          ...existing,
          fulfilment_status,
          tracking_number: safeTrackingNumber,
          tracking_url: safeTrackingUrl,
        };
        const tpl = renderTemplate('order_status', { shop, order, customer_message: safeCustomerMessage });
        const result = await sendMail({
          shopId:  req.shop.id,
          shopSlug: req.shop.slug,
          templateId: tpl.templateId,
          category: tpl.category,
          idempotencyKey: `order-status-${req.params.id}-${fulfilment_status}-${Date.now()}`,
          to:      existing.customer_email,
          from:    tpl.from,        // <slug>-orders@... or <slug>-shipping@... when shipped
          replyTo: tpl.replyTo,
          subject: tpl.subject,
          text:    tpl.text,
          html:    tpl.html,
        });
        if (result.previewUrl) console.log(`📬 Order update email: ${result.previewUrl}`);
      } catch (err) {
        console.error('Failed to send customer email:', err.message);
        // Don't fail the request — order is already updated
      }
    }

    const updated = getAdminOrder(req.params.id, req.shop.id);
    res.json(attachOrderFiles(db, updated));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Order update error:', err);
    res.status(500).json({ error: 'Failed to update order.' });
  }
});

// DELETE /api/orders/:id — soft cancel
router.delete('/:id', requireShopAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ? AND shop_id = ?')
    .get(req.params.id, req.shop.id);

  if (!existing) {
    return res.status(404).json({ error: 'Order not found' });
  }

  db.prepare(
    "UPDATE orders SET fulfilment_status = 'cancelled' WHERE id = ? AND shop_id = ?"
  ).run(req.params.id, req.shop.id);

  res.json({ ok: true });
});

export default router;
