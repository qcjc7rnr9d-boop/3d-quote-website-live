import { createHash } from 'node:crypto';

const DIGEST_PREFIX = 'sha256:';

export function resetTokenDigest(token) {
  return `${DIGEST_PREFIX}${createHash('sha256').update(String(token || '')).digest('hex')}`;
}

export function resetTokenLookupValues(token) {
  const raw = String(token || '');
  return [resetTokenDigest(raw), raw];
}

export function isResetTokenDigest(value) {
  return String(value || '').startsWith(DIGEST_PREFIX);
}
