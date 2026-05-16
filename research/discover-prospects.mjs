#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  classifyWebsitePages,
  dedupePlaces,
  discoveryRecordToLead,
  normalisePlaceResult,
  stripHtml,
} = require('./prospect-discovery-core.cjs');
const {
  candidateIdentityKeys,
  hasKnownIdentity,
  leadIdentityKeys,
  leadsToResearchCsv,
  refreshLeadFromDiscoveryData,
  sanitizeIdentityKeys,
} = require('./prospect-research-core.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.types',
].join(',');

const DEFAULT_CITIES = [
  'Auckland',
  'Wellington',
  'Christchurch',
  'Hamilton',
  'Tauranga',
  'Dunedin',
  'Nelson',
  'Queenstown',
  'Palmerston North',
  'New Plymouth',
  'Whangarei',
  'Napier',
];

export const COUNTRY_PRESETS = {
  nz: {
    label: 'New Zealand',
    countryName: 'New Zealand',
    regionCode: 'NZ',
    areas: DEFAULT_CITIES,
  },
  au: {
    label: 'Australia',
    countryName: 'Australia',
    regionCode: 'AU',
    areas: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle'],
  },
  us: {
    label: 'United States',
    countryName: 'United States',
    regionCode: 'US',
    areas: ['Los Angeles', 'New York', 'Chicago', 'Houston', 'Phoenix', 'Seattle', 'San Francisco', 'Austin'],
  },
  uk: {
    label: 'United Kingdom',
    countryName: 'United Kingdom',
    regionCode: 'GB',
    areas: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Bristol', 'Liverpool', 'Edinburgh'],
  },
  ca: {
    label: 'Canada',
    countryName: 'Canada',
    regionCode: 'CA',
    areas: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton', 'Winnipeg', 'Quebec City'],
  },
  global: {
    label: 'Custom / Global',
    countryName: '',
    regionCode: '',
    areas: ['Sydney Australia', 'Los Angeles United States', 'Manchester United Kingdom'],
  },
};

const DEFAULT_KEYWORDS = [
  'custom FDM 3D printing service',
  'PLA PETG 3D printing service',
  'upload STL 3D printing',
  'custom 3D print quote',
  'custom order 3D printing miniatures',
  'send STL 3D printing service',
];

const AUTO_IMPORT_TARGETS = new Set(['target_confirmed', 'target_likely', 'review_needed']);
const STRICT_TARGETS = new Set(['target_confirmed', 'target_likely']);

const LINK_KEYWORDS = [
  '3d',
  'print',
  'fdm',
  'pla',
  'petg',
  'quote',
  'custom',
  'upload',
  'order',
  'service',
  'contact',
  'pricing',
  'price',
  'commission',
  'commissions',
  'miniature',
  'miniatures',
  'tabletop',
  'terrain',
  'stl',
  'cad',
  'materials',
  'shopify',
];

const SKIP_PATHS = [
  '/account',
  '/admin',
  '/cart',
  '/login',
  '/privacy',
  '/terms',
  '/search',
  '/wp-admin',
];

