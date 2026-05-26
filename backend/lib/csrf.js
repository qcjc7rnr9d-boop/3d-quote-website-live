import { randomBytes, timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PATHS = new Set([
  '/api/csrf-token',
  '/api/stripe/webhook',
]);

function isSessionAuthenticated(req) {
  return !!(
    req.session?.shopId
    || req.session?.customerId
    || req.session?.platformAdmin
  );
}

function tokensMatch(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function ensureCsrfToken(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('base64url');
  }
  return req.session.csrfToken;
}

export function csrfTokenHandler(req, res) {
  const csrfToken = ensureCsrfToken(req);
  res.json({ csrfToken });
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();
  if (!isSessionAuthenticated(req)) return next();

  const expected = ensureCsrfToken(req);
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  if (tokensMatch(supplied, expected)) return next();

  return res.status(403).json({
    ok: false,
    code: 'CSRF_REQUIRED',
    error: 'Security token expired. Refresh the page and try again.',
  });
}
