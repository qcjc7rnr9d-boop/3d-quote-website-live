import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, requirePlatformAuth } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, PLATFORM_FEE_PERCENT, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES, RESET_TOKEN_HOURS } from '../config.js';
import { sendMail, currentProvider } from '../lib/mailer.js';
import {
  getMaskedPlatformStripeConfig,
  getEffectivePlatformStripeConfig,
  updatePlatformStripeConfig,
} from '../lib/platform-payments.js';
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
  return {
    owner_email: admin?.owner_email || null,
    has_owner_email: !!admin?.owner_email,
    has_password: !!admin?.password_hash,
    mail_provider: currentProvider(),
  };
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
      await sendMail({
        to: admin.owner_email,
        subject: 'Reset your Trennen platform password',
        text: `Reset your Trennen platform password using this link. It expires in ${RESET_TOKEN_HOURS} hour(s):\n\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
        html: `
          <p>Reset your Trennen platform password using the link below.</p>
          <p><a href="${resetLink}">Reset platform password</a></p>
          <p>This link expires in ${RESET_TOKEN_HOURS} hour(s). If you did not request this, you can ignore this email.</p>
        `,
      });
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
    const feePercent = getEffectivePlatformStripeConfig().feePercent || PLATFORM_FEE_PERCENT;
    const monthFees = monthRevenue * feePercent / 100;

    res.json({ shopCount, orderCount, monthRevenue, monthFees, feePercent });
  } catch (err) {
    console.error('Platform stats error:', err);
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
        s.stripe_details_submitted, s.created_at,
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
    const { publishable_key, secret_key, client_id, platform_fee_percent } = req.body;

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

    const result = updatePlatformStripeConfig({
      publishableKey: publishable_key,
      secretKey: secret_key,
      clientId: client_id,
      platformFeePercent: platform_fee_percent,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Save platform payments config error:', err);
    res.status(500).json({ error: 'Failed to save payments config' });
  }
});

// ── POST /api/platform/shops ──────────────────────────────────
router.post('/shops', requirePlatformAuth, async (req, res) => {
  try {
    const { name, slug, email, password, plan } = req.body;
    if (!name || !slug || !email || !password) {
      return res.status(400).json({ error: 'Name, slug, email and password are required' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = db.prepare(`
      INSERT INTO shops (name, slug, email, password_hash, plan, is_temp_password)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, slug.toLowerCase(), email.toLowerCase(), hash, plan || 'starter');

    const shopId = result.lastInsertRowid;

    // Create default pricing config and store settings
    db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
    db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);

    const shop = db.prepare(
      'SELECT id, name, slug, email, plan, is_temp_password, created_at FROM shops WHERE id = ?'
    ).get(shopId);

    res.status(201).json(shop);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A shop with that email or slug already exists' });
    }
    console.error('Create shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/platform/shops/:id ────────────────────────────
router.patch('/shops/:id', requirePlatformAuth, (req, res) => {
  try {
    const { suspended, plan } = req.body;
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    let newPlan = plan || shop.plan;
    if (suspended !== undefined) {
      newPlan = suspended ? 'suspended' : 'starter';
    }

    db.prepare('UPDATE shops SET plan = ? WHERE id = ?').run(newPlan, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
  res.json({ ok: true });
});

export default router;
