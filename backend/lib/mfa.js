import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { decryptSecret, encryptSecret } from './secret-vault.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_ISSUER = 'Trennen';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

function safeEqualCode(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpUri({ secret, accountName, issuer = DEFAULT_ISSUER }) {
  const label = `${issuer}:${accountName || 'admin'}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function verifyTotpCode(secret, code, { window = 1, period = 30, digits = 6 } = {}) {
  const token = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token) || !secret) return false;
  const counter = Math.floor(Date.now() / 1000 / period);
  for (let drift = -window; drift <= window; drift += 1) {
    if (safeEqualCode(hotp(secret, counter + drift, digits), token)) return true;
  }
  return false;
}

export function generateTotpCode(secret, { period = 30, digits = 6, now = Date.now() } = {}) {
  if (!secret) return '';
  const counter = Math.floor(now / 1000 / period);
  return hotp(secret, counter, digits);
}

export function protectMfaSecret(secret) {
  return encryptSecret(secret);
}

export function revealMfaSecret(secret) {
  return decryptSecret(secret);
}
