import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function keyMaterial() {
  const raw = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY || '';
  if (!raw) return null;
  return createHash('sha256').update(raw).digest();
}

export function hasSecretEncryptionKey() {
  return !!keyMaterial();
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(value) {
  if (!value) return value || null;
  if (isEncryptedSecret(value)) return value;
  const key = keyMaterial();
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function decryptSecret(value) {
  if (!value) return value || '';
  if (!isEncryptedSecret(value)) return value;
  const key = keyMaterial();
  if (!key) {
    throw new Error('PLATFORM_CONFIG_ENCRYPTION_KEY is required to decrypt stored platform secrets.');
  }
  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url');
  if (payload.length < 29) throw new Error('Stored platform secret is invalid.');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
