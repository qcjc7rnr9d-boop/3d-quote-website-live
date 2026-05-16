import { DatabaseSync } from 'node:sqlite';
import {
  SUPPORTED_DISPLAY_CURRENCIES,
  getExchangeRates,
} from '../lib/exchange-rates.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const db = new DatabaseSync(':memory:');

let fetchCalls = 0;
const successFetch = async () => {
  fetchCalls += 1;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      base: 'NZD',
      date: '2026-05-15',
      rates: {
        AUD: 0.92,
        USD: 0.61,
        GBP: 0.49,
        EUR: 0.57,
        CAD: 0.84,
        JPY: 95.12,
        SGD: 0.79,
        HKD: 4.73,
        CHF: 0.54,
        CNY: 4.39,
      },
    }),
  };
};

const fresh = await getExchangeRates(db, {
  base: 'NZD',
  quotes: ['AUD', 'USD', 'ABC', 'NZD'],
  fetchImpl: successFetch,
  now: new Date('2026-05-15T01:00:00Z'),
});

assert(fetchCalls === 1, 'Expected provider fetch for missing rates');
assert(fresh.base === 'NZD', 'Base currency should be NZD');
assert(fresh.provider === 'Frankfurter', 'Provider should be Frankfurter');
assert(fresh.providerDate === '2026-05-15', 'Provider date should be preserved');
assert(fresh.stale === false, 'Fresh provider response must not be stale');
assert(fresh.rates.NZD === 1, 'NZD self-rate should always be 1');
assert(fresh.rates.AUD === 0.92, 'AUD rate should come from provider');
assert(fresh.rates.USD === 0.61, 'USD rate should come from provider');
assert(!('ABC' in fresh.rates), 'Unsupported currencies must be ignored');
assert(SUPPORTED_DISPLAY_CURRENCIES.includes('CNY'), 'Major currency set should include CNY');

const rowShape = await getExchangeRates(new DatabaseSync(':memory:'), {
  base: 'NZD',
  quotes: ['AUD', 'USD'],
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      { date: '2026-05-15', base: 'NZD', quote: 'AUD', rate: 0.8199 },
      { date: '2026-05-15', base: 'NZD', quote: 'USD', rate: 0.5931 },
    ]),
  }),
  now: new Date('2026-05-15T01:30:00Z'),
});
assert(rowShape.providerDate === '2026-05-15', 'Row-shaped provider date should be preserved');
assert(rowShape.rates.AUD === 0.8199, 'Row-shaped provider AUD rate should parse');
assert(rowShape.rates.USD === 0.5931, 'Row-shaped provider USD rate should parse');

const stale = await getExchangeRates(db, {
  base: 'NZD',
  quotes: ['AUD', 'USD'],
  fetchImpl: async () => {
    fetchCalls += 1;
    throw new Error('provider down');
  },
  now: new Date('2026-05-15T03:00:00Z'),
  maxAgeMs: 0,
});

assert(fetchCalls === 2, 'Expected provider refresh attempt after cache expiry');
assert(stale.stale === true, 'Provider failure should return cached rates as stale');
assert(stale.rates.AUD === 0.92, 'Stale response should preserve cached AUD');
assert(stale.rates.USD === 0.61, 'Stale response should preserve cached USD');

const fallback = await getExchangeRates(new DatabaseSync(':memory:'), {
  base: 'NZD',
  quotes: ['AUD', 'USD'],
  fetchImpl: async () => {
    throw new Error('provider down');
  },
  now: new Date('2026-05-15T03:00:00Z'),
});

assert(fallback.stale === true, 'No-cache provider failure should be marked stale');
assert(fallback.rates.NZD === 1, 'No-cache failure should still return NZD fallback');
assert(!fallback.rates.AUD, 'No-cache failure must not invent AUD rates');

console.log('Exchange rate smoke checks passed.');
