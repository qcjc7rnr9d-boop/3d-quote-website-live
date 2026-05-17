export function ensureEmbedSettingsColumns(db) {
  const cols = db.prepare('PRAGMA table_info(store_settings)').all().map(c => c.name);
  if (!cols.includes('embed_allowed_origins')) {
    db.exec("ALTER TABLE store_settings ADD COLUMN embed_allowed_origins TEXT NOT NULL DEFAULT '[]'");
  }
}

function valuesFromInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input
      .split(/[\n,]/)
      .map(value => value.trim())
      .filter(Boolean);
  }
  if (input == null) return [];
  throw new Error('Embed origins must be a list of website origins.');
}

function normaliseOrigin(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Invalid embed origin: ${text}`);
  }

  const isLocalHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`Embed origin must use HTTPS: ${text}`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error(`Embed origin must be only a scheme, host, and optional port: ${text}`);
  }

  return url.origin;
}

export function normaliseEmbedAllowedOrigins(input) {
  const seen = new Set();
  const origins = [];
  for (const value of valuesFromInput(input)) {
    const origin = normaliseOrigin(value);
    if (origin && !seen.has(origin)) {
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

export function parseEmbedAllowedOrigins(value) {
  try {
    return normaliseEmbedAllowedOrigins(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}

export function frameAncestorsForOrigins(origins) {
  const allowed = normaliseEmbedAllowedOrigins(origins);
  return ["'self'", ...allowed].join(' ');
}
