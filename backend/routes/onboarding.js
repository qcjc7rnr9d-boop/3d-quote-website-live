import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, SESSION_DAYS } from '../config.js';
import { logPlatformAudit } from '../lib/platform-audit.js';
import {
  createSelfServeShop,
  normaliseSignupInput,
  normaliseSlug,
  slugAvailable,
  slugValidationError,
  suggestSlug,
  validateSignup,
} from '../lib/self-serve-onboarding.js';

const router = Router();

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Math.max(3, Number(process.env.ONBOARDING_SIGNUP_RATE_LIMIT_MAX || 15)),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many signup attempts from this connection. Try again later.',
  },
});

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
}

function recordAdminSession(req, shopId) {
  db.prepare(`
    INSERT OR IGNORE INTO sessions (shop_id, token, ip, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    shopId,
    req.sessionID,
    req.ip || null,
    req.get('user-agent') || null,
    sessionExpiry(),
  );
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(err => (err ? reject(err) : resolve()));
  });
}

router.get('/slug-availability', (req, res) => {
  try {
    const requested = String(req.query.slug || '');
    const slug = normaliseSlug(requested);
    const error = slugValidationError(slug);
    const available = !error && slugAvailable(db, slug);
    res.json({
      ok: true,
      slug,
      available,
      error: available ? null : (error || 'That shop URL is already taken.'),
      suggestion: available ? null : suggestSlug(db, slug || requested),
    });
  } catch (err) {
    console.error('Slug availability error:', err);
    res.status(500).json({ ok: false, error: 'Could not check shop URL availability.' });
  }
});

router.post('/signup', signupLimiter, async (req, res) => {
  let input = null;
  try {
    input = normaliseSignupInput(req.body);
    if (input.website) return res.status(204).end();

    const errors = validateSignup(db, input);
    if (Object.keys(errors).length) {
      const duplicateEmail = errors.email && /already exists/i.test(errors.email);
      if (duplicateEmail) {
        const publicErrors = { ...errors };
        delete publicErrors.email;
        return res.status(409).json({
          ok: false,
          ...(Object.keys(publicErrors).length ? { errors: publicErrors } : {}),
          error: 'Could not create that shop. Check your details and try again.',
        });
      }
      const duplicateSlug = errors.slug && /already taken/i.test(errors.slug);
      return res.status(duplicateSlug ? 409 : 400).json({ ok: false, errors });
    }

    const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const shop = createSelfServeShop(db, input, hash);
    logPlatformAudit(req, {
      action: 'self_serve_signup',
      targetType: 'shop',
      targetId: shop.id,
      shopId: shop.id,
      metadata: {
        source: 'self_serve',
        plan: shop.plan,
        payment_path: input.paymentPath,
        monthly_quote_volume: input.monthlyQuoteVolume,
      },
    });

    req.session.shopId = shop.id;
    recordAdminSession(req, shop.id);
    await saveSession(req);

    res.status(201).json({
      ok: true,
      shop,
      redirectUrl: '/admin/setup.html',
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      const slugTaken = input?.slug && !slugAvailable(db, input.slug);
      return res.status(409).json({
        ok: false,
        ...(slugTaken ? { errors: { slug: 'That shop URL is already taken.' } } : {}),
        error: slugTaken
          ? 'That shop URL is already taken.'
          : 'Could not create that shop. Check your details and try again.',
      });
    }
    console.error('Self-serve signup error:', err);
    res.status(500).json({ ok: false, error: 'Could not create your shop. Please try again.' });
  }
});

export default router;