export function parseArgs(argv) {
  const options = {
    cities: DEFAULT_CITIES,
    countryPreset: 'nz',
    keywords: DEFAULT_KEYWORDS,
    maxQueries: Infinity,
    maxResultsPerQuery: 20,
    maxPagesPerSite: 6,
    newLeadTarget: Infinity,
    targetScope: 'target_review',
    outputBase: join(DATA_DIR, 'discovered-prospects'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--cities' && next) {
      options.cities = next.split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--areas' && next) {
      options.areas = next.split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--country' && next) {
      options.countryPreset = next;
      i++;
    } else if (arg === '--keywords' && next) {
      options.keywords = next.split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--max-queries' && next) {
      options.maxQueries = Number(next) || options.maxQueries;
      i++;
    } else if (arg === '--max-results' && next) {
      options.maxResultsPerQuery = Number(next) || options.maxResultsPerQuery;
      i++;
    } else if (arg === '--new-leads' && next) {
      options.newLeadTarget = Number(next) || options.newLeadTarget;
      i++;
    } else if (arg === '--max-pages' && next) {
      options.maxPagesPerSite = Number(next) || options.maxPagesPerSite;
      i++;
    } else if (arg === '--target-scope' && next) {
      options.targetScope = next;
      i++;
    } else if (arg === '--seed-url' && next) {
      options.seedUrls = [...(options.seedUrls || []), next];
      i++;
    } else if (arg === '--seed-file' && next) {
      options.seedFile = next;
      i++;
    } else if (arg === '--out' && next) {
      options.outputBase = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  GOOGLE_PLACES_API_KEY=... node research/discover-prospects.mjs [options]

Options:
  --country au                         Country preset: nz, au, us, uk, ca, or global.
  --areas "Sydney,Melbourne"           Comma-separated cities, regions, or metro areas.
  --cities "Auckland,Wellington"       Backwards-compatible alias for --areas.
  --keywords "3D printing service"     Comma-separated search keywords.
  --max-queries 2                      Limit Places queries for smoke tests.
  --new-leads 10                       Stop after this many fresh importable leads.
  --max-results 10                     Max Places results per query.
  --max-pages 5                        Max website pages to crawl per business.
  --target-scope target_review         target_review or target_only.
  --seed-url "https://example.com"     Add one seed website to crawl directly.
  --seed-file research/data/seeds.txt  Crawl seed URLs from a text/CSV file.
  --out research/data/discovered       Output base path without extension.
`);
}

export function normalizeCountryPreset(value = 'nz') {
  const raw = String(value || 'nz').trim().toLowerCase();
  const aliases = {
    new_zealand: 'nz',
    'new zealand': 'nz',
    australia: 'au',
    aus: 'au',
    united_states: 'us',
    'united states': 'us',
    usa: 'us',
    america: 'us',
    united_kingdom: 'uk',
    'united kingdom': 'uk',
    great_britain: 'uk',
    'great britain': 'uk',
    gb: 'uk',
    canada: 'ca',
    custom: 'global',
    'custom / global': 'global',
    worldwide: 'global',
  };
  return COUNTRY_PRESETS[raw] ? raw : aliases[raw] || 'global';
}

export function normalizeDiscoveryScope(options = {}) {
  const countryPreset = normalizeCountryPreset(options.countryPreset || options.country || 'nz');
  const preset = COUNTRY_PRESETS[countryPreset] || COUNTRY_PRESETS.nz;
  const areas = (options.areas || options.cities || preset.areas || [])
    .map(area => String(area || '').trim())
    .filter(Boolean);
  return {
    countryPreset,
    countryName: options.countryName ?? preset.countryName,
    regionCode: options.regionCode ?? preset.regionCode,
    areas,
  };
}

function displayNameFromHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  } catch {
    return '';
  }
}

function cleanSeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^_su_/i.test(key) || ['srsltid', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    if (!url.search) url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function extractSeedParts(line) {
  const text = String(line || '').trim();
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return null;
  const labelText = text.slice(0, match.index).replace(/\s*[-–—:]\s*$/, '').trim();
  const website = cleanSeedUrl(match[0].replace(/[),.;]+$/, ''));
  if (!website) return null;
  return {
    company_name: labelText || displayNameFromHost(website),
    website,
  };
}

export function normaliseSeedUrls(seedInput = []) {
  const lines = Array.isArray(seedInput)
    ? seedInput.flatMap(item => String(item || '').split(/\r?\n/))
    : String(seedInput || '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const parts = extractSeedParts(line);
    if (!parts) continue;
    let key = '';
    try {
      const url = new URL(parts.website);
      key = `${url.hostname.replace(/^www\./i, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      key = parts.website.toLowerCase();
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      google_place_id: '',
      company_name: parts.company_name,
      website: parts.website,
      phone: '',
      address: '',
      google_rating: 0,
      google_review_count: 0,
      google_types: [],
      discovery_source_query: 'Seed website audit',
      discovery_source: 'seed_list',
    });
  }
  return out;
}

async function seedCandidatesFromOptions(options = {}) {
  const seedRows = [...(options.seedUrls || [])];
  if (options.seedText) seedRows.push(options.seedText);
  if (options.seedFile) {
    const text = await readFile(options.seedFile, 'utf8');
    seedRows.push(text);
  }
  return normaliseSeedUrls(seedRows);
}

function areaQueryText(keyword, area, countryName) {
  const cleanArea = String(area || '').trim();
  const cleanCountry = String(countryName || '').trim();
  if (!cleanCountry) return `${keyword} ${cleanArea}`.trim();
  if (cleanArea.toLowerCase().includes(cleanCountry.toLowerCase())) return `${keyword} ${cleanArea}`.trim();
  return `${keyword} ${cleanArea} ${cleanCountry}`.trim();
}

export function buildQueries(options = {}) {
  const { areas, countryName } = normalizeDiscoveryScope(options);
  const keywords = options.keywords || DEFAULT_KEYWORDS;
  const maxQueries = options.maxQueries;
  const queries = [];
  for (const area of areas) {
    for (const keyword of keywords) {
      queries.push(areaQueryText(keyword, area, countryName));
    }
  }
  if (countryName) {
    queries.push(`custom FDM 3D printing service ${countryName}`);
    queries.push(`upload STL 3D print quote ${countryName}`);
  }
  return queries.slice(0, Number.isFinite(maxQueries) ? maxQueries : queries.length);
}

export function shouldAutoImportLead(lead, scope = 'target_review') {
  const status = lead?.custom_fdm_status || 'review_needed';
  if (scope === 'target_only') return STRICT_TARGETS.has(status);
  return AUTO_IMPORT_TARGETS.has(status);
}

export function splitKnownCandidates(candidates = [], knownLeadKeys = []) {
  const known = new Set(sanitizeIdentityKeys(knownLeadKeys));
  const fresh = [];
  const existingSkipped = [];
  for (const candidate of candidates) {
    if (hasKnownIdentity(candidate, known)) {
      existingSkipped.push({
        company_name: candidate.company_name || '',
        website: candidate.website || '',
        google_place_id: candidate.google_place_id || '',
        phone: candidate.phone || '',
        matched_keys: candidateIdentityKeys(candidate).filter(key => known.has(key)),
        reason: 'Skipped already-added business from local prospect list.',
      });
    } else {
      fresh.push(candidate);
    }
  }
  return { fresh, existingSkipped };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'TrennenProspectResearch/1.0 (+local research tool)',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function placesTextSearch(apiKey, query, maxResultCount, searchOptions = {}) {
  const body = {
    textQuery: query,
    languageCode: 'en',
    maxResultCount,
  };
  if (searchOptions.regionCode) body.regionCode = searchOptions.regionCode;

  const response = await fetchWithTimeout(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  }, 15000);

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google Places ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text || '{}');
  return (data.places || []).map(place => normalisePlaceResult(place, query, searchOptions));
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return '';
  }
}

