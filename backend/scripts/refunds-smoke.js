import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createOrderRefund,
  ensureRefundSchema,
  syncRefundFromStripeRefund,
} from '../lib/refunds.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE shops (
      id INTEGER PRIMARY KEY,
      slug TEXT
    );
    CREATE TABLE platform_admins (
      id INTEGER PRIMARY KEY
    );
    CREATE TABLE customer_accounts (
      id INTEGER PRIMARY KEY,
      shop_id INTEGER,
      email TEXT,
      created_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      shop_id INTEGER NOT NULL,
      total REAL NOT NULL DEFAULT 0,
      customer_total_cents INTEGER NOT NULL DEFAULT 0,
      refunded_cents INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      stripe_payment_id TEXT
    );
    CREATE TABLE checkout_fee_ledger (
      order_id INTEGER PRIMARY KEY,
      status TEXT,
      stripe_application_fee_id TEXT,
      stripe_application_fee_amount_cents INTEGER NOT NULL DEFAULT 0,
      stripe_application_fee_refunded_cents INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureRefundSchema(db);
  db.prepare('INSERT INTO shops (id, slug) VALUES (1, ?), (2, ?)').run('trennen', 'other-shop');
  return db;
}

function insertOrder(db, values = {}) {
  db.prepare(`
    INSERT INTO orders (
      id, shop_id, total, customer_total_cents, refunded_cents,
      payment_status, stripe_payment_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    values.id,
    values.shop_id ?? 1,
    values.total ?? 100,
    values.customer_total_cents ?? 10000,
    values.refunded_cents ?? 0,
    values.payment_status ?? 'paid',
    values.stripe_payment_id ?? `pi_test_${values.id}`,
  );
  db.prepare(`
    INSERT INTO checkout_fee_ledger (
      order_id, status, stripe_application_fee_amount_cents, stripe_application_fee_refunded_cents
    )
    VALUES (?, 'charged', 500, 0)
  `).run(values.id);
}

function fakeStripe() {
  const calls = [];
  return {
    calls,
    refunds: {
      async create(params, options) {
        calls.push({ params, options });
        return {
          id: `re_${calls.length}`,
          status: 'succeeded',
          amount: params.amount,
          payment_intent: params.payment_intent,
          metadata: params.metadata || {},
        };
      },
    },
    paymentIntents: {
      async retrieve() {
        return {
          latest_charge: {
            application_fee: {
              id: 'fee_test',
              amount: 500,
              amount_refunded: 125,
            },
          },
        };
      },
    },
  };
}

async function expectRejected(promise, expectedCode) {
  try {
    await promise;
  } catch (err) {
    assert(err.code === expectedCode, `Expected ${expectedCode}, got ${err.code || err.message}`);
    return err;
  }
  throw new Error(`Expected rejection with ${expectedCode}`);
}

try {
  const stripeRoutes = readFileSync('routes/stripe.js', 'utf8');
  const ordersAdmin = readFileSync('../admin/orders.html', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');

  assert(packageJson.includes('"refunds:smoke"'), 'package.json must expose refunds:smoke');
  assert(stripeRoutes.includes("router.post('/orders/:id/refund'"), 'Stripe refund route must remain available');
  assert(stripeRoutes.includes('createOrderRefund'), 'Stripe refund route must delegate to the shared refund helper');
  assert(stripeRoutes.includes('refund.created') && stripeRoutes.includes('refund.updated') && stripeRoutes.includes('refund.failed'), 'Stripe webhook must handle refund lifecycle events');
  assert(ordersAdmin.includes('refundPartialAmount'), 'Admin refund UI must expose a partial refund amount input');
  assert(ordersAdmin.includes('detRefundRemaining') && ordersAdmin.includes('detRefundPaid'), 'Admin refund UI must show paid and remaining refundable amounts');
  assert(ordersAdmin.includes('Partially refunded'), 'Admin order UI must display partially refunded status copy');

  const db = createDb();
  insertOrder(db, { id: 1 });
  insertOrder(db, { id: 2, refunded_cents: 2500, payment_status: 'partially_refunded' });
  db.prepare(`
    INSERT INTO order_refunds (
      shop_id, order_id, stripe_refund_id, stripe_payment_intent_id,
      amount_cents, status, raw_json, idempotency_key
    )
    VALUES (1, 2, 're_existing_partial', 'pi_test_2', 2500, 'succeeded', '{}', 'existing-partial')
  `).run();
  insertOrder(db, { id: 3, payment_status: 'pending', stripe_payment_id: 'pi_test_3' });
  insertOrder(db, { id: 4, shop_id: 2, stripe_payment_id: 'pi_test_4' });
  insertOrder(db, { id: 5, refunded_cents: 2500, payment_status: 'partially_refunded' });

  const stripe = fakeStripe();
  const shop = { id: 1, slug: 'trennen' };

  const partial = await createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 1,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 2500,
      idempotency_key: 'refund-partial-1',
      note: 'Customer requested partial refund',
    },
  });
  assert(partial.refund.amount_cents === 2500, 'partial refund must use requested amount in cents');
  assert(partial.order.refunded_cents === 2500, 'partial refund must update refunded cents');
  assert(partial.order.payment_status === 'partially_refunded', 'partial refund must mark order partially refunded');
  assert(stripe.calls[0].params.amount === 2500, 'Stripe refund amount must be exact minor units');
  assert(stripe.calls[0].params.refund_application_fee === true, 'partial refunds must refund application fee where possible');
  assert(stripe.calls[0].params.reverse_transfer === true, 'partial refunds must reverse transfers where possible');
  assert(stripe.calls[0].options.idempotencyKey.includes('refund-partial-1'), 'Stripe refund must use idempotency key');

  const duplicate = await createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 1,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 2500,
      idempotency_key: 'refund-partial-1',
    },
  });
  assert(duplicate.duplicate === true, 'duplicate idempotency key must return existing refund');
  assert(stripe.calls.length === 1, 'duplicate refund must not call Stripe again');
  assert(duplicate.order.refunded_cents === 2500, 'duplicate refund must not add refunded cents again');

  await expectRejected(createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 2,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 1000,
      idempotency_key: 'refund-partial-1',
    },
  }), 'REFUND_IDEMPOTENCY_KEY_USED');

  const remaining = await createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 5,
    reconcileFees: false,
    body: {
      refund_type: 'remaining',
      idempotency_key: 'refund-remaining-5',
    },
  });
  assert(remaining.refund.amount_cents === 7500, 'remaining refund must use remaining refundable balance');
  assert(remaining.order.refunded_cents === 10000, 'remaining refund after partial must finish refunded total');
  assert(remaining.order.payment_status === 'refunded', 'remaining refund after partial must mark fully refunded');

  await expectRejected(createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 2,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 8000,
      idempotency_key: 'refund-too-large',
    },
  }), 'REFUND_AMOUNT_EXCEEDS_REMAINING');

  await expectRejected(createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 3,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 1000,
      idempotency_key: 'refund-unpaid',
    },
  }), 'ORDER_NOT_REFUNDABLE');

  await expectRejected(createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 4,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      amount_cents: 1000,
      idempotency_key: 'refund-wrong-shop',
    },
  }), 'ORDER_NOT_FOUND');

  await expectRejected(createOrderRefund({
    db,
    stripe,
    shop,
    orderId: 1,
    reconcileFees: false,
    body: {
      refund_type: 'partial',
      idempotency_key: 'refund-missing-amount',
    },
  }), 'REFUND_AMOUNT_REQUIRED');

  await syncRefundFromStripeRefund({
    db,
    stripe,
    refund: {
      id: 're_failed',
      status: 'failed',
      amount: 4000,
      payment_intent: 'pi_test_2',
      metadata: { orderId: '2', shopId: '1' },
      failure_reason: 'lost_or_stolen_card',
    },
    reconcileFees: false,
  });
  const failedOrder = db.prepare('SELECT refunded_cents, payment_status FROM orders WHERE id = 2').get();
  assert(failedOrder.refunded_cents === 2500, 'failed refund webhook must not increase refunded amount');
  assert(failedOrder.payment_status === 'partially_refunded', 'failed refund webhook must keep previous refund status');

  db.close();
  console.log('Refund smoke checks passed.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
