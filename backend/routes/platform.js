import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, requirePlatformAuth } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES, RESET_TOKEN_HOURS } from '../config.js';
import { sendMail, mailerStatus } from '../lib/mailer.js';
import {
  getMaskedPlatformStripeConfig,
  getPlatformStripeClient,
  updatePlatformStripeConfig,
} from '../lib/platform-payments.js';
import {
  billingStatusIsActive,
  createBusinessBillingSession,
} from '../lib/billing.js';
import {
  createBillingAdjustment,
  getBillingUsageSummary,
  listCheckoutFeeLedger,
  listPaymentFeeRecords,
  listPlans,
  updatePlan,
} from '../lib/billing-service.js';
import { normalisePlanId } from '../lib/billing-plans.js';
import { ensurePlatformAuditTable, logPlatformAudit } from '../lib/platform-audit.js';
import {
  bootstrapPlatformAdmin,
  createPlatformResetToken,
  ensurePlatformAdmin,
  getPlatformAdmin,
  markPlatformResetTokenUsed,
  normaliseEmail,
  updatePlatformAdminAccount,
  validatePlatformPassword,
  verifyPlatformPassword,
  verifyPlatformResetToken,
} from '../lib/platform-auth.js';
import { attachOrderFiles, attachOrderFilesList } from '../lib/order-files.js';
import {
  buildEmailIdempotencyKey,
  ensureEmailDeliverySchema,
  getShopEmailSettings,
  recentEmailEventsForShop,
  updateShopEmailDomainSettings,
} from '../lib/email-delivery.js';

const router = Router();

const platformLoginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MINUTES * 60 * 1000,
  max: LOGIN_MAX_ATTEMPTS,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const platformForgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { ok: true, message: 'If the owner email is configured, a reset link will be sent shortly.' },
  standardHeaders: true,
  legacyHeaders: false
});

function publicPlatformAccount(admin = getPlatformAdmin()) {
  const mail = mailerStatus();
  return {
    owner_email: admin?.owner_email || null,
    has_owner_email: !!admin?.owner_email,
    has_password: !!admin?.password_hash,
    mail_provider: mail.provider,
    mail_from: mail.from,
    mail_has_custom_from: mail.has_custom_from,
    mail_using_resend_test_sender: mail.using_resend_test_sender,
  };
}

ensurePlatformAuditTable();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pageParams(query) {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '25', 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function statusCounts(table, column, where = '', params = []) {
  return db.prepare(`
    SELECT COALESCE(${column}, 'unknown') as status, COUNT(*) as count
    FROM ${table}
    ${where}
    GROUP BY COALESCE(${column}, 'unknown')
  `).all(...params).reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});
}

function platformOverviewPayload(where = '', params = []) {
  const suffix = where ? ` ${where}` : '';
  const scopedOrders = suffix ? `FROM orders o${suffix}` : 'FROM orders o';
  const revenue = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN o.payment_status = 'paid' THEN 1 ELSE 0 END) as paid_checkouts,
      SUM(CASE WHEN o.fulfilment_status = 'complete' THEN 1 ELSE 0 END) as delivered_orders,
      SUM(CASE WHEN o.fulfilment_status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) as active_orders,
      COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END), 0) as paid_revenue,
      COALESCE(AVG(CASE WHEN o.payment_status = 'paid' THEN o.total END), 0) as average_order_value
    ${scopedOrders}
  `).get(...params) || {};
  const ledgerWhere = where ? `WHERE ${where.replace(/^WHERE\s+/i, '').replace(/\bo\./g, 'l.')}` : '';
  const platformFees = db.prepare(`
    SELECT COALESCE(SUM(l.final_platform_fee_cents), 0) as cents
    FROM checkout_fee_ledger l
    ${ledgerWhere}
  `).get(...params) || {};

  return {
    total_orders: revenue.total_orders || 0,
    paid_checkouts: revenue.paid_checkouts || 0,
    delivered_orders: revenue.delivered_orders || 0,
    active_orders: revenue.active_orders || 0,
    revenue: toNumber(revenue.paid_revenue),
    estimated_platform_fees: toNumber(platformFees.cents) / 100,
    average_order_value: toNumber(revenue.average_order_value),
    fee_percent: null,
  };
}

function parseCustomerTarget(raw) {
  const text = String(raw || '');
  const idx = text.indexOf(':');
  if (idx <= 0) return null;
  const shopId = parseInt(text.slice(0, idx), 10);
  const email = text.slice(idx + 1).trim().toLowerCase();
  if (!Number.isFinite(shopId) || !email) return null;
  return { shopId, email };
}

async function createBillingActivationForShop(shop) {
  const planId = normalisePlanId(shop.plan);
  if (planId === 'community') {
    db.prepare(`
      UPDATE shops
      SET billing_status = CASE
            WHEN plan = 'suspended' THEN 'suspended'
            ELSE 'active'
          END,
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(shop.id);
    return {
      billing_checkout_url: null,
      billing_setup_status: 'free_plan',
      billing_setup_error: 'Community is free; no monthly billing link is required.',
    };
  }
  try {
    return await createBusinessBillingSession({
      db,
      stripe: getPlatformStripeClient(),
      shop: { ...shop, plan: planId },
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    });
  } catch (err) {
    return {
      billing_checkout_url: null,
      billing_setup_status: err.code || 'billing_not_ready',
      billing_setup_error: err.message || 'Billing link could not be created.',
    };
  }
}