function shouldCrawlLink(url, origin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return false;
    const path = parsed.pathname.toLowerCase();
    if (SKIP_PATHS.some(skip => path.includes(skip))) return false;
    return LINK_KEYWORDS.some(keyword => path.includes(keyword));
  } catch {
    return false;
  }
}

function extractLinks(html, pageUrl) {
  const links = [];
  const origin = new URL(pageUrl).origin;
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], pageUrl).split('#')[0];
    if (url && shouldCrawlLink(url, origin)) links.push(url);
  }
  return [...new Set(links)];
}

function extractTitle(html) {
  return String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
}

function extractEmail(text) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

function extractPhone(text) {
  return text.match(/(?:\+64|0)\s?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}/)?.[0] || '';
}

async function fetchPage(url) {
  const response = await fetchWithTimeout(url, {
    redirect: 'follow',
  }, 12000);

  const contentType = response.headers.get('content-type') || '';
  const length = Number(response.headers.get('content-length') || 0);
  if (!response.ok || !contentType.includes('text/html') || length > 1_500_000) {
    return null;
  }

  const html = await response.text();
  if (html.length > 1_500_000) return null;
  return {
    url,
    title: stripHtml(extractTitle(html)),
    text: stripHtml(html).slice(0, 80_000),
    links: extractLinks(html, url),
  };
}

