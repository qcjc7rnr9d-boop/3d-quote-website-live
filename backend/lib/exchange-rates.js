export const EXCHANGE_RATE_PROVIDER = 'Frankfurter';
export const EXCHANGE_RATE_BASE = 'NZD';
export const SUPPORTED_DISPLAY_CURRENCIES = [
  'NZD', 'AUD', 'USD', 'GBP', 'EUR', 'CAD', 'JPY', 'SGD', 'HKD', 'CHF', 'CNY',
];

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
const FRANKFURTER_URL = process.env.EXCHANGE_RATE_URL || 'https://api.frankfurter.app/latest';

function sqlDate(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseSqlDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) ? date : null;
}

function normaliseCurrency(value) {
  return String(value || '').trim().toUpperCase();
}

export function normaliseQuoteCurrencies(quotes = SUPPORTED_DISPLAY_CURRENCIES) {
  const values = Array.isArray(quotes)
    ? quotes
    : String(quotes || '').split(',');
  const seen = new Set();
  for (const value of values) {
    const code = normaliseCurrency(value);
    if (SUPPORTED_DISPLAY_CURRENCIES.includes(code)) seen.add(code);
  }
  if (!seen.size) {
    SUPPORTED_DISPLAY_CURRENCIES.forEach(code => seen.add(code));
  }
  seen.add(EXCHANGE_RATE_BASE);
  return [...seen];
}

export function ensureExchangeRateCache(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rate_cache (
      provider TEXT NOT NULL,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      provider_date TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (provider, base_currency, quote_currency)
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_rate_cache_fetched
      ON exchange_rate_cache(provider, base_currency, fetched_at);
  `);
}

function cacheRows(db, base, quotes) {
  ensureExchangeRateCache(db);
  const rows = db.prepare(`
    SELECT quote_currency, rate, provider_date, fetched_at
    FROM exchange_rate_cache
    WHERE provider = ? AND base_currency = ? AND quote_currency IN (${quotes.map(() => '?').join(',')})
  `).all(EXCHANGE_RATE_PROVIDER, base, ...quotes);
  return new Map(rows.map(row => [row.quote_currency, row]));
}

function responseFromRows({ base, quotes, rows, now, stale }) {
  const rates = { [base]: 1 };
  let providerDate = null;
  let fetchedAt = null;
  for (const code of quotes) {
    if (code === base) continue;
    const row = rows.get(code);
    if (!row) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[code] = rate;
    providerDate ||= row.provider_date || null;
    fetchedAt ||= row.fetched_at || null;
  }
  return {
    base,
    rates,
    provider: EXCHANGE_RATE_PROVIDER,
    providerDate,
    fetchedAt,
    stale: !!stale,
    supportedCurrencies: SUPPORTED_DISPLAY_CURRENCIES,
    generatedAt: now.toISOString(),
  };
}

function hasFreshRows(rows, quotes, now, maxAgeMs) {
  for (const code of quotes) {
    if (code === EXCHANGE_RATE_BASE) continue;
    const row = rows.get(code);
    if (!row) return false;
    const fetched = parseSqlDate(row.fetched_at);
    if (!fetched || now.getTime() - fetched.getTime() > maxAgeMs) return false;
  }
  return true;
}

async function fetchFrankfurterRates({ base, quotes, fetchImpl }) {
  const providerQuotes = quotes.filter(code => code !== base);
  if (!providerQuotes.length) return { date: null, rates: {} };

  const url = new URL(FRANKFURTER_URL);
  if (url.pathname.includes('latest')) {
    url.searchParams.set('from', base);
    url.searchParams.set('to', providerQuotes.join(','));
  } else {
    url.searchParams.set('base', base);
    url.searchParams.set('quotes', providerQuotes.join(','));
  }

  const res = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Frankfurter returned ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) {
    const rates = {};
    for (const row of data) {
      const quote = normaliseCurrency(row?.quote);
      const rate = Number(row?.rate);
      if (providerQuotes.includes(quote) && Number.isFinite(rate) && rate > 0) {
        rates[quote] = rate;
      }
    }
    return {
      date: data.find(row => row?.date)?.date || null,
      rates,
    };
  }
  const rates = data?.rates || {};
  return {
    date: data?.date || null,
    rates,
  };
}

function writeRates(db, { base, rates, providerDate, fetchedAt }) {
  ensureExchangeRateCache(db);
  const stmt = db.prepare(`
    INSERT INTO exchange_rate_cache
      (provider, base_currency, quote_currency, rate, provider_date, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, base_currency, quote_currency)
    DO UPDATE SET
      rate = excluded.rate,
      provider_date = excluded.provider_date,
      fetched_at = excluded.fetched_at
  `);
  db.exec('BEGIN');
  try {
    for (const [quote, rate] of Object.entries(rates)) {
      const numericRate = Number(rate);
      if (!Number.isFinite(numericRate) || numericRate <= 0) continue;
      stmt.run(EXCHANGE_RATE_PROVIDER, base, quote, numericRate, providerDate, fetchedAt);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

export async function getExchangeRates(db, options = {}) {
  const base = normaliseCurrency(options.base || EXCHANGE_RATE_BASE);
  if (base !== EXCHANGE_RATE_BASE) {
    const err = new Error('Only NZD display conversion is supported.');
    err.status = 400;
    throw err;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : DEFAULT_MAX_AGE_MS;
  const quotes = normaliseQuoteCurrencies(options.quotes);
  const rows = cacheRows(db, base, quotes);

  if (hasFreshRows(rows, quotes, now, maxAgeMs)) {
    return responseFromRows({ base, quotes, rows, now, stale: false });
  }

  try {
    const fetchedAt = sqlDate(now);
    const provider = await fetchFrankfurterRates({
      base,
      quotes,
      fetchImpl: options.fetchImpl || globalThis.fetch,
    });
    writeRates(db, {
      base,
      rates: provider.rates,
      providerDate: provider.date,
      fetchedAt,
    });
    const freshRows = cacheRows(db, base, quotes);
    return responseFromRows({ base, quotes, rows: freshRows, now, stale: false });
  } catch (err) {
    if (rows.size) {
      return {
        ...responseFromRows({ base, quotes, rows, now, stale: true }),
        error: 'Exchange rate provider unavailable; showing last cached rates.',
      };
    }
    return {
      base,
      rates: { [base]: 1 },
      provider: EXCHANGE_RATE_PROVIDER,
      providerDate: null,
      fetchedAt: null,
      stale: true,
      supportedCurrencies: SUPPORTED_DISPLAY_CURRENCIES,
      generatedAt: now.toISOString(),
      error: 'Exchange rate provider unavailable; showing NZD only.',
    };
  }
}
