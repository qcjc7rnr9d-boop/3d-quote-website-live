import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, MIN_PASSWORD_LENGTH, RESET_TOKEN_HOURS } from '../config.js';

export const PLATFORM_ADMIN_ID = 1;

export function ensurePlatformAdmin() {
  db.prepare('INSERT OR IGNORE INTO platform_admins (id) VALUES (?)').run(PLATFORM_ADMIN_ID);
  return getPlatformAdmin();
}

export function getPlatformAdmin() {
  return db.prepare('SELECT * FROM platform_admins WHERE id = ?').get(PLATFORM_ADMIN_ID) || null;
}

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validatePlatformPassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

export async function verifyPlatformPassword(password) {
  const admin = ensurePlatformAdmin();
  if (admin?.password_hash && await bcrypt.compare(password || '', admin.password_hash)) {
    return true;
  }
  return !!(process.env.PLATFORM_ADMIN_PASSWORD && password === process.env.PLATFORM_ADMIN_PASSWORD);
}

export async function bootstrapPlatformAdmin(email, password) {
  const ownerEmail = normaliseEmail(email);
  if (!ownerEmail || !ownerEmail.includes('@')) return null;
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare(`
    UPDATE platform_admins
    SET owner_email = ?,
        password_hash = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(ownerEmail, hash, PLATFORM_ADMIN_ID);
  return getPlatformAdmin();
}

export async function updatePlatformAdminAccount({ ownerEmail, newPassword }) {
  ensurePlatformAdmin();
  const nextEmail = ownerEmail !== undefined ? normaliseEmail(ownerEmail) : getPlatformAdmin()?.owner_email;
  const passwordHash = newPassword
    ? await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    : getPlatformAdmin()?.password_hash;

  db.prepare(`
    UPDATE platform_admins
    SET owner_email = ?,
        password_hash = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextEmail || null, passwordHash || null, PLATFORM_ADMIN_ID);

  return getPlatformAdmin();
}

export function createPlatformResetToken() {
  const admin = ensurePlatformAdmin();
  const token = jwt.sign(
    { platformAdminId: PLATFORM_ADMIN_ID, purpose: 'platform_password_reset' },
    process.env.JWT_SECRET,
    { expiresIn: `${RESET_TOKEN_HOURS}h` }
  );

  db.prepare(`
    INSERT INTO platform_reset_tokens (admin_id, token, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).run(admin.id, token, `+${RESET_TOKEN_HOURS} hour`);

  return token;
}

export function verifyPlatformResetToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT * FROM platform_reset_tokens
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token);
  if (!row) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== 'platform_password_reset' || payload.platformAdminId !== PLATFORM_ADMIN_ID) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function markPlatformResetTokenUsed(token) {
  db.prepare('UPDATE platform_reset_tokens SET used = 1 WHERE token = ?').run(token);
}
