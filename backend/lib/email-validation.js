export function normaliseEmailAddress(value) {
  return String(value || '').trim().toLowerCase();
}

export function isSafeEmailAddress(value) {
  const email = normaliseEmailAddress(value);
  if (!email || email.length > 254) return false;
  if (/[\u0000-\u001F\u007F<>"`\\]/.test(email)) return false;
  if (email.includes('..')) return false;

  const [local, domain, ...extra] = email.split('@');
  if (!local || !domain || extra.length) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_~-]+$/.test(local)) return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
  if (domain.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-'))) return false;
  return true;
}