// ── POST /api/platform/login ──────────────────────────────────
router.post('/login', platformLoginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const ownerEmail = normaliseEmail(email);
    const admin = ensurePlatformAdmin();

    if (!ownerEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const emailMatches = !admin.owner_email || ownerEmail === normaliseEmail(admin.owner_email);
    const passwordOk = await verifyPlatformPassword(password);
    if (!emailMatches || !passwordOk) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    let nextAdmin = admin;
    if (!admin.password_hash) {
      nextAdmin = await bootstrapPlatformAdmin(ownerEmail, password);
    } else if (!admin.owner_email) {
      nextAdmin = await updatePlatformAdminAccount({ ownerEmail });
    }

    req.session.platformAdmin = true;
    req.session.platformAdminId = nextAdmin?.id || 1;
    res.json({ ok: true });
  } catch (err) {
    console.error('Platform login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/platform/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.platformAdmin = false;
  req.session.platformAdminId = null;
  res.json({ ok: true });
});

// ── GET /api/platform/me ──────────────────────────────────────
router.get('/me', requirePlatformAuth, (req, res) => {
  res.json({ ok: true, role: 'platform', account: publicPlatformAccount() });
});

router.get('/account', requirePlatformAuth, (req, res) => {
  res.json(publicPlatformAccount());
});

router.put('/account', requirePlatformAuth, async (req, res) => {
  try {
    const { owner_email, current_password, new_password } = req.body;
    const nextEmail = owner_email !== undefined ? normaliseEmail(owner_email) : undefined;

    if (nextEmail !== undefined && (!nextEmail || !nextEmail.includes('@'))) {
      return res.status(400).json({ error: 'Enter a valid owner email.' });
    }

    if (new_password) {
      if (!current_password || !await verifyPlatformPassword(current_password)) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      const strengthError = validatePlatformPassword(new_password);
      if (strengthError) return res.status(400).json({ error: strengthError });
    }

    const admin = await updatePlatformAdminAccount({
      ownerEmail: nextEmail,
      newPassword: new_password || undefined,
    });

    logPlatformAudit(req, {
      action: 'update_platform_account',
      targetType: 'platform_admin',
      targetId: admin?.id || 1,
      metadata: {
        changed_owner_email: nextEmail !== undefined,
        changed_password: !!new_password,
      },
    });

    res.json({ ok: true, ...publicPlatformAccount(admin) });
  } catch (err) {
    console.error('Platform account update error:', err);
    res.status(500).json({ error: 'Failed to update platform account' });
  }
});

router.post('/forgot-password', platformForgotLimiter, async (req, res) => {
  const message = 'If the owner email is configured, a reset link will be sent shortly.';
  try {
    const admin = ensurePlatformAdmin();
    if (admin?.owner_email) {
      const token = createPlatformResetToken();
      const resetLink = `${process.env.BASE_URL || 'http://localhost:3000'}/platform/reset-password.html?token=${encodeURIComponent(token)}`;
      const result = await sendMail({
        templateId: 'platform_password_reset',
        category: 'account',
        shopSlug: 'platform',
        idempotencyKey: buildEmailIdempotencyKey('platform-reset', token),
        to: admin.owner_email,
        subject: 'Reset your Trennen platform password',
        text: `Reset your Trennen platform password using this link. It expires in ${RESET_TOKEN_HOURS} hour(s):\n\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
        html: `
          <p>Reset your Trennen platform password using the link below.</p>
          <p><a href="${resetLink}">Reset platform password</a></p>
          <p>This link expires in ${RESET_TOKEN_HOURS} hour(s). If you did not request this, you can ignore this email.</p>
        `,
      });
      console.log(`Platform reset email queued via ${result.provider} for ${admin.owner_email}`);
    }
    res.json({ ok: true, message });
  } catch (err) {
    console.error('Platform forgot password error:', err);
    res.json({ ok: true, message });
  }
});

router.get('/reset-password/verify', (req, res) => {
  const row = verifyPlatformResetToken(req.query.token);
  res.status(row ? 200 : 400).json({ valid: !!row });
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const row = verifyPlatformResetToken(token);
    if (!row) return res.status(400).json({ error: 'Token expired or invalid' });

    const strengthError = validatePlatformPassword(newPassword);
    if (strengthError) return res.status(400).json({ error: strengthError });

    await updatePlatformAdminAccount({ newPassword });
    markPlatformResetTokenUsed(token);
    res.json({ ok: true });
  } catch (err) {
    console.error('Platform reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── GET /api/platform/stats ───────────────────────────────────
router.get('/stats', requirePlatformAuth, (req, res) => {
  try {
    const shopCount = db.prepare('SELECT COUNT(*) as c FROM shops').get().c;
    const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const monthRevenue = db.prepare(
      "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='paid' AND created_at >= datetime('now','start of month')"
    ).get().s;
    const monthFees = (db.prepare(
      "SELECT COALESCE(SUM(final_platform_fee_cents),0) as s FROM checkout_fee_ledger WHERE created_at >= datetime('now','start of month') AND status != 'failed'"
    ).get().s || 0) / 100;

    res.json({ shopCount, orderCount, monthRevenue, monthFees, feePercent: null });
  } catch (err) {
    console.error('Platform stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/overview', requirePlatformAuth, (req, res) => {
  try {
    const overview = platformOverviewPayload();
    res.json({
      ...overview,
      total_shops: db.prepare('SELECT COUNT(*) as c FROM shops').get().c,
      customer_accounts: db.prepare('SELECT COUNT(*) as c FROM customer_accounts').get().c,
      customer_records: db.prepare('SELECT COUNT(*) as c FROM customers').get().c,
      payment_status_counts: statusCounts('orders', 'payment_status'),
      fulfilment_status_counts: statusCounts('orders', 'fulfilment_status'),
      stripe_ready_shops: db.prepare(`
        SELECT COUNT(*) as c
        FROM shops
        WHERE stripe_account_id IS NOT NULL
          AND stripe_charges_enabled = 1
          AND stripe_payouts_enabled = 1
          AND stripe_details_submitted = 1
      `).get().c,
      billing_active_shops: db.prepare(`
        SELECT COUNT(*) as c
        FROM shops
        WHERE billing_status IN ('active', 'trialing')
           OR (plan = 'community' AND billing_status != 'suspended')
      `).get().c,
    });
  } catch (err) {
    console.error('Platform overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/shops/:id/overview', requirePlatformAuth, (req, res) => {
  try {
    const shopId = parseInt(req.params.id, 10);
    const shop = db.prepare(`
      SELECT id, name, slug, email, plan, stripe_account_id,
             stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
             billing_customer_id, billing_subscription_id, billing_price_id,
             billing_status, billing_current_period_end, billing_checkout_session_id,
             billing_checkout_status, billing_updated_at,
             created_at, updated_at
      FROM shops
      WHERE id = ?
    `).get(shopId);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const overview = platformOverviewPayload('WHERE o.shop_id = ?', [shop.id]);
    const recent_orders = db.prepare(`
      SELECT o.id, o.created_at, o.customer_email, o.customer_name, o.file_name,
             o.colour, o.finish, o.quantity, o.subtotal, o.tax, o.shipping, o.total,
             o.payment_status, o.fulfilment_status, m.name as material_name
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.shop_id = ?
      ORDER BY o.created_at DESC
      LIMIT 10
    `).all(shop.id);

    res.json({
      shop: {
        ...shop,
        stripe_ready: !!(shop.stripe_account_id && shop.stripe_charges_enabled && shop.stripe_payouts_enabled && shop.stripe_details_submitted),
        billing_active: billingStatusIsActive(shop.billing_status, shop.plan),
        email_domain: getShopEmailSettings(db, shop.id),
      },
      metrics: {
        ...overview,
        customer_accounts: db.prepare('SELECT COUNT(*) as c FROM customer_accounts WHERE shop_id = ?').get(shop.id).c,
        customer_records: db.prepare('SELECT COUNT(*) as c FROM customers WHERE shop_id = ?').get(shop.id).c,
        payment_status_counts: statusCounts('orders', 'payment_status', 'WHERE shop_id = ?', [shop.id]),
        fulfilment_status_counts: statusCounts('orders', 'fulfilment_status', 'WHERE shop_id = ?', [shop.id]),
      },
      recent_orders,
    });
  } catch (err) {
    console.error('Platform shop overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders', requirePlatformAuth, (req, res) => {
  try {
    const { page, limit, offset } = pageParams(req.query);
    const conditions = [];
    const params = [];
    const {
      shop, search, payment_status, fulfilment_status,
      from, to, min_total, max_total,
    } = req.query;

    if (shop) {
      conditions.push('o.shop_id = ?');
      params.push(parseInt(shop, 10));
    }
    if (payment_status) {
      conditions.push('o.payment_status = ?');
      params.push(String(payment_status));
    }
    if (fulfilment_status) {
      conditions.push('o.fulfilment_status = ?');
      params.push(String(fulfilment_status));
    }
    if (from) {
      conditions.push('o.created_at >= ?');
      params.push(String(from));
    }
    if (to) {
      conditions.push('o.created_at <= ?');
      params.push(String(to));
    }
    if (min_total !== undefined && min_total !== '') {
      conditions.push('o.total >= ?');
      params.push(Number(min_total));
    }
    if (max_total !== undefined && max_total !== '') {
      conditions.push('o.total <= ?');
      params.push(Number(max_total));
    }
    if (search) {
      const term = `%${String(search).trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(o.customer_email) LIKE ?
        OR LOWER(o.customer_name) LIKE ?
        OR LOWER(COALESCE(o.file_name, '')) LIKE ?
        OR LOWER(COALESCE(m.name, '')) LIKE ?
        OR CAST(o.id AS TEXT) LIKE ?
      )`);
      params.push(term, term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`
      SELECT COUNT(*) as c
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      ${where}
    `).get(...params).c;
    const orders = attachOrderFilesList(db, db.prepare(`
      SELECT o.id, o.shop_id, s.name as shop_name, s.slug as shop_slug,
             o.created_at, o.customer_email, o.customer_name, o.file_name,
             o.material_id, m.name as material_name, o.colour, o.finish, o.quantity,
             o.subtotal, o.tax, o.shipping, o.total,
             o.payment_status, o.fulfilment_status, o.tracking_number
      FROM orders o
      JOIN shops s ON s.id = o.shop_id
      LEFT JOIN materials m ON m.id = o.material_id
      ${where}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset));

    res.json({ orders, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    console.error('Platform orders list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders/:id', requirePlatformAuth, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.id, o.shop_id, o.created_at, o.customer_email, o.customer_name,
             o.file_name, o.material_id, o.colour, o.finish, o.quantity,
             o.subtotal, o.tax, o.shipping, o.total, o.payment_status,
             o.fulfilment_status, o.tracking_number, o.tracking_url,
             o.customer_message, o.notes, o.stripe_payment_id,
             s.name as shop_name, s.slug as shop_slug, s.email as shop_email,
             m.name as material_name, m.category as material_category,
             ca.id as customer_account_id, ca.created_at as customer_account_created_at
      FROM orders o
      JOIN shops s ON s.id = o.shop_id
      LEFT JOIN materials m ON m.id = o.material_id
      LEFT JOIN customer_accounts ca ON ca.shop_id = o.shop_id AND LOWER(ca.email) = LOWER(o.customer_email)
      WHERE o.id = ?
    `).get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    logPlatformAudit(req, {
      action: 'view_order_detail',
      targetType: 'order',
      targetId: order.id,
      shopId: order.shop_id,
    });

    const withFiles = attachOrderFiles(db, order);
    res.json({
      id: order.id,
      created_at: order.created_at,
      file_name: order.file_name,
      files: withFiles.files,
      items: withFiles.items,
      material: order.material_id ? {
        id: order.material_id,
        name: order.material_name,
        category: order.material_category,
      } : null,
      colour: order.colour,
      finish: order.finish,
      quantity: order.quantity,
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      total: order.total,
      payment_status: order.payment_status,
      fulfilment_status: order.fulfilment_status,
      tracking_number: order.tracking_number,
      tracking_url: order.tracking_url,
      customer_message: order.customer_message,
      notes: order.notes,
      stripe_payment_id: order.stripe_payment_id,
      shop: {
        id: order.shop_id,
        name: order.shop_name,
        slug: order.shop_slug,
        email: order.shop_email,
      },
      customer: {
        email: order.customer_email,
        name: order.customer_name,
        account_id: order.customer_account_id,
        account_created_at: order.customer_account_created_at,
      },
    });
  } catch (err) {
    console.error('Platform order detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/customers', requirePlatformAuth, (req, res) => {
  try {
    const { page, limit, offset } = pageParams(req.query);
    const conditions = [];
    const params = [];
    if (req.query.shop) {
      conditions.push('d.shop_id = ?');
      params.push(parseInt(req.query.shop, 10));
    }
    if (req.query.search) {
      const term = `%${String(req.query.search).trim().toLowerCase()}%`;
      conditions.push('(LOWER(d.email) LIKE ? OR LOWER(COALESCE(d.name, "")) LIKE ? OR LOWER(s.name) LIKE ?)');
      params.push(term, term, term);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseSql = `
      WITH people AS (
        SELECT shop_id, email, name, created_at, 1 as has_customer_record, 0 as has_account
        FROM customers
        UNION ALL
        SELECT shop_id, email, name, created_at, 0 as has_customer_record, 1 as has_account
        FROM customer_accounts
      ),
      deduped AS (
        SELECT shop_id, LOWER(email) as email_key, MAX(email) as email,
               COALESCE(
                 MAX(CASE WHEN has_account = 1 THEN name END),
                 MAX(CASE WHEN has_customer_record = 1 THEN name END)
               ) as name,
               MIN(CASE WHEN has_customer_record = 1 THEN created_at END) as customer_created_at,
               MIN(CASE WHEN has_account = 1 THEN created_at END) as account_created_at,
               MAX(has_customer_record) as has_customer_record,
               MAX(has_account) as has_account
        FROM people
        GROUP BY shop_id, LOWER(email)
      )
    `;
    const total = db.prepare(`
      ${baseSql}
      SELECT COUNT(*) as c
      FROM deduped d
      JOIN shops s ON s.id = d.shop_id
      ${where}
    `).get(...params).c;
    const customers = db.prepare(`
      ${baseSql}
      SELECT d.shop_id, s.name as shop_name, s.slug as shop_slug,
             d.email, d.name, d.customer_created_at, d.account_created_at,
             d.has_customer_record, d.has_account,
             COUNT(o.id) as order_count,
             COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total ELSE 0 END), 0) as total_spent,
             MAX(o.created_at) as last_order_at
      FROM deduped d
      JOIN shops s ON s.id = d.shop_id
      LEFT JOIN orders o ON o.shop_id = d.shop_id AND LOWER(o.customer_email) = d.email_key
      ${where}
      GROUP BY d.shop_id, d.email_key
      ORDER BY COALESCE(MAX(o.created_at), d.account_created_at, d.customer_created_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(c => ({
      ...c,
      id: `${c.shop_id}:${c.email}`,
      has_customer_record: !!c.has_customer_record,
      has_account: !!c.has_account,
    }));
    res.json({ customers, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    console.error('Platform customers list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/customers/:id', requirePlatformAuth, (req, res) => {
  try {
    const target = parseCustomerTarget(req.params.id);
    if (!target) return res.status(400).json({ error: 'Invalid customer id' });
    const shop = db.prepare('SELECT id, name, slug FROM shops WHERE id = ?').get(target.shopId);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const customer = db.prepare(`
      SELECT c.id, c.email, c.name, c.notes, c.created_at,
             ca.id as account_id, ca.name as account_name, ca.created_at as account_created_at
      FROM (
        SELECT ? as shop_id, ? as email
      ) target
      LEFT JOIN customers c ON c.shop_id = target.shop_id AND LOWER(c.email) = LOWER(target.email)
      LEFT JOIN customer_accounts ca ON ca.shop_id = target.shop_id AND LOWER(ca.email) = LOWER(target.email)
    `).get(target.shopId, target.email);

    if (!customer?.id && !customer?.account_id) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const orders = db.prepare(`
      SELECT o.id, o.created_at, o.file_name, o.colour, o.finish, o.quantity,
             o.subtotal, o.tax, o.shipping, o.total, o.payment_status, o.fulfilment_status,
             m.name as material_name
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
      ORDER BY o.created_at DESC
      LIMIT 25
    `).all(target.shopId, target.email);

    logPlatformAudit(req, {
      action: 'view_customer_detail',
      targetType: 'customer',
      targetId: `${target.shopId}:${target.email}`,
      shopId: target.shopId,
    });

    res.json({
      shop,
      customer: {
        id: customer.id,
        email: customer.email || target.email,
        name: customer.account_name || customer.name || null,
        notes: customer.notes || null,
        customer_created_at: customer.created_at || null,
        account_id: customer.account_id || null,
        account_created_at: customer.account_created_at || null,
        has_account: !!customer.account_id,
      },
      metrics: {
        order_count: orders.length,
        paid_orders: orders.filter(o => o.payment_status === 'paid').length,
        total_spent: orders.reduce((sum, o) => sum + (o.payment_status === 'paid' ? toNumber(o.total) : 0), 0),
      },
      orders,
    });
  } catch (err) {
    console.error('Platform customer detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-events', requirePlatformAuth, (req, res) => {
  try {
    const { limit, offset, page } = pageParams(req.query);
    const total = db.prepare('SELECT COUNT(*) as c FROM platform_audit_events').get().c;
    const events = db.prepare(`
      SELECT e.id, e.platform_admin_id, e.action, e.target_type, e.target_id,
             e.shop_id, s.name as shop_name, s.slug as shop_slug,
             e.ip, e.user_agent, e.metadata, e.created_at
      FROM platform_audit_events e
      LEFT JOIN shops s ON s.id = e.shop_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset).map(e => ({
      ...e,
      metadata: (() => {
        try { return JSON.parse(e.metadata || '{}'); } catch { return {}; }
      })(),
    }));
    res.json({ events, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    console.error('Platform audit events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/platform/shops ───────────────────────────────────
router.get('/shops', requirePlatformAuth, (req, res) => {
  try {
    const shops = db.prepare(`
      SELECT
        s.id, s.name, s.slug, s.email, s.plan,
        s.stripe_account_id, s.stripe_charges_enabled, s.stripe_payouts_enabled,
        s.stripe_details_submitted,
        s.billing_customer_id, s.billing_subscription_id, s.billing_price_id,
        s.billing_status, s.billing_current_period_end, s.billing_checkout_session_id,
        s.billing_checkout_status, s.billing_updated_at,
        s.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.id) as order_count,
        (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.shop_id = s.id AND payment_status='paid') as revenue
      FROM shops s
      ORDER BY s.created_at DESC
    `).all();
    res.json(shops);
  } catch (err) {
    console.error('Platform shops error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/payments', requirePlatformAuth, (req, res) => {
  try {
    res.json(getMaskedPlatformStripeConfig());
  } catch (err) {
    console.error('Platform payments config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/payments', requirePlatformAuth, (req, res) => {
  try {
    const { publishable_key, secret_key, client_id, platform_fee_percent, estimated_card_fee_basis_points, estimated_card_fee_fixed_cents } = req.body;

    if (publishable_key !== undefined && publishable_key && !publishable_key.startsWith('pk_')) {
      return res.status(400).json({ error: 'Publishable key must start with pk_live_ or pk_test_' });
    }
    if (secret_key !== undefined && secret_key && !secret_key.startsWith('sk_')) {
      return res.status(400).json({ error: 'Secret key must start with sk_live_ or sk_test_' });
    }
    if (client_id !== undefined && client_id && !client_id.startsWith('ca_')) {
      return res.status(400).json({ error: 'Client ID must start with ca_' });
    }
    if (platform_fee_percent !== undefined && platform_fee_percent !== '' && (Number(platform_fee_percent) < 0 || Number(platform_fee_percent) > 100)) {
      return res.status(400).json({ error: 'Platform fee percent must be between 0 and 100' });
    }
    if (estimated_card_fee_basis_points !== undefined && estimated_card_fee_basis_points !== '' && Number(estimated_card_fee_basis_points) < 0) {
      return res.status(400).json({ error: 'Estimated card fee basis points must be 0 or more' });
    }
    if (estimated_card_fee_fixed_cents !== undefined && estimated_card_fee_fixed_cents !== '' && Number(estimated_card_fee_fixed_cents) < 0) {
      return res.status(400).json({ error: 'Estimated card fixed fee must be 0 or more' });
    }

    const result = updatePlatformStripeConfig({
      publishableKey: publishable_key,
      secretKey: secret_key,
      clientId: client_id,
      platformFeePercent: platform_fee_percent,
      estimatedCardFeeBasisPoints: estimated_card_fee_basis_points,
      estimatedCardFeeFixedCents: estimated_card_fee_fixed_cents,
    });

    logPlatformAudit(req, {
      action: 'update_stripe_config',
      targetType: 'platform_settings',
      targetId: '1',
      metadata: {
        changed_publishable_key: publishable_key !== undefined && !!publishable_key,
        changed_secret_key: secret_key !== undefined && !!secret_key,
        changed_client_id: client_id !== undefined && !!client_id,
        changed_fee_percent: platform_fee_percent !== undefined,
      },
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Save platform payments config error:', err);
    res.status(500).json({ error: 'Failed to save payments config' });
  }
});

router.get('/plans', requirePlatformAuth, (req, res) => {
  try {
    res.json({ plans: listPlans(db) });
  } catch (err) {
    console.error('Platform plans error:', err);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

router.put('/plans/:id', requirePlatformAuth, (req, res) => {
  try {
    const plan = updatePlan(db, req.params.id, req.body || {});
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    logPlatformAudit(req, {
      action: 'update_billing_plan',
      targetType: 'plan',
      targetId: plan.id,
      metadata: { fields: Object.keys(req.body || {}) },
    });
    res.json({ ok: true, plan });
  } catch (err) {
    console.error('Update platform plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

router.get('/fee-ledgers', requirePlatformAuth, (req, res) => {
  try {
    const shopId = req.query.shop_id ? parseInt(req.query.shop_id, 10) : null;
    res.json({ records: listCheckoutFeeLedger(db, { shopId: Number.isFinite(shopId) ? shopId : null }) });
  } catch (err) {
    console.error('Platform fee ledger error:', err);
    res.status(500).json({ error: 'Failed to load checkout_fee_ledger' });
  }
});

router.get('/payment-fee-records', requirePlatformAuth, (req, res) => {
  try {
    const shopId = req.query.shop_id ? parseInt(req.query.shop_id, 10) : null;
    res.json({ records: listPaymentFeeRecords(db, { shopId: Number.isFinite(shopId) ? shopId : null }) });
  } catch (err) {
    console.error('Platform payment fee records error:', err);
    res.status(500).json({ error: 'Failed to load payment_fee_records' });
  }
});

router.post('/shops/:id/billing-adjustments', requirePlatformAuth, (req, res) => {
  try {
    const shop = db.prepare('SELECT id FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const adjustment = createBillingAdjustment(db, {
      shopId: shop.id,
      adjustmentType: req.body?.adjustment_type || 'credit',
      amountCents: req.body?.amount_cents || 0,
      reason: req.body?.reason || '',
    });
    logPlatformAudit(req, {
      action: 'create_billing_adjustment',
      targetType: 'shop',
      targetId: shop.id,
      shopId: shop.id,
      metadata: { amount_cents: req.body?.amount_cents || 0, adjustment_type: req.body?.adjustment_type || 'credit' },
    });
    res.status(201).json({ ok: true, adjustment });
  } catch (err) {
    console.error('Create billing adjustment error:', err);
    res.status(500).json({ error: 'Failed to create billing adjustment' });
  }
});

// ── POST /api/platform/shops ──────────────────────────────────
router.post('/shops', requirePlatformAuth, async (req, res) => {
  try {
    const { name, slug, email, password } = req.body;
    if (!name || !slug || !email || !password) {
      return res.status(400).json({ error: 'Name, slug, email and password are required' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const selectedPlan = normalisePlanId(req.body?.plan || 'starter');
    const initialBillingStatus = selectedPlan === 'community' ? 'active' : 'pending_subscription';
    const result = db.prepare(`
      INSERT INTO shops (name, slug, email, password_hash, plan, is_temp_password, billing_status)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(name, slug.toLowerCase(), email.toLowerCase(), hash, selectedPlan, initialBillingStatus);

    const shopId = result.lastInsertRowid;

    // Create default pricing config and store settings
    db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
    db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
    getBillingUsageSummary(db, shopId);

    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
    const billing = await createBillingActivationForShop(shop);
    const publicShop = db.prepare(`
      SELECT id, name, slug, email, plan, is_temp_password,
             billing_customer_id, billing_subscription_id, billing_price_id,
             billing_status, billing_current_period_end, billing_checkout_session_id,
             billing_checkout_status, billing_updated_at,
             created_at, updated_at
      FROM shops
      WHERE id = ?
    `).get(shopId);

    logPlatformAudit(req, {
      action: 'create_shop',
      targetType: 'shop',
      targetId: shopId,
      shopId,
      metadata: { plan: shop.plan },
    });

    res.status(201).json({
      ...publicShop,
      ...billing,
      billing_active: billingStatusIsActive(publicShop.billing_status, publicShop.plan),
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A shop with that email or slug already exists' });
    }
    console.error('Create shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/shops/:id/billing-session', requirePlatformAuth, async (req, res) => {
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const billing = await createBillingActivationForShop(shop);
    if (!billing.billing_checkout_url) {
      const freePlan = billing.billing_setup_status === 'free_plan';
      return res.status(400).json({
        error: billing.billing_setup_error || 'Billing link could not be created.',
        code: freePlan ? 'FREE_PLAN_NO_BILLING_REQUIRED' : billing.billing_setup_status,
        ...billing,
      });
    }

    logPlatformAudit(req, {
      action: 'create_shop_billing_session',
      targetType: 'shop',
      targetId: shop.id,
      shopId: shop.id,
      metadata: { plan: shop.plan },
    });

    res.json({ ok: true, shop_id: shop.id, ...billing });
  } catch (err) {
    console.error('Create shop billing session error:', err);
    res.status(500).json({ error: 'Failed to create billing link' });
  }
});

// ── PATCH /api/platform/shops/:id ────────────────────────────
router.patch('/shops/:id', requirePlatformAuth, (req, res) => {
  try {
    const { suspended } = req.body;
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const newPlan = suspended === undefined
      ? (shop.plan === 'suspended' ? 'suspended' : 'starter')
      : (suspended ? 'suspended' : 'starter');

    const nextBillingStatus = newPlan === 'suspended'
      ? 'suspended'
      : 'active';

    db.prepare(`
      UPDATE shops
      SET plan = ?,
          billing_status = ?,
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newPlan, nextBillingStatus, req.params.id);
    logPlatformAudit(req, {
      action: newPlan === 'suspended' ? 'suspend_shop' : 'restore_shop',
      targetType: 'shop',
      targetId: req.params.id,
      shopId: shop.id,
      metadata: { previous_plan: shop.plan, next_plan: newPlan },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Update shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/shops/:id/email-domain', requirePlatformAuth, (req, res) => {
  try {
    ensureEmailDeliverySchema(db);
    const shop = db.prepare('SELECT id, slug FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shop.id);

    const emailDomain = updateShopEmailDomainSettings(db, shop.id, req.body || {}, { allowStatus: true });
    logPlatformAudit(req, {
      action: 'update_shop_email_domain',
      targetType: 'shop',
      targetId: shop.id,
      shopId: shop.id,
      metadata: {
        domain: emailDomain.domain || null,
        status: emailDomain.status,
      },
    });
    res.json({ ok: true, shop_id: shop.id, email_domain: emailDomain });
  } catch (err) {
    const status = err.code === 'INVALID_EMAIL_DOMAIN' ? 400 : 500;
    res.status(status).json({ error: err.message || 'Failed to update email domain.' });
  }
});

router.get('/shops/:id/email-status', requirePlatformAuth, (req, res) => {
  try {
    ensureEmailDeliverySchema(db);
    const shop = db.prepare('SELECT id, slug FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shop.id);
    res.json({
      shop_id: shop.id,
      email_domain: getShopEmailSettings(db, shop.id),
      recent_events: recentEmailEventsForShop(db, shop.id, 20),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load email status.' });
  }
});

// ── POST /api/platform/impersonate ───────────────────────────
router.post('/impersonate', requirePlatformAuth, (req, res) => {
  const { shopId } = req.body;
  if (!shopId) {
    return res.status(400).json({ error: 'shopId required' });
  }

  const shop = db.prepare('SELECT id FROM shops WHERE id = ?').get(shopId);
  if (!shop) {
    return res.status(404).json({ error: 'Shop not found' });
  }

  req.session.shopId = shop.id;
  logPlatformAudit(req, {
    action: 'impersonate_shop',
    targetType: 'shop',
    targetId: shop.id,
    shopId: shop.id,
  });
  res.json({ ok: true });
});

export default router;
