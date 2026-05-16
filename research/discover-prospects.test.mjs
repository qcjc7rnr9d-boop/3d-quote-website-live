import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildQueries, normaliseSeedUrls, placesTextSearch, refreshLeadEvidence, runDiscovery } from './discover-prospects.mjs';

test('buildQueries supports country presets and area-based global searches', () => {
  const australia = buildQueries({
    areas: ['Sydney'],
    keywords: ['custom FDM 3D printing service', 'upload STL 3D printing'],
    countryName: 'Australia',
    maxQueries: 10,
  });
  assert.deepEqual(australia.slice(0, 2), [
    'custom FDM 3D printing service Sydney Australia',
    'upload STL 3D printing Sydney Australia',
  ]);

  const unitedStates = buildQueries({
    areas: ['Los Angeles'],
    keywords: ['custom 3D print quote'],
    countryName: 'United States',
  });
  assert.equal(unitedStates[0], 'custom 3D print quote Los Angeles United States');

  const customGlobal = buildQueries({
    areas: ['Berlin Germany'],
    keywords: ['custom FDM 3D printing service'],
    countryName: '',
  });
  assert.equal(customGlobal[0], 'custom FDM 3D printing service Berlin Germany');
});

test('buildQueries keeps old cities input as areas and defaults to New Zealand', () => {
  const queries = buildQueries({
    cities: ['Auckland'],
    keywords: ['custom FDM 3D printing service'],
    maxQueries: 3,
  });

  assert.equal(queries[0], 'custom FDM 3D printing service Auckland New Zealand');
  assert.ok(queries.every(query => /New Zealand/.test(query)));
});

test('placesTextSearch uses selected regionCode instead of hard-coded NZ', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  try {
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ places: [] }),
      };
    };

    await placesTextSearch('fake-api-key', 'custom FDM 3D printing service Sydney Australia', 5, {
      regionCode: 'AU',
      countryName: 'Australia',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.regionCode, 'AU');
  assert.equal(requestBody.textQuery, 'custom FDM 3D printing service Sydney Australia');
});

test('normaliseSeedUrls strips tracking noise and dedupes seed websites', () => {
  const seeds = normaliseSeedUrls([
    'Davis Customs - https://daviscustom3dprints.com/pages/custom-orders?_su_rec=abc&_su_rec_id=123',
    'https://daviscustom3dprints.com/pages/custom-orders',
    'https://www.formtech.co.nz/?srsltid=tracking',
  ]);

  assert.equal(seeds.length, 2);
  assert.equal(seeds[0].company_name, 'Davis Customs');
  assert.equal(seeds[0].website, 'https://daviscustom3dprints.com/pages/custom-orders');
  assert.equal(seeds[1].website, 'https://www.formtech.co.nz/');
});

test('runDiscovery can audit seed URLs without a Google Places key', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-seed-')), 'discovered');
  let placesCalls = 0;
  let crawlCalls = 0;

  const result = await runDiscovery('', {
    seedUrls: [
      'https://lainleys3dprinting.com/pages/custom-order',
      'https://printer-supplier.example/shop',
    ],
    cities: [],
    keywords: [],
    maxQueries: 0,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 2,
    targetScope: 'target_review',
    outputBase,
    placesTextSearch: async () => {
      placesCalls++;
      return [];
    },
    crawlWebsite: async url => {
      crawlCalls++;
      if (url.includes('printer-supplier')) {
        return [{ url, text: 'Buy PLA filament, printers, accessories, nozzles and spare parts. Add to cart.' }];
      }
      return [{ url, text: 'Custom order 3D printing service: send STL files for FDM PLA and PETG prints. Request a quote.' }];
    },
  });

  assert.equal(placesCalls, 0);
  assert.equal(crawlCalls, 2);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].custom_fdm_status, 'target_confirmed');
  assert.equal(result.skippedLeads.length, 1);
  assert.equal(result.skippedLeads[0].custom_fdm_status, 'not_target');
});

test('runDiscovery skips already-added candidates before crawling websites', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-skip-')), 'discovered');
  let crawlCalls = 0;

  const result = await runDiscovery('fake-api-key', {
    cities: ['Auckland'],
    keywords: ['custom FDM 3D printing service'],
    maxQueries: 1,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 1,
    targetScope: 'target_review',
    outputBase,
    knownLeadKeys: ['web:known.example'],
    placesTextSearch: async () => [
      {
        google_place_id: 'places/known',
        company_name: 'Known FDM',
        website: 'https://known.example/',
        phone: '09 123 4567',
        google_rating: 5,
        google_review_count: 12,
      },
    ],
    crawlWebsite: async () => {
      crawlCalls++;
      return [{ url: 'https://known.example', text: 'Custom FDM 3D printing service using PLA.' }];
    },
  });

  assert.equal(crawlCalls, 0);
  assert.equal(result.records.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.existingSkipped.length, 1);
  assert.equal(result.existingSkipped[0].company_name, 'Known FDM');
  assert.match(result.existingSkipped[0].reason, /already-added/i);
});

