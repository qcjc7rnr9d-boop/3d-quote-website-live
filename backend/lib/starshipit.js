/**
 * Starshipit Rates API client
 * Docs: https://api-docs.starshipit.com/
 *
 * Auth: API key via "StarShipIT-Api-Key" request header (no token exchange needed)
 * Rates: POST https://api.starshipit.com/api/rates
 *
 * Starshipit is a NZ/AU multi-carrier aggregator — a single call returns rates
 * from all carriers connected to the account (NZ Post, Aramex, NZ Couriers,
 * Castle Parcels, PostHaste, PBT, DHL, etc.)
 */

const RATES_URL = 'https://api.starshipit.com/api/rates';

/**
 * Fetch live domestic rates from Starshipit.
 *
 * @param {object} opts
 * @param {string} opts.apiKey          Starshipit account API key
 * @param {string} opts.fromPostcode    NZ postcode of dispatch location (4-digit)
 * @param {string} opts.toPostcode      NZ postcode of delivery destination
 * @param {number} opts.weightKg        Total parcel weight in kg
 * @param {number} [opts.lengthCm]      Longest dimension (cm) — optional
 * @param {number} [opts.widthCm]       Width (cm) — optional
 * @param {number} [opts.heightCm]      Height (cm) — optional
 * @returns {Promise<Array>}            Normalised rate objects
 */
export async function getStarshipitRates({
  apiKey,
  fromPostcode,
  toPostcode,
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
}) {
  const pkg = { weight: parseFloat(weightKg.toFixed(3)) };
  if (lengthCm) pkg.length = Math.max(1, Math.ceil(lengthCm));
  if (widthCm)  pkg.width  = Math.max(1, Math.ceil(widthCm));
  if (heightCm) pkg.height = Math.max(1, Math.ceil(heightCm));

  const body = {
    destination: { post_code: String(toPostcode),   country_code: 'NZ' },
    sender:      { post_code: String(fromPostcode),  country_code: 'NZ' },
    packages:    [pkg],
  };

  const res = await fetch(RATES_URL, {
    method:  'POST',
    headers: {
      'Content-Type':     'application/json',
      'StarShipIT-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Starshipit rates ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();

  // Starshipit wraps rates under various keys depending on API version
  const raw = data.rates ?? data.services ?? data.options ?? [];

  return raw
    .map(r => {
      // Field name variants seen across Starshipit API versions
      const carrier     = r.carrier_name   ?? r.carrier    ?? r.courier_name ?? 'Courier';
      const service     = r.service_name   ?? r.name       ?? r.service      ?? carrier;
      const price       = parseFloat(r.total ?? r.price ?? r.rate ?? r.cost ?? 0);
      const minDays     = r.min_days ?? r.estimated_days ?? r.transit_days ?? 1;
      const maxDays     = r.max_days ?? r.estimated_days ?? r.transit_days ?? 5;
      const isExpress   = String(service).toLowerCase().includes('express')
                       || String(service).toLowerCase().includes('overnight')
                       || maxDays <= 1;

      return {
        carrier,
        service,
        description: r.description ?? '',
        price,
        currency:    'NZD',
        est_days_min: minDays,
        est_days_max: maxDays,
        is_express:   isExpress,
        available:    true,
        source:       'starshipit',
      };
    })
    .filter(r => r.price > 0);
}
