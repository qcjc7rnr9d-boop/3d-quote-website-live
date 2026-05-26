import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/customers/
router.get('/', requireShopAuth, (req, res) => {
  try {
    const shopId = req.shop.id;
    const { search, sort } = req.query;

    let query = `
      SELECT
        c.id, c.shop_id, c.email, c.name, c.notes, c.created_at,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.total), 0) as total_spent,
        MAX(o.created_at) as last_order
      FROM customers c
      LEFT JOIN orders o
        ON o.shop_id = c.shop_id AND LOWER(o.customer_email) = LOWER(c.email)
      WHERE c.shop_id = ?
    `;
    const params = [shopId];

    if (search) {
      query += ' AND (LOWER(c.name) LIKE ? OR LOWER(c.email) LIKE ?)';
      const like = `%${search.toLowerCase()}%`;
      params.push(like, like);
    }

    query += ' GROUP BY c.id';

    if (sort === 'most_orders') {
      query += ' ORDER BY order_count DESC';
    } else if (sort === 'highest_spend') {
      query += ' ORDER BY total_spent DESC';
    } else {
      query += ' ORDER BY c.created_at DESC';
    }

    const customers = db.prepare(query).all(...params);
    res.json(customers);
  } catch (err) {
    console.error('List customers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/customers/:id
router.get('/:id', requireShopAuth, (req, res) => {
  try {
    const customer = db.prepare(
      'SELECT * FROM customers WHERE id = ? AND shop_id = ?'
    ).get(req.params.id, req.shop.id);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const orders = db.prepare(
      `SELECT id, created_at, total, fulfilment_status, payment_status, material_id
       FROM orders
       WHERE shop_id = ? AND LOWER(customer_email) = LOWER(?)
       ORDER BY created_at DESC
       LIMIT 10`
    ).all(req.shop.id, customer.email);

    res.json({ ...customer, orders });
  } catch (err) {
    console.error('Get customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/customers/:id  — update notes only
router.patch('/:id', requireShopAuth, (req, res) => {
  try {
    const { notes } = req.body;
    const customer = db.prepare(
      'SELECT * FROM customers WHERE id = ? AND shop_id = ?'
    ).get(req.params.id, req.shop.id);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    db.prepare('UPDATE customers SET notes = ? WHERE id = ? AND shop_id = ?')
      .run(notes ?? null, req.params.id, req.shop.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Update customer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
