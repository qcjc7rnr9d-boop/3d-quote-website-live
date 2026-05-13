/**
 * NZ Post Domestic Rates API client
 * Register & get credentials: https://www.nzpost.co.nz/business/ecommerce/developer-resource-centre
 * Docs: https://www.nzpost.co.nz/business/ecommerce/developer-resource-centreapi/shipping-options-domestic
 *
 * Auth: OAuth2 client-credentials → Bearer token (1-hour TTL, cached here)
 * Rates: GET /shippingoptions/2.0/domestic
 */

const TOKEN_URL = 'https://oauth.nzpost.co.nz/as/token.oauth2';
const RATES_URL = 'https://api.nzpost.co.nz/shippingoptions/2.0/domestic';

// Token cache keyed by clientId — avoids a token round-trip on every quote
const _cache = new Map();

async function getToken(clientId, clientSecret) {
  const cached = _cache.get(clientId);
  if (cached && Date.now() < cached.expiry) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NZ Post auth ${res.status}: ${text.slice(0, 200)}`);
  }

  const data  = await res.json();
  const token = data.access_token;
  // Subtract 60 s buffer so we refresh before actual expiry
  const expiry = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  _cache.set(clientId, { token, expiry });
  return token;
}

/**
 * Fetch live domestic rates from NZ Post.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.fromPostcode  NZ postcode (4-digit string)
 * @param {string} opts.toPostcode
 * @param {number} opts.weightKg      Package weight in kg
 * @param {number} opts.lengthCm      Longest dimension in cm
 * @param {number} opts.widthCm
 * @param {number} opts.heightCm
 * @returns {Promise<Array>} Normalised rate objects
 */
export async function getNzPostRates({
  clientId, clientSecret,
  fromPostcode, toPostcode,
  weightKg, lengthCm, widthCm, heightCm,
}) {
  const token = await getToken(clientId, clientSecret);

  const params = new URLSearchParams({
    from_postcode: String(fromPostcode),
    to_postcode:   String(toPostcode),
    weight:        Number(weightKg).toFixed(3),
    length:        String(Math.max(1, Math.ceil(lengthCm))),
    width:         String(Math.max(1, Math.ceil(widthCm))),
    height:        String(Math.max(1, Math.ceil(heightCm))),
  });

  const res = await fetch(`${RATES_URL}?${params}`, {
    headers: {
      client_id:     clientId,
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NZ Post rates ${res.status}: ${text.slice(0, 300)}`);
  }

  const data     = await res.json();
  // API may return products under different keys depending on version
  const products = data.products ?? data.options ?? data.services ?? [];

  return products
    .map(p => ({
      carrier:      'NZ Post',
      service:      p.service_type   ?? p.description ?? 'Courier',
      description:  p.description    ?? p.service_type ?? '',
      price:        parseFloat(p.price ?? p.total_price ?? p.rate ?? 0),
      currency:     'NZD',
      est_days_min: p.min_transit_days ?? 1,
      est_days_max: p.max_transit_days ?? 3,
      is_express:   (p.max_transit_days ?? 3) <= 1,
      available:    true,
      source:       'nzpost',
    }))
    .filter(r => r.price > 0);
}