test('runDiscovery keeps querying until requested fresh importable leads are found', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-fill-new-')), 'discovered');
  const knownLeadKeys = Array.from({ length: 5 }, (_, index) => `web:known-${index}.example`);
  const keywords = Array.from({ length: 20 }, (_, index) => `custom FDM service ${index}`);
  let placesCalls = 0;
  let crawlCalls = 0;

  const result = await runDiscovery('fake-api-key', {
    cities: ['Auckland'],
    keywords,
    maxQueries: 20,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 1,
    newLeadTarget: 10,
    queryDelayMs: 0,
    targetScope: 'target_review',
    outputBase,
    knownLeadKeys,
    placesTextSearch: async () => {
      const index = placesCalls++;
      if (index < 5) {
        return [{
          company_name: `Known ${index}`,
          website: `https://known-${index}.example/`,
          google_place_id: `places/known-${index}`,
        }];
      }
      const freshIndex = index - 5;
      return [{
        company_name: `Fresh FDM ${freshIndex}`,
        website: `https://fresh-${freshIndex}.example/`,
        google_place_id: `places/fresh-${freshIndex}`,
        google_review_count: 8 + freshIndex,
      }];
    },
    crawlWebsite: async url => {
      crawlCalls++;
      return [{ url, text: 'Custom FDM 3D printing service using PLA and PETG. Request a quote.' }];
    },
  });

  assert.equal(result.requestedNewLeads, 10);
  assert.equal(result.newLeadCount, 10);
  assert.equal(result.queriesAttempted, 15);
  assert.equal(placesCalls, 15);
  assert.equal(crawlCalls, 10);
  assert.equal(result.leads.length, 10);
  assert.equal(result.existingSkipped.length, 5);
});

test('runDiscovery preserves non-NZ country context on discovered leads', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-au-')), 'discovered');

  const result = await runDiscovery('fake-api-key', {
    areas: ['Sydney'],
    countryName: 'Australia',
    regionCode: 'AU',
    keywords: ['custom FDM 3D printing service'],
    maxQueries: 1,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 1,
    newLeadTarget: 1,
    queryDelayMs: 0,
    targetScope: 'target_review',
    outputBase,
    placesTextSearch: async (_apiKey, query, _maxResults, searchOptions) => [{
      company_name: 'Sydney FDM',
      website: 'https://sydney-fdm.example/',
      google_place_id: 'places/sydney-fdm',
      discovery_source_query: query,
      region: searchOptions.countryName,
      country: searchOptions.countryName,
    }],
    crawlWebsite: async url => [
      { url, text: 'Custom FDM 3D printing service using PLA and PETG. Request a quote.' },
    ],
  });

  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].region, 'Australia');
  assert.match(result.leads[0].source, /Sydney Australia/);
});

test('runDiscovery skips already-added candidates by place, website, phone, and name before crawling', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-known-keys-')), 'discovered');
  let crawlCalls = 0;

  const result = await runDiscovery('fake-api-key', {
    cities: ['Auckland'],
    keywords: ['custom FDM 3D printing service'],
    maxQueries: 1,
    maxResultsPerQuery: 4,
    maxPagesPerSite: 1,
    newLeadTarget: 4,
    queryDelayMs: 0,
    targetScope: 'target_review',
    outputBase,
    knownLeadKeys: [
      'place:places/place-match',
      'web:existing-site.example',
      'phone:021123456',
      'name:knowncompanylimited',
    ],
    placesTextSearch: async () => [
      { company_name: 'Place Match', website: 'https://place-match.example', google_place_id: 'places/place-match' },
      { company_name: 'Website Match', website: 'https://www.existing-site.example/' },
      { company_name: 'Phone Match', website: 'https://phone-match.example', phone: '021 123 456' },
      { company_name: 'Known Company Limited', website: 'https://name-match.example' },
    ],
    crawlWebsite: async () => {
      crawlCalls++;
      return [{ url: 'https://should-not-crawl.example', text: 'Custom FDM 3D printing service using PLA.' }];
    },
  });

  assert.equal(crawlCalls, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.existingSkipped.length, 4);
  assert.ok(result.existingSkipped.every(skip => skip.matched_keys.length >= 1));
});

