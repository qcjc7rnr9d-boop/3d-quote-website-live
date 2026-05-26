import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { blockPlatformImpersonation, db, requireShopAuth } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate } from '../lib/email-templates/index.js';
import { buildEmailIdempotencyKey } from '../lib/email-delivery.js';
import { resetTokenDigest, resetTokenLookupValues } from '../lib/reset-tokens.js';
import { clearSessionCookie, destroySession, regenerateSession, revokeShopSessions } from '../lib/session-security.js';
import {
  getMerchantLegalStatus,
  recordMerchantLegalAcceptance,
} from '../lib/legal-policy.js';
import {
  BCRYPT_ROUNDS,
  SESSION_DAYS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MINUTES,
  MIN_PASSWORD_LENGTH
} from '../config.js';

const router = Router();
const smokeRateLimitSkip = req => process.env.NODE_ENV !== 'production' && req.get('x-smoke-test') === '1';

const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MINUTES * 60 * 1000,
  max: LOGIN_MAX_ATTEMPTS,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { ok: true, message: "If that email is registered, you'll receive a reset link shortly." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});

const resetVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { valid: false, error: 'Too many reset link checks, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});

function validatePasswordStrength(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one digit';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character';
  }
  return null;
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const shop = db.prepare("SELECT * FROM shops WHERE email = ? AND plan != 'suspended'").get(email.trim().toLowerCase());
    if (!shop) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    const valid = await bcrypt.compare(password, shop.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    await regenerateSession(req);
    req.session.shopId = shop.id;

    // Record session in sessions table
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');

    db.prepare(
      'INSERT OR IGNORE INTO sessions (shop_id, token, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      shop.id,
      req.sessionID,
      req.ip,
      req.get('user-agent') || null,
      expiresAt
    );

    res.json({ ok: true, is_temp_password: shop.is_temp_password });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const sessionToken = req.sessionID;
  try {
    await destroySession(req);
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionToken);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireShopAuth, (req, res) => {
  const {
    id, name, slug, email, plan, is_temp_password, stripe_account_id,
    stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
    billing_status, billing_current_period_end,
    created_at
  } = req.shop;
  // Pull branding so admin pages can render the shop's tagline/logo
  const s = db.prepare(
    'SELECT tagline, logo_url, phone, address FROM store_settings WHERE shop_id = ?'
  ).get(id) || {};
  res.json({
    id, name, slug, email, plan, is_temp_password, stripe_account_id, created_at,
    stripe_charges_enabled: !!stripe_charges_enabled,
    stripe_payouts_enabled: !!stripe_payouts_enabled,
    stripe_details_submitted: !!stripe_details_submitted,
    billing_status: billing_status || 'pending_subscription',
    billing_current_period_end: billing_current_period_end || null,
    tagline:  s.tagline  || null,
    logo_url: s.logo_url || null,
    phone:    s.phone    || null,
    address:  s.address  || null,
    impersonation: req.platformImpersonation || { active: false },
  });
});

// GET /api/auth/legal/status
router.get('/legal/status', requireShopAuth, (req, res) => {
  try {
    res.json(getMerchantLegalStatus(db, req.shop.id));
  } catch (err) {
    console.error('Legal status error:', err);
    res.status(500).json({ error: 'Could not load merchant legal status.' });
  }
});

// POST /api/auth/legal/accept
router.post('/legal/accept', requireShopAuth, (req, res) => {
  try {
    const accepted = req.body?.accepted === true;
    if (!accepted) {
      return res.status(400).json({ error: 'Merchant agreement acceptance is required.' });
    }
    const acceptance = recordMerchantLegalAcceptance(db, {
      shopId: req.shop.id,
      userEmail: req.shop.email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
      metadata: {
        source: 'admin_account',
        shopSlug: req.shop.slug,
      },
    });
    res.json({
      ok: true,
      acceptance: {
        version: acceptance.version,
        accepted_at: acceptance.accepted_at,
      },
      legal: getMerchantLegalStatus(db, req.shop.id),
    });
  } catch (err) {
    console.error('Legal acceptance error:', err);
    res.status(500).json({ error: 'Could not record merchant legal acceptance.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireShopAuth, blockPlatformImpersonation, async (req, res) => {
  try {
    const current = req.body.current || req.body.currentPassword;
    const { newPassword } = req.body;
    if (!current || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const valid = await bcrypt.compare(current, req.shop.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE shops SET password_hash = ?, is_temp_password = 0 WHERE id = ?')
      .run(hash, req.shop.id);
    revokeShopSessions(db, req.shop.id, { exceptSid: req.sessionID });

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const message = "If that email is registered, you'll receive a reset link shortly.";
  try {
    const { email } = req.body;
    if (!email) {
      return res.json({ ok: true, message });
    }

    const shop = db.prepare("SELECT * FROM shops WHERE email = ? AND plan != 'suspended'").get(email.trim().toLowerCase());
    if (!shop) {
      return res.json({ ok: true, message });
    }

    const token = jwt.sign({ shopId: shop.id, jti: uuidv4() }, process.env.JWT_SECRET, { expiresIn: '1h' });

    db.prepare(
      "INSERT INTO reset_tokens (shop_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))"
    ).run(shop.id, resetTokenDigest(token));

    const resetLink = `${process.env.BASE_URL}/admin/reset-password.html?token=${encodeURIComponent(token)}`;

    const tpl = renderTemplate('admin_password_reset', { shop, resetLink });
    await sendMail({
      shopId:  shop.id,
      shopSlug: shop.slug,
      templateId: tpl.templateId,
      category: tpl.category,
      idempotencyKey: buildEmailIdempotencyKey('admin-reset', shop.id, token),
      to:      shop.email,
      from:    tpl.from,         // shop-account@<APP_EMAIL_DOMAIN>
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      text:    tpl.text,
      html:    tpl.html,
    });

    res.json({ ok: true, message });
  } catch (err) {
    console.error('Forgot password error:', err);
    // Still return ok to avoid enumeration
    res.json({ ok: true, message });
  }
});

// GET /api/auth/reset-password/verify?token=xxx
router.get('/reset-password/verify', resetVerifyLimiter, (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
  }

  const lookup = resetTokenLookupValues(token);
  const row = db.prepare(`
    SELECT rt.*
    FROM reset_tokens rt
    JOIN shops s ON s.id = rt.shop_id
    WHERE rt.token IN (?, ?)
      AND rt.used = 0
      AND rt.expires_at > datetime('now')
      AND s.plan != 'suspended'
  `).get(...lookup);

  if (!row) {
    return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (Number(payload.shopId) !== Number(row.shop_id)) {
      return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
    }
    res.json({ valid: true });
  } catch (err) {
    res.status(400).json({ valid: false, error: 'Token expired or invalid' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', resetLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const lookup = resetTokenLookupValues(token);
    const row = db.prepare(`
      SELECT rt.*
      FROM reset_tokens rt
      JOIN shops s ON s.id = rt.shop_id
      WHERE rt.token IN (?, ?)
        AND rt.used = 0
        AND rt.expires_at > datetime('now')
        AND s.plan != 'suspended'
    `).get(...lookup);

    if (!row) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }
    if (Number(row.shop_id) !== Number(payload.shopId)) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }

    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const claimed = db.prepare(`
      UPDATE reset_tokens
      SET used = 1
      WHERE token IN (?, ?)
        AND used = 0
        AND expires_at > datetime('now')
    `).run(...lookup);
    if (claimed.changes !== 1) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }
    db.prepare('UPDATE shops SET password_hash = ?, is_temp_password = 0 WHERE id = ?')
      .run(hash, payload.shopId);
    revokeShopSessions(db, payload.shopId);

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/sessions
router.get('/sessions', requireShopAuth, (req, res) => {
  const sessions = db.prepare(
    `SELECT id, ip, user_agent, created_at, expires_at,
            CASE WHEN token = ? THEN 1 ELSE 0 END AS is_current
     FROM sessions
     WHERE shop_id = ?
     ORDER BY created_at DESC`
  ).all(req.sessionID, req.shop.id);

  const result = sessions.map(s => ({
    ...s,
    is_current: !!s.is_current
  }));

  res.json(result);
});

// DELETE /api/auth/sessions/:id
router.delete('/sessions/:id', requireShopAuth, blockPlatformImpersonation, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND shop_id = ?')
    .get(req.params.id, req.shop.id);

  if (!row) {
    return res.status(404).json({ error: 'Session not found' });
  }

  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(row.token);
  res.json({ ok: true });
});

// POST /api/auth/sessions/revoke-all
router.post('/sessions/revoke-all', requireShopAuth, blockPlatformImpersonation, (req, res) => {
  const tokens = db.prepare('SELECT token FROM sessions WHERE shop_id = ? AND token != ?')
    .all(req.shop.id, req.sessionID);
  db.prepare('DELETE FROM sessions WHERE shop_id = ? AND token != ?').run(req.shop.id, req.sessionID);
  const del = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const row of tokens) del.run(row.token);
  res.json({ ok: true });
});

// DELETE /api/auth/account
router.delete('/account', requireShopAuth, blockPlatformImpersonation, async (req, res) => {
  const shopId = req.shop.id;
  const sessionToken = req.sessionID;
  try {
    db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
    await destroySession(req);
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('Account delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
