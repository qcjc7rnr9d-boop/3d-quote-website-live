import { createHmac, timingSafeEqual } from 'crypto';

function entriesFromParams(params = {}) {
  if (params instanceof URLSearchParams) return [...params.entries()];
  if (params && typeof params.entries === 'function') return [...params.entries()];
  const entries = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      for (const item of value) entries.push([key, item]);
    } else {
      entries.push([key, value]);
    }
  }
  return entries;
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function canonicalParams(params = {}, { separator = '&', skip = ['hmac', 'signature'] } = {}) {
  return entriesFromParams(params)
    .filter(([key, value]) => key && !skip.includes(String(key)) && value !== undefined && value !== null)
    .map(([key, value]) => [String(key), String(value)])
    .sort(([aKey, aVal], [bKey, bVal]) => aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${key}=${value}`)
    .join(separator);
}

export function signShopifyAppProxyParams(params = {}, secret = '') {
  if (!secret) return '';
  return createHmac('sha256', secret)
    .update(canonicalParams(params, { separator: '' }))
    .digest('hex');
}

export function verifyShopifyAppProxySignature(params = {}, secret = '') {
  if (!secret) return false;
  const supplied = params instanceof URLSearchParams ? params.get('signature') : params.signature;
  if (!supplied) return false;
  return safeCompare(signShopifyAppProxyParams(params, secret), supplied);
}

export function signShopifyOAuthParams(params = {}, secret = '') {
  if (!secret) return '';
  return createHmac('sha256', secret)
    .update(canonicalParams(params, { separator: '&' }))
    .digest('hex');
}

export function verifyShopifyOAuthHmac(params = {}, secret = '') {
  if (!secret) return false;
  const supplied = params instanceof URLSearchParams ? params.get('hmac') : params.hmac;
  if (!supplied) return false;
  return safeCompare(signShopifyOAuthParams(params, secret), supplied);
}

export function signShopifyWebhookBody(body, secret = '') {
  if (!secret) return '';
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  return createHmac('sha256', secret).update(bytes).digest('base64');
}

export function verifyShopifyWebhookHmac(body, suppliedHmac = '', secret = '') {
  if (!secret || !suppliedHmac) return false;
  return safeCompare(signShopifyWebhookBody(body, secret), suppliedHmac);
}