export async function crawlWebsite(startUrl, maxPages) {
  if (!startUrl) return [];
  const firstUrl = /^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`;
  const queue = [firstUrl];
  const seen = new Set();
  const pages = [];

  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const page = await fetchPage(url);
      if (!page) continue;
      pages.push(page);
      for (const link of page.links) {
        if (!seen.has(link) && queue.length < maxPages * 3) queue.push(link);
      }
      await sleep(250);
    } catch (err) {
      pages.push({ url, title: '', text: `Crawl failed: ${err.message}`, links: [] });
    }
  }

  return pages;
}

export function toCsv(leads) {
  return leadsToResearchCsv(leads);
}

function normalizeRequestedNewLeads(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Infinity;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function addKeys(set, keys = []) {
  for (const key of keys || []) {
    if (key) set.add(key);
  }
}

function skippedIdentityRecord(candidate = {}, matchedKeys = [], reason = 'Skipped already-added business from local prospect list.') {
  return {
    company_name: candidate.company_name || candidate.name || '',
    website: candidate.website || candidate.url || '',
    google_place_id: candidate.google_place_id || candidate.place_id || candidate.id || '',
    email: candidate.contact_email || candidate.email || '',
    phone: candidate.contact_phone || candidate.phone || '',
    matched_keys: matchedKeys,
    reason,
  };
}

export async function runDiscovery(apiKey, options, hooks = {}) {
  const discoveryScope = normalizeDiscoveryScope(options);
  options = { ...options, ...discoveryScope };
  const requestedNewLeads = normalizeRequestedNewLeads(options.newLeadTarget);
  const queries = buildQueries(options);
  const placesSearch = options.placesTextSearch || placesTextSearch;
  const crawlSite = options.crawlWebsite || crawlWebsite;
  const seedCandidates = dedupePlaces(await seedCandidatesFromOptions(options)).filter(candidate => candidate.website);
  const knownKeys = new Set(sanitizeIdentityKeys(options.knownLeadKeys || []));
  const seenRunKeys = new Set();
  const records = [];
  const leads = [];
  const skippedLeads = [];
  const existingSkipped = [];
  let queriesAttempted = 0;
  const queryDelayMs = Number.isFinite(Number(options.queryDelayMs)) ? Math.max(0, Number(options.queryDelayMs)) : 350;
  const targetReached = () => Number.isFinite(requestedNewLeads) && leads.length >= requestedNewLeads;

  const skipExisting = (candidate, matchedKeys, reason) => {
    const skipped = skippedIdentityRecord(candidate, matchedKeys, reason);
    existingSkipped.push(skipped);
    hooks.onLog?.(`Skipped already-added business: ${skipped.company_name || skipped.website}`);
  };

  const processCandidate = async candidate => {
    if (!candidate?.website || targetReached()) return;
    const candidateKeys = candidateIdentityKeys(candidate);
    const runMatches = candidateKeys.filter(key => seenRunKeys.has(key));
    if (runMatches.length) {
      skipExisting(candidate, runMatches, 'Skipped duplicate candidate from the same discovery run.');
      return;
    }
    const knownMatches = candidateKeys.filter(key => knownKeys.has(key));
    if (knownMatches.length) {
      skipExisting(candidate, knownMatches, 'Skipped already-added business from local prospect list.');
      return;
    }

    addKeys(seenRunKeys, candidateKeys);
    hooks.onLog?.(`Crawling ${candidate.company_name} (${candidate.website})`);
    const pages = await crawlSite(candidate.website, options.maxPagesPerSite);
    const pageText = pages.map(page => page.text).join(' ');
    const classifications = classifyWebsitePages(pages, candidate);
    const email = extractEmail(pageText);
    const phone = candidate.phone || extractPhone(pageText);
    const record = {
      ...candidate,
      email,
      phone,
      pages_scanned: pages.map(page => ({ url: page.url, title: page.title })),
      classifications,
    };
    const lead = discoveryRecordToLead(record);
    const leadKeys = leadIdentityKeys(lead);
    const postCrawlMatches = leadKeys.filter(key => knownKeys.has(key));
    if (postCrawlMatches.length) {
      skipExisting(lead, postCrawlMatches, 'Skipped already-added business after crawl matched local prospect list.');
      addKeys(seenRunKeys, leadKeys);
      hooks.onProgress?.({ stage: 'crawl', company_name: candidate.company_name, scanned_pages: pages.length, skipped_existing: true });
      return;
    }

    records.push(record);
    if (shouldAutoImportLead(lead, options.targetScope)) {
      leads.push(lead);
      addKeys(knownKeys, leadKeys);
      addKeys(seenRunKeys, leadKeys);
      hooks.onLead?.(lead, record);
    } else {
      skippedLeads.push(lead);
      addKeys(seenRunKeys, leadKeys);
      hooks.onLog?.(`Skipped ${lead.company_name || candidate.company_name}: ${lead.target_reason || 'not a custom FDM target'}`);
    }
    hooks.onProgress?.({ stage: 'crawl', company_name: candidate.company_name, scanned_pages: pages.length, new_leads: leads.length });
  };

  if (!apiKey && !seedCandidates.length) {
    throw new Error('GOOGLE_PLACES_API_KEY is required unless seed websites are supplied. Create a key in Google Maps Platform with Places API enabled or run a seed website audit.');
  }

  if (seedCandidates.length) {
    hooks.onLog?.(`Loaded ${seedCandidates.length} seed website(s) for direct audit.`);
    hooks.onProgress?.({ stage: 'seed', found: seedCandidates.length });
    for (const candidate of seedCandidates) {
      await processCandidate(candidate);
      if (targetReached()) break;
    }
  }

  if (apiKey && queries.length && !targetReached()) {
    hooks.onLog?.(`Running up to ${queries.length} Google Places query/queries across ${options.countryName || 'custom/global areas'} to find ${Number.isFinite(requestedNewLeads) ? requestedNewLeads : 'all'} fresh business(es)...`);
    for (const query of queries) {
      if (targetReached()) break;
      queriesAttempted++;
      hooks.onLog?.(`Places query: ${query}`);
      try {
        const results = await placesSearch(apiKey, query, options.maxResultsPerQuery, {
          countryPreset: options.countryPreset,
          countryName: options.countryName,
          regionCode: options.regionCode,
        });
        const candidates = dedupePlaces(results).filter(candidate => candidate.website).map(candidate => ({
          ...candidate,
          region: candidate.region || options.countryName || '',
          country: candidate.country || options.countryName || '',
        }));
        hooks.onProgress?.({ stage: 'places', query, found: results.length });
        for (const candidate of candidates) {
          await processCandidate(candidate);
          if (targetReached()) break;
        }
      } catch (err) {
        hooks.onError?.(`Places query failed for "${query}": ${err.message}`);
      }
      if (!targetReached() && queryDelayMs) await sleep(queryDelayMs);
    }
  } else if (!apiKey) {
    hooks.onLog?.('No Google Places key available; running seed website audit only.');
  }

  const allLeads = [...leads, ...skippedLeads];
  const requestedNewLeadsValue = Number.isFinite(requestedNewLeads) ? requestedNewLeads : null;

  await mkdir(dirname(options.outputBase), { recursive: true });
  await writeFile(`${options.outputBase}.json`, JSON.stringify({
    generated_at: new Date().toISOString(),
    requested_new_leads: requestedNewLeadsValue,
    new_lead_count: leads.length,
    queries_attempted: queriesAttempted,
    records,
    leads,
    all_leads: allLeads,
    skipped_leads: skippedLeads,
    existing_skipped: existingSkipped,
  }, null, 2));
  await writeFile(`${options.outputBase}.csv`, toCsv(allLeads));

  return {
    records,
    leads,
    allLeads,
    skippedLeads,
    existingSkipped,
    requestedNewLeads: requestedNewLeadsValue,
    newLeadCount: leads.length,
    queriesAttempted,
    jsonPath: `${options.outputBase}.json`,
    csvPath: `${options.outputBase}.csv`,
  };
}

export async function refreshLeadEvidence(apiKey, lead, options = {}, hooks = {}) {
  if (!lead?.website && !lead?.company_name) {
    throw new Error('A website or business name is required to refresh evidence.');
  }

  const placesSearch = options.placesTextSearch || placesTextSearch;
  const crawlSite = options.crawlWebsite || crawlWebsite;
  const maxPages = Math.max(1, Math.min(10, Number(options.maxPagesPerSite) || 5));
  const query = [lead.company_name, lead.city || lead.region, lead.country || ''].filter(Boolean).join(' ');
  let placeCandidate = {};

  if (apiKey && query.trim()) {
    try {
      const results = await placesSearch(apiKey, query, Math.min(5, Number(options.maxResultsPerQuery) || 3));
      placeCandidate = results.find(result => {
        const resultKeys = candidateIdentityKeys(result);
        const leadKeys = candidateIdentityKeys(lead);
        return resultKeys.some(key => leadKeys.includes(key));
      }) || results[0] || {};
      if (placeCandidate.company_name || placeCandidate.website) {
        hooks.onLog?.(`Refreshed Google Places signal for ${placeCandidate.company_name || lead.company_name}.`);
      }
    } catch (err) {
      hooks.onError?.(`Google Places refresh failed for "${lead.company_name || lead.website}": ${err.message}`);
    }
  }

  const candidate = {
    ...placeCandidate,
    company_name: placeCandidate.company_name || lead.company_name || '',
    website: placeCandidate.website || lead.website || '',
    phone: placeCandidate.phone || lead.contact_phone || '',
    google_place_id: placeCandidate.google_place_id || lead.google_place_id || '',
    google_rating: Number(placeCandidate.google_rating || lead.google_rating) || 0,
    google_review_count: Number(placeCandidate.google_review_count || lead.google_review_count) || 0,
    region: lead.region || lead.country || 'New Zealand',
    city: lead.city || '',
    discovery_source_query: query || 'Manual evidence refresh',
  };

  if (!candidate.website) {
    throw new Error('A website is required to refresh website evidence.');
  }

  hooks.onLog?.(`Refreshing website evidence for ${candidate.company_name || candidate.website}.`);
  const pages = await crawlSite(candidate.website, maxPages);
  const pageText = pages.map(page => page.text).join(' ');
  const classifications = classifyWebsitePages(pages, candidate);
  const record = {
    ...candidate,
    email: extractEmail(pageText) || lead.contact_email || '',
    phone: candidate.phone || extractPhone(pageText) || lead.contact_phone || '',
    pages_scanned: pages.map(page => ({ url: page.url, title: page.title })),
    classifications,
  };
  const refreshedLead = discoveryRecordToLead(record);
  const checkedAt = options.now || new Date().toISOString();
  return refreshLeadFromDiscoveryData(lead, refreshedLead, checkedAt);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const result = await runDiscovery(apiKey, options, {
    onLog: message => console.log(message),
    onError: message => console.warn(message),
  });

  console.log(`Wrote ${result.records.length} discovery record(s).`);
  console.log(`Wrote ${result.leads.length} auto-import lead(s), ${result.skippedLeads.length} non-target skipped record(s), and ${result.existingSkipped.length} already-added skip(s).`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`CSV:  ${result.csvPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
