#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshLeadEvidence, runDiscovery } from './discover-prospects.mjs';

const require = createRequire(import.meta.url);
const { normalizeNewLeadTarget, parseEnvText, sanitizeKnownLeadKeys } = require('./discovery-server-core.cjs');
const researchCore = require('./prospect-research-core.js');
const {
  assertPdfBuffer,
  buildResendEmailPayload,
  deckPdfFilename,
  normalizeOutreachEnv,
  safeArchiveRecord,
  sanitizeSuppressionKeys,
} = require('./outreach-server-core.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4177);
const OUTREACH_DIR = join(__dirname, 'data', 'outreach');
const DECK_DIR = join(OUTREACH_DIR, 'decks');
const SUPPRESSION_PATH = join(OUTREACH_DIR, 'suppression.json');
const ARCHIVE_PATH = join(OUTREACH_DIR, 'sent-archive.json');

let nextEventId = 1;
let events = [];
let running = false;
let currentJob = null;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function addEvent(type, payload = {}) {
  const event = { id: nextEventId++, type, at: new Date().toISOString(), ...payload };
  events.push(event);
  if (events.length > 1000) events = events.slice(-1000);
  return event;
}

async function loadLocalEnv() {
  const envText = await readFile(join(__dirname, '.env'), 'utf8').catch(() => '');
  return { ...parseEnvText(envText), ...process.env };
}

async function loadApiKey() {
  const env = await loadLocalEnv();
  return env.GOOGLE_PLACES_API_KEY || '';
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function discoveryOptions(body = {}) {
  const cityText = String(body.cities || 'Auckland,Wellington,Christchurch').trim();
  const seedText = String(body.seedText || '').slice(0, 20000);
  const newLeadTarget = normalizeNewLeadTarget(body.newLeadTarget);
  return {
    cities: cityText.split(',').map(city => city.trim()).filter(Boolean),
    keywords: ['custom FDM 3D printing service', 'PLA PETG 3D printing service', 'upload STL 3D printing', 'custom 3D print quote', 'custom order 3D printing miniatures', 'send STL 3D printing service'],
    newLeadTarget,
    maxQueries: Math.max(10, Math.min(120, Number(body.maxQueries) || newLeadTarget * 6)),
    maxResultsPerQuery: Math.max(1, Math.min(20, Number(body.maxResults) || 10)),
    maxPagesPerSite: Math.max(1, Math.min(10, Number(body.maxPages) || 5)),
    targetScope: body.targetScope === 'target_only' ? 'target_only' : 'target_review',
    knownLeadKeys: sanitizeKnownLeadKeys(body.knownLeadKeys || []),
    seedText,
    seedUrls: Array.isArray(body.seedUrls) ? body.seedUrls.slice(0, 500) : [],
    outputBase: join(__dirname, 'data', 'discovered-prospects'),
  };
}

async function startDiscovery(body) {
  if (running) return { ok: false, error: 'Discovery is already running.' };
  const apiKey = await loadApiKey();
  const options = discoveryOptions(body);
  if (!apiKey && !options.seedText && !options.seedUrls.length) {
    return { ok: false, error: 'Missing GOOGLE_PLACES_API_KEY in research/.env. Add seed websites to run a direct seed audit without Google Places.' };
  }
  running = true;
  currentJob = {
    id: String(Date.now()),
    started_at: new Date().toISOString(),
    options,
  };
  events = [];
  nextEventId = 1;
  addEvent('status', { message: 'Discovery started.', running: true, job: currentJob });

  runDiscovery(apiKey, options, {
    onLog: message => addEvent('log', { message }),
    onError: message => addEvent('error', { message }),
    onProgress: progress => addEvent('progress', progress),
    onLead: lead => addEvent('lead', { lead }),
  }).then(result => {
    running = false;
    addEvent('done', {
      running: false,
      records: result.records.length,
      leads: result.leads.length,
      requestedNewLeads: result.requestedNewLeads,
      newLeadCount: result.newLeadCount,
      queriesAttempted: result.queriesAttempted,
      skipped: result.skippedLeads.length,
      existingSkipped: result.existingSkipped.length,
      jsonPath: result.jsonPath,
      csvPath: result.csvPath,
      message: `Discovery complete: requested ${result.requestedNewLeads || 'all'} new businesses, added ${result.newLeadCount} new businesses, skipped ${result.skippedLeads.length} non-target record(s), ${result.existingSkipped.length} already-added/duplicate record(s), ${result.queriesAttempted} searches attempted.`,
    });
  }).catch(err => {
    running = false;
    addEvent('error', { running: false, message: err.message || 'Discovery failed.' });
  });

  return { ok: true, running, job: currentJob };
}

async function refreshLead(body) {
  const apiKey = await loadApiKey();
  const lead = body?.lead || {};
  const maxPagesPerSite = Math.max(1, Math.min(10, Number(body?.maxPages) || 5));
  const refreshed = await refreshLeadEvidence(apiKey, lead, {
    maxPagesPerSite,
    maxResultsPerQuery: 3,
    now: new Date().toISOString(),
  }, {
    onLog: message => addEvent('log', { message }),
    onError: message => addEvent('error', { message }),
  });
  const warnings = [];
  if (!apiKey) warnings.push('GOOGLE_PLACES_API_KEY is not available, so Google rating/review data was not refreshed.');
  return { ok: true, lead: refreshed, warnings };
}

async function loadSuppressionKeys() {
  const text = await readFile(SUPPRESSION_PATH, 'utf8').catch(() => '');
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return sanitizeSuppressionKeys(parsed.keys || []);
  } catch {
    return [];
  }
}

async function saveSuppressionKeys(keys) {
  await mkdir(OUTREACH_DIR, { recursive: true });
  await writeFile(SUPPRESSION_PATH, JSON.stringify({
    updated_at: new Date().toISOString(),
    keys: sanitizeSuppressionKeys(keys),
  }, null, 2));
}

async function addLeadToSuppression(lead) {
  const existing = await loadSuppressionKeys();
  const next = new Set(existing);
  researchCore.leadIdentityKeys(lead).forEach(key => next.add(key));
  await saveSuppressionKeys([...next]);
  return [...next];
}

function deckCss() {
  return `
    @page { size: 13.333in 7.5in; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #F6F2EB; color: #171717; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .slide { width: 13.333in; height: 7.5in; page-break-after: always; padding: .42in .52in; background: #F6F2EB; position: relative; overflow: hidden; }
    .slide::before { content: ""; position: absolute; left: 0; top: 0; width: .18in; height: 100%; background: #123F33; }
    .top { display:flex; justify-content:space-between; color:#C8954A; font-size:.12in; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .footer { position:absolute; left:.52in; right:.52in; bottom:.2in; color:#6F6A60; font-size:.1in; line-height:1.35; }
    .kicker { color:#C8954A; font-size:.13in; font-weight:850; text-transform:uppercase; letter-spacing:.06em; margin-top:.32in; }
    h1, h2 { margin:.08in 0 .14in; line-height:.94; letter-spacing:-.02em; color:#171717; }
    h1 { font-size:.72in; max-width:7.8in; }
    h2 { font-size:.48in; max-width:8.8in; }
    p { margin:.06in 0; color:#3B3934; font-size:.18in; line-height:1.36; max-width:8.8in; }
    ul, ol { margin:.08in 0 0 .22in; padding:0; color:#3B3934; font-size:.17in; line-height:1.38; }
    li { margin:.06in 0; }
    .audit { border-left:.05in solid #C8954A; background:#EEE7D8; border-radius:.06in; padding:.12in .14in; color:#3B3934; font-size:.12in; line-height:1.38; margin:.12in 0 .16in; }
    .audit strong { display:block; color:#123F33; text-transform:uppercase; letter-spacing:.04em; font-size:.1in; margin-bottom:.04in; }
    .grid { display:grid; grid-template-columns: 1.1fr .9fr; gap:.34in; align-items:stretch; }
    .cards { display:grid; grid-template-columns:repeat(2,1fr); gap:.12in; margin-top:.22in; }
    .card { background:#FFFDF8; border:1px solid #DED6C8; border-radius:.08in; padding:.16in; }
    .card.green { background:#123F33; color:#F7F2EA; border-color:#123F33; }
    .card.green p, .card.green li { color:#F7F2EA; }
    .card-title { color:#C8954A; font-size:.12in; font-weight:850; letter-spacing:.05em; text-transform:uppercase; margin-bottom:.08in; }
    .metric-value { font-size:.34in; font-weight:900; line-height:1; }
    .metric-detail { color:#6F6A60; font-size:.12in; line-height:1.35; margin-top:.06in; }
    .formula { background:#123F33; color:#F7F2EA; border-radius:.08in; padding:.13in .16in; font-size:.15in; line-height:1.38; font-weight:850; margin:.15in 0; }
    .path { display:grid; grid-template-columns:repeat(5,1fr); gap:.1in; margin-top:.28in; }
    .path-step { background:#FFFDF8; border:1px solid #DED6C8; border-radius:.08in; padding:.14in; min-height:1.2in; font-weight:800; }
    .path-step span { display:block; color:#C8954A; margin-bottom:.12in; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:.24in; margin-top:.22in; }
    .appendix { margin-top:.18in; border:1px solid #DED6C8; background:#FFFDF8; }
    .row { display:grid; grid-template-columns:1.1in 5.4in 1.3in; border-bottom:1px solid #DED6C8; }
    .row div { padding:.08in .1in; font-size:.105in; line-height:1.3; }
    .row.header div { font-weight:850; color:#C8954A; text-transform:uppercase; letter-spacing:.04em; }
    .badge { display:inline-block; background:#123F33; color:#F7F2EA; border-radius:999px; padding:.06in .12in; margin:.04in .04in 0 0; font-size:.115in; font-weight:800; }
  `;
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMetric(card) {
  return `<div class="card"><div class="card-title">${escHtml(card.label)}</div><div class="metric-value">${escHtml(card.value)}</div><div class="metric-detail">${escHtml(card.detail || card.note || '')}</div></div>`;
}

function renderDeckSlide(deck, slide, index) {
  const metricCards = (deck.metric_cards || []).map(renderMetric).join('');
  const path = (deck.guided_quote_path || []).map((step, i) => `<div class="path-step"><span>${String(i + 1).padStart(2, '0')}</span>${escHtml(step)}</div>`).join('');
  const bullets = (slide.bullets || []).map(item => `<li>${escHtml(item)}</li>`).join('');
  const proof = (slide.proof || []).map(item => `<li>${escHtml(item)}</li>`).join('');
  const compactBullets = (slide.bullets || []).filter(item => !/^How we gathered this:/i.test(item)).slice(0, 4).map(item => `<li>${escHtml(item)}</li>`).join('');
  const beforeAfter = deck.before_after || {};
  const calculator = deck.calculator || { cards: [] };
  const appendixRows = (deck.appendix_rows || []).slice(0, 10).map(row => `<div class="row"><div>${escHtml(row.field)}</div><div>${escHtml(row.value)}</div><div>${escHtml(row.confidence)}</div></div>`).join('');
  const audit = deck.audit_methodology || {};
  const positioning = deck.quote_positioning || slide.quote_positioning || {};
  const page = String(index + 1).padStart(2, '0');
  const commonTop = `<div class="top"><span>TRENNEN</span><span>${page}</span></div>`;
  const footer = `<div class="footer">${escHtml(slide.footer || deck.footer_note || '')}</div>`;
  const layout = {
    cover: `
      <div class="grid">
        <div>
          <div class="kicker">${escHtml(slide.kicker)}</div>
          <h1>${escHtml(slide.title)}</h1>
          <p>${escHtml(slide.claim)}</p>
          <div class="audit"><strong>How this was gathered</strong>${escHtml(audit.summary || 'External public audit using website/profile evidence and editable assumptions.')}</div>
          <div>${(slide.bullets || []).slice(1, 4).map(item => `<span class="badge">${escHtml(item)}</span>`).join('')}</div>
          <div class="cards">${metricCards}</div>
        </div>
        <div class="card green"><div class="card-title">Guided quote path</div><div class="path" style="grid-template-columns:1fr">${path}</div></div>
      </div>`,
    observed_situation: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p>
      <div class="audit"><strong>External audit disclosure</strong>${escHtml(audit.disclaimer || 'Outside-in audit only; update with client data before making performance claims.')}</div>
      <div class="two"><div class="card"><div class="card-title">Current pricing system</div><p><strong>${escHtml(positioning.current_system || 'Quote workflow needs verification')}</strong></p><p>${escHtml(positioning.current_read || '')}</p><ul>${compactBullets}</ul></div><div class="card green"><div class="card-title">Sales friction hypothesis</div><p>${escHtml(slide.claim)}</p></div></div>`,
    changeable_metrics: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p>
      <div class="cards">${calculator.cards.map(renderMetric).join('')}</div><div class="formula">${escHtml(calculator.formula || '')}</div><div class="card" style="margin-top:.12in"><div class="card-title">Calculation guardrail</div><p>${escHtml(calculator.impact_line || '')}</p></div>`,
    proposed_solution: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p><div class="path">${path}</div><div class="two"><div class="card"><div class="card-title">Current pricing system</div><p>${escHtml(positioning.current_read || '')}</p></div><div class="card green"><div class="card-title">Why Trennen is better</div><p>${escHtml(positioning.why_trennen_better || '')}</p></div></div>`,
    before_after: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p>
      <div class="two"><div class="card"><div class="card-title">${escHtml(beforeAfter.before_title || 'Before')}</div><ul>${(beforeAfter.before || []).map(item => `<li>${escHtml(item)}</li>`).join('')}</ul></div><div class="card green"><div class="card-title">${escHtml(beforeAfter.after_title || 'After')}</div><ul>${(beforeAfter.after || []).map(item => `<li>${escHtml(item)}</li>`).join('')}</ul></div></div>`,
    small_ask: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p><div class="cards">${(slide.bullets || []).slice(0, 4).map(item => `<div class="card"><div class="card-title">${escHtml(item.split(':')[0])}</div><p>${escHtml(item.split(':').slice(1).join(':').trim() || item)}</p></div>`).join('')}</div>`,
    evidence_appendix: `
      <div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p><div class="appendix"><div class="row header"><div>Field</div><div>Value</div><div>Confidence</div></div>${appendixRows}</div>`,
  }[slide.layout] || `<div class="kicker">${escHtml(slide.kicker)}</div><h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.claim)}</p><ul>${bullets}</ul>`;

  return `<section class="slide">${commonTop}${layout}${footer}</section>`;
}

function renderDeckHtml(lead) {
  const deck = researchCore.generatePitchDeck(lead);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(deck.title)}</title><style>${deckCss()}</style></head><body>${deck.slides.map((slide, index) => renderDeckSlide(deck, slide, index)).join('')}</body></html>`;
}

async function importPlaywrightChromium() {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch (err) {
    throw new Error('Playwright is required to generate PDF pitch decks. Run `npm install --prefix research` and `npx --prefix research playwright install chromium`.');
  }
}

async function renderPitchDeckPdf(lead) {
  await mkdir(DECK_DIR, { recursive: true });
  const filename = deckPdfFilename(lead);
  const path = join(DECK_DIR, filename);
  const chromium = await importPlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent(renderDeckHtml(lead), { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({
      width: '13.333in',
      height: '7.5in',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    assertPdfBuffer(pdfBuffer);
    await writeFile(path, pdfBuffer);
    return { filename, path, pdfBuffer };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function loadOutreachStatus() {
  const env = await loadLocalEnv();
  const normalized = normalizeOutreachEnv(env);
  const suppressionKeys = await loadSuppressionKeys();
  return {
    ok: true,
    ready: normalized.ready,
    errors: normalized.errors,
    from: normalized.config.from,
    archiveEmail: normalized.config.archiveEmail,
    suppressionCount: suppressionKeys.length,
  };
}

async function previewOutreach(body) {
  const env = await loadLocalEnv();
  const normalized = normalizeOutreachEnv(env);
  const lead = researchCore.normaliseLead(body?.lead || {});
  const suppressionKeys = sanitizeSuppressionKeys([
    ...(await loadSuppressionKeys()),
    ...(body?.suppressionKeys || []),
  ]);
  const eligibility = researchCore.outreachEligibility(lead, suppressionKeys);
  const email = researchCore.generateOutreachEmail(lead, {
    senderName: normalized.config.fromName,
    senderBusiness: 'Trennen',
    senderEmail: normalized.config.fromEmail,
    replyTo: normalized.config.replyTo,
    unsubscribeEmail: normalized.config.replyTo,
  });
  return {
    ok: true,
    ready: normalized.ready,
    configErrors: normalized.errors,
    eligibility,
    email,
    pdfFilename: deckPdfFilename(lead),
  };
}

async function sendViaResend(config, payload) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Resend send failed with HTTP ${response.status}.`);
  }
  return data;
}

async function appendArchive(record) {
  await mkdir(OUTREACH_DIR, { recursive: true });
  const existingText = await readFile(ARCHIVE_PATH, 'utf8').catch(() => '');
  let rows = [];
  if (existingText) {
    try {
      rows = JSON.parse(existingText);
      if (!Array.isArray(rows)) rows = [];
    } catch {
      rows = [];
    }
  }
  rows.push(safeArchiveRecord(record));
  await writeFile(ARCHIVE_PATH, JSON.stringify(rows, null, 2));
}

async function sendOutreach(body) {
  const env = await loadLocalEnv();
  const normalized = normalizeOutreachEnv(env);
  if (!normalized.ready) return { ok: false, error: normalized.errors.join(' ') };
  const lead = researchCore.normaliseLead(body?.lead || {});
  const suppressionKeys = sanitizeSuppressionKeys([
    ...(await loadSuppressionKeys()),
    ...(body?.suppressionKeys || []),
  ]);
  const eligibility = researchCore.outreachEligibility(lead, suppressionKeys);
  if (!eligibility.eligible) return { ok: false, error: eligibility.reasons.join(' ') || 'Lead is not eligible for outreach.', eligibility };

  const email = researchCore.generateOutreachEmail(lead, {
    senderName: normalized.config.fromName,
    senderBusiness: 'Trennen',
    senderEmail: normalized.config.fromEmail,
    replyTo: normalized.config.replyTo,
    unsubscribeEmail: normalized.config.replyTo,
  });
  const pdf = await renderPitchDeckPdf(lead);
  const payload = buildResendEmailPayload({
    config: normalized.config,
    to: lead.contact_email,
    subject: email.subject,
    text: email.text,
    html: email.html,
    pdfBuffer: pdf.pdfBuffer,
    pdfFilename: pdf.filename,
  });
  const result = await sendViaResend(normalized.config, payload);
  await appendArchive({
    recipient: lead.contact_email,
    company_name: lead.company_name,
    subject: email.subject,
    body: email.text,
    deck_filename: pdf.filename,
    resend_id: result.id,
    result: 'sent',
  });
  return {
    ok: true,
    id: result.id,
    recipient: lead.contact_email,
    company_name: lead.company_name,
    pdfFilename: pdf.filename,
    archiveEmail: normalized.config.archiveEmail,
    warnings: eligibility.warnings,
  };
}

async function serveStatic(req, res, pathname) {
  const localPath = pathname === '/' ? '/research/prospects.html' : pathname;
  const resolved = normalize(join(ROOT_DIR, localPath));
  if (!resolved.startsWith(ROOT_DIR) || !resolved.includes(`${join(ROOT_DIR, 'research')}`)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const bytes = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(resolved)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (url.pathname === '/api/discovery/status' && req.method === 'GET') {
    const hasKey = !!await loadApiKey();
    return json(res, 200, { ok: true, hasKey, running, job: currentJob });
  }

  if (url.pathname === '/api/discovery/events' && req.method === 'GET') {
    const after = Number(url.searchParams.get('after') || 0);
    return json(res, 200, { ok: true, running, events: events.filter(event => event.id > after) });
  }

  if (url.pathname === '/api/discovery/start' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await startDiscovery(body);
      return json(res, result.ok ? 202 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || 'Could not start discovery.' });
    }
  }

  if (url.pathname === '/api/discovery/refresh-lead' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await refreshLead(body);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || 'Could not refresh lead evidence.' });
    }
  }

  if (url.pathname === '/api/outreach/status' && req.method === 'GET') {
    try {
      const result = await loadOutreachStatus();
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || 'Could not load outreach status.' });
    }
  }

  if (url.pathname === '/api/outreach/preview' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await previewOutreach(body);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || 'Could not preview outreach email.' });
    }
  }

  if (url.pathname === '/api/outreach/send' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const result = await sendOutreach(body);
      return json(res, result.ok ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || 'Could not send outreach email.' });
    }
  }

  if (url.pathname === '/api/outreach/suppress' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const lead = researchCore.normaliseLead(body?.lead || {}, { skipDeck: true });
      const keys = await addLeadToSuppression(lead);
      return json(res, 200, { ok: true, suppressionCount: keys.length, keys: researchCore.leadIdentityKeys(lead) });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || 'Could not add suppression record.' });
    }
  }

  return serveStatic(req, res, url.pathname);
}

createServer((req, res) => {
  handler(req, res).catch(err => json(res, 500, { ok: false, error: err.message || 'Internal server error' }));
}).listen(PORT, HOST, () => {
  console.log(`Prospect discovery bridge running at http://${HOST}:${PORT}/research/prospects.html`);
});
