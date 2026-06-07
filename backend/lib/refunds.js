import {
  markCheckoutLedgerStatus,
  reconcileCheckoutApplicationFeeFromIntent,
} from './billing-service.js';
import { updateOrderRefundState } from './security-hardening.js';

const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

function addColumnIfMissing(db, table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export function ensureRefundSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      stripe_refund_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_refunds_order
      ON order_refunds(order_id, created_at);
  `);
  addColumnIfMissing(db, 'order_refunds', 'idempotency_key', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refunds_idempotency_key
      ON order_refunds(idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `);
}

export function cents(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

export function paidAmountCents(order) {
  return cents(order?.customer_total_cents) || Math.round(Number(order?.total || 0) * 100);
}

export function refundableCents(order) {
  return Math.max(0, paidAmountCents(order) - cents(order?.refunded_cents));
}

function refundError(code, message, status = 400, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function parsePositiveMinorUnits(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return null;
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (key.length < 8 || key.length > 160) {
    throw refundError(
      'REFUND_IDEMPOTENCY_KEY_REQUIRED',
      'Refund request is missing a valid idempotency key.',
    );
  }
  return key;
}

function normalizeRefundInput(order, body = {}) {
  const remainingCents = refundableCents(order);
  const paidCents = paidAmountCents(order);
  const alreadyRefundedCents = cents(order.refunded_cents);
  if (remainingCents <= 0) {
    throw refundError('ALREADY_REFUNDED', 'This order has already been fully refunded.');
  }

  const refundType = body.refund_type === 'partial' ? 'partial' : 'remaining';
  let amountCents = remainingCents;
  if (refundType === 'partial') {
    amountCents = parsePositiveMinorUnits(body.amount_cents);
    if (amountCents == null) {
      throw refundError('REFUND_AMOUNT_REQUIRED', 'Partial refund amount is required.');
    }
  } else if (body.amount_cents != null && body.amount_cents !== '') {
    amountCents = parsePositiveMinorUnits(body.amount_cents);
    if (amountCents == null) {
      throw refundError('REFUND_AMOUNT_INVALID', 'Refund amount must be a whole number of cents.');
    }
  }

  if (amountCents <= 0) {
    throw refundError('REFUND_AMOUNT_INVALID', 'Refund amount must be greater than zero.');
  }
  if (amountCents > remainingCents) {
    throw refundError(
      'REFUND_AMOUNT_EXCEEDS_REMAINING',
      'Refund amount cannot exceed the remaining refundable amount.',
      400,
      { remaining_cents: remainingCents },
    );
  }

  const stripeReason = String(body.stripe_reason || '').trim();
  return {
    refundType,
    amountCents,
    paidCents,
    alreadyRefundedCents,
    remainingCents,
    idempotencyKey: normalizeIdempotencyKey(body.idempotency_key),
    note: String(body.note || body.reason || '').trim().slice(0, 500) || null,
    stripeReason: STRIPE_REFUND_REASONS.has(stripeReason) ? stripeReason : null,
  };
}

function getExistingRefundByIdempotency(db, key) {
  if (!key) return null;
  return db.prepare(`
    SELECT *
    FROM order_refunds
    WHERE idempotency_key = ?
  `).get(key);
}

function recordRefund(db, {
  shopId,
  orderId,
  stripeRefundId,
  paymentIntentId,
  amountCents,
  status,
  note,
  raw,
  idempotencyKey = null,
}) {
  ensureRefundSchema(db);
  db.prepare(`
    INSERT INTO order_refunds (
      shop_id, order_id, stripe_refund_id, stripe_payment_intent_id,
      amount_cents, status, reason, raw_json, idempotency_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_refund_id) DO UPDATE SET
      status = excluded.status,
      raw_json = excluded.raw_json,
      idempotency_key = COALESCE(order_refunds.idempotency_key, excluded.idempotency_key),
      updated_at = datetime('now')
  `).run(
    shopId,
    orderId,
    stripeRefundId,
    paymentIntentId,
    cents(amountCents),
    status || 'pending',
    note || null,
    JSON.stringify(raw || {}),
    idempotencyKey || null,
  );
  return db.prepare('SELECT * FROM order_refunds WHERE stripe_refund_id = ?').get(stripeRefundId);
}

function orderPayload(order) {
  return {
    id: order.id,
    payment_status: order.payment_status,
    refunded_cents: order.refunded_cents,
  };
}

export async function createOrderRefund({ db, stripe, shop, orderId, body = {}, reconcileFees = true }) {
  ensureRefundSchema(db);
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND shop_id = ?')
    .get(orderId, shop.id);
  if (!order) {
    throw refundError('ORDER_NOT_FOUND', 'Order not found.', 404);
  }
  if (!order.stripe_payment_id) {
    throw refundError('NO_STRIPE_PAYMENT', 'This order does not have a Stripe payment to refund.');
  }
  if (!['paid', 'partially_refunded'].includes(order.payment_status)) {
    throw refundError('ORDER_NOT_REFUNDABLE', 'Only paid Stripe orders can be refunded.');
  }

  const normalized = normalizeRefundInput(order, body);
  const existing = getExistingRefundByIdempotency(db, normalized.idempotencyKey);
  if (existing) {
    if (Number(existing.order_id) !== Number(order.id) || Number(existing.shop_id) !== Number(shop.id)) {
      throw refundError(
        'REFUND_IDEMPOTENCY_KEY_USED',
        'This refund idempotency key has already been used.',
        409,
      );
    }
    const existingOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(existing.order_id);
    return {
      ok: true,
      duplicate: true,
      refund: {
        id: existing.stripe_refund_id,
        amount_cents: existing.amount_cents,
        status: existing.status,
      },
      order: orderPayload(existingOrder),
    };
  }

  if (!stripe?.refunds?.create) {
    throw refundError('STRIPE_NOT_CONFIGURED', 'Stripe is not configured on this server.', 500);
  }

  const refundParams = {
    payment_intent: order.stripe_payment_id,
    amount: normalized.amountCents,
    refund_application_fee: true,
    reverse_transfer: true,
    metadata: {
      orderId: String(order.id),
      shopId: String(shop.id),
      shopSlug: shop.slug || '',
      refundType: normalized.refundType,
    },
  };
  if (normalized.stripeReason) refundParams.reason = normalized.stripeReason;

  const refund = await stripe.refunds.create(refundParams, {
    idempotencyKey: `order-${order.id}-refund-${normalized.idempotencyKey}`,
  });

  recordRefund(db, {
    shopId: shop.id,
    orderId: order.id,
    stripeRefundId: refund.id,
    paymentIntentId: order.stripe_payment_id,
    amountCents: normalized.amountCents,
    status: refund.status || 'pending',
    note: normalized.note,
    raw: refund,
    idempotencyKey: normalized.idempotencyKey,
  });

  const updatedOrder = refund.status === 'failed'
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)
    : updateOrderRefundState(db, { orderId: order.id, amountCents: normalized.amountCents });
  if (reconcileFees) {
    await reconcileCheckoutApplicationFeeFromIntent(db, stripe, order.stripe_payment_id);
  }
  if (updatedOrder?.payment_status) {
    markCheckoutLedgerStatus(db, order.id, updatedOrder.payment_status === 'refunded' ? 'refunded' : 'partially_refunded');
  }

  return {
    ok: true,
    duplicate: false,
    refund: {
      id: refund.id,
      amount_cents: normalized.amountCents,
      status: refund.status,
    },
    order: orderPayload(updatedOrder),
  };
}

function resolveRefundOrder(db, refund) {
  const paymentIntentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id;
  let order = paymentIntentId
    ? db.prepare('SELECT * FROM orders WHERE stripe_payment_id = ?').get(paymentIntentId)
    : null;
  if (!order && refund.metadata?.orderId) {
    const shopId = refund.metadata?.shopId ? Number(refund.metadata.shopId) : null;
    order = shopId
      ? db.prepare('SELECT * FROM orders WHERE id = ? AND shop_id = ?').get(refund.metadata.orderId, shopId)
      : db.prepare('SELECT * FROM orders WHERE id = ?').get(refund.metadata.orderId);
  }
  return { order, paymentIntentId: paymentIntentId || order?.stripe_payment_id || null };
}

export async function syncRefundFromStripeRefund({ db, stripe, refund, reconcileFees = true }) {
  ensureRefundSchema(db);
  const { order, paymentIntentId } = resolveRefundOrder(db, refund);
  if (!order) return null;

  recordRefund(db, {
    shopId: order.shop_id,
    orderId: order.id,
    stripeRefundId: refund.id,
    paymentIntentId,
    amountCents: refund.amount,
    status: refund.status || 'pending',
    note: refund.reason || refund.failure_reason || null,
    raw: refund,
    idempotencyKey: refund.metadata?.idempotencyKey || null,
  });

  const totalRefunded = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS refunded_cents
    FROM order_refunds
    WHERE order_id = ?
      AND status NOT IN ('failed', 'canceled')
  `).get(order.id)?.refunded_cents || 0;

  const updatedOrder = updateOrderRefundState(db, {
    orderId: order.id,
    refundedCents: totalRefunded,
  });
  if (reconcileFees && stripe && paymentIntentId) {
    await reconcileCheckoutApplicationFeeFromIntent(db, stripe, paymentIntentId);
  }
  if (updatedOrder?.payment_status) {
    const ledgerStatus = updatedOrder.payment_status === 'refunded'
      ? 'refunded'
      : updatedOrder.payment_status === 'partially_refunded'
        ? 'partially_refunded'
        : 'charged';
    markCheckoutLedgerStatus(db, order.id, ledgerStatus);
  }
  return updatedOrder;
}

export async function syncRefundFromCharge({ db, stripe, charge, reconcileFees = true }) {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;
  const order = paymentIntentId
    ? db.prepare('SELECT * FROM orders WHERE stripe_payment_id = ?').get(paymentIntentId)
    : null;
  if (!order) return null;

  const updatedOrder = updateOrderRefundState(db, {
    orderId: order.id,
    refundedCents: charge.amount_refunded || 0,
    status: charge.refunded ? 'refunded' : 'partially_refunded',
  });
  if (reconcileFees && stripe && paymentIntentId) {
    await reconcileCheckoutApplicationFeeFromIntent(db, stripe, paymentIntentId);
  }
  markCheckoutLedgerStatus(db, order.id, charge.refunded ? 'refunded' : 'partially_refunded');
  return updatedOrder;
}