test('runDiscovery skips email-only duplicates discovered after crawling', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-email-dup-')), 'discovered');
  let crawlCalls = 0;

  const result = await runDiscovery('fake-api-key', {
    cities: ['Auckland'],
    keywords: ['custom FDM 3D printing service'],
    maxQueries: 1,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 1,
    newLeadTarget: 1,
    queryDelayMs: 0,
    targetScope: 'target_review',
    outputBase,
    knownLeadKeys: ['email:hello@example.nz'],
    placesTextSearch: async () => [{
      company_name: 'Email Duplicate FDM',
      website: 'https://email-duplicate.example/',
      google_place_id: 'places/email-duplicate',
    }],
    crawlWebsite: async url => {
      crawlCalls++;
      return [{ url, text: 'Custom FDM 3D printing service with PLA. Email hello@example.nz for a quote.' }];
    },
  });

  assert.equal(crawlCalls, 1);
  assert.equal(result.records.length, 0);
  assert.equal(result.leads.length, 0);
  assert.equal(result.existingSkipped.length, 1);
  assert.deepEqual(result.existingSkipped[0].matched_keys, ['email:hello@example.nz']);
});

test('runDiscovery updates in-run known keys so duplicate results do not get crawled twice', async () => {
  const outputBase = join(await mkdtemp(join(tmpdir(), 'prospect-run-dup-')), 'discovered');
  let placesCalls = 0;
  let crawlCalls = 0;

  const result = await runDiscovery('fake-api-key', {
    cities: ['Auckland'],
    keywords: ['query one', 'query two', 'query three'],
    maxQueries: 3,
    maxResultsPerQuery: 1,
    maxPagesPerSite: 1,
    newLeadTarget: 2,
    queryDelayMs: 0,
    targetScope: 'target_review',
    outputBase,
    knownLeadKeys: [],
    placesTextSearch: async () => {
      placesCalls++;
      if (placesCalls === 1) return [{ company_name: 'Fresh One', website: 'https://fresh-one.example/', google_place_id: 'places/fresh-one' }];
      if (placesCalls === 2) return [{ company_name: 'Fresh One Duplicate', website: 'https://fresh-one.example/', google_place_id: 'places/fresh-one' }];
      return [{ company_name: 'Fresh Two', website: 'https://fresh-two.example/', google_place_id: 'places/fresh-two' }];
    },
    crawlWebsite: async url => {
      crawlCalls++;
      return [{ url, text: 'Custom FDM 3D printing service using PLA and PETG. Request a quote.' }];
    },
  });

  assert.equal(result.queriesAttempted, 3);
  assert.equal(result.newLeadCount, 2);
  assert.equal(crawlCalls, 2);
  assert.equal(result.leads.length, 2);
  assert.equal(result.existingSkipped.length, 1);
  assert.match(result.existingSkipped[0].reason, /same discovery run/i);
});

test('refreshLeadEvidence re-crawls one lead and regenerates deck evidence', async () => {
  let crawlCalls = 0;
  const refreshed = await refreshLeadEvidence('fake-api-key', {
    company_name: 'Refresh Deck FDM',
    website: 'https://refresh-deck.example',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
    pitch_angle: 'Manual pitch stays.',
  }, {
    now: '2026-05-14T00:00:00.000Z',
    maxPagesPerSite: 2,
    placesTextSearch: async () => [
      {
        google_place_id: 'places/refresh-deck',
        company_name: 'Refresh Deck FDM',
        website: 'https://refresh-deck.example',
        phone: '09 111 2222',
        google_rating: 4.7,
        google_review_count: 18,
      },
    ],
    crawlWebsite: async () => {
      crawlCalls++;
      return [
        {
          url: 'https://refresh-deck.example',
          title: 'Refresh Deck FDM',
          text: 'Custom FDM 3D printing service with PLA and PETG. Request a quote for your STL file.',
        },
      ];
    },
  });

  assert.equal(crawlCalls, 1);
  assert.equal(refreshed.custom_fdm_status, 'target_confirmed');
  assert.equal(refreshed.quote_system, 'manual_form');
  assert.equal(refreshed.google_review_count, 18);
  assert.equal(refreshed.pitch_angle, 'Manual pitch stays.');
  assert.equal(refreshed.deck_last_checked_at, '2026-05-14T00:00:00.000Z');
  assert.equal(refreshed.pitch_deck.status, 'ready');
  assert.ok(refreshed.deck_evidence.some(item => item.source_type === 'website'));
});
