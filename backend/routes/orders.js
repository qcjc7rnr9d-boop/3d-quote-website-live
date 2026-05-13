import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate } from '../lib/email-templates/index.js';

const STATUS_LABELS = {
  pending:       'Order Received',
  processing:    'Order Confirmed',
  in_production: 'In Production',
  shipped:       'Shipped',
  complete:      'Delivered',
  cancelled:     'Cancelled'
};

const router = Router();

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
  notes = null
}) {
  const result = db.prepare(`
    INSERT INTO orders
      (shop_id, customer_email, customer_name, file_name, material_id,
       colour, finish, quantity, subtotal, tax, shipping, total,
       stripe_payment_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    notes
  );
  return result;
}

// GET /api/orders/public/:id  (public — used by the customer confirmation page)
// Returns just enough data for the customer to see their order was placed,
// without exposing other shops' details. Confirmation page fetches this
// immediately after Stripe redirects the customer back.
router.get('/public/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.id, o.customer_email, o.customer_name, o.file_name,
           o.colour, o.finish, o.quantity, o.subtotal, o.shipping, o.tax, o.total,
           o.payment_status, o.fulfilment_status, o.created_at,
           m.name AS material_name, s.name AS shop_name, s.slug AS shop_slug
    FROM orders o
    LEFT JOIN materials m ON m.id = o.material_id
    LEFT JOIN shops s     ON s.id = o.shop_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  res.json(row);
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
    `SELECT o.*, m.name as material_name
     FROM orders o
     LEFT JOIN materials m ON m.id = o.material_id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({
    orders,
    total,
    page,
    pages: Math.ceil(total / limit)
  });
});

// GET /api/orders/:id
router.get('/:id', requireShopAuth, (req, res) => {
  const order = db.prepare(
    `SELECT o.*, m.name as material_name
     FROM orders o
     LEFT JOIN materials m ON m.id = o.material_id
     WHERE o.id = ? AND o.shop_id = ?`
  ).get(req.params.id, req.shop.id);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json(order);
});

// PATCH /api/orders/:id
router.patch('/:id', requireShopAuth, async (req, res) => {
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

  db.prepare(`
    UPDATE orders SET
      fulfilment_status = ?,
      notes             = ?,
      tracking_number   = ?,
      tracking_url      = ?,
      customer_message  = ?
    WHERE id = ? AND shop_id = ?
  `).run(
    fulfilment_status, notes,
    tracking_number || null,
    tracking_url    || null,
    customer_message || null,
    req.params.id, req.shop.id
  );

  // Send customer email notification if requested
  if (notify_customer && existing.customer_email) {
    try {
      const shop = db.prepare('SELECT id, name FROM shops WHERE id = ?').get(req.shop.id);
      const order = {
        ...existing,
        fulfilment_status,
        tracking_number,
        tracking_url,
      };
      const tpl = renderTemplate('order_status', { shop, order, customer_message });
      const result = await sendMail({
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

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(updated);
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
