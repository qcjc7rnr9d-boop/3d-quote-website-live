const researchCore = require('./prospect-research-core.js');

const FDM_TERMS = [
  /\bfdm\b/i,
  /fused deposition/i,
  /\bpla\b/i,
  /\bpetg\b/i,
  /\babs\b/i,
  /\basa\b/i,
  /filament/i,
  /fused filament/i,
];

const PRINT_TERMS = [
  /3d print/i,
  /3d printing/i,
  /additive manufacturing/i,
  /rapid prototyp/i,
  /print price/i,
  /\bstl\b/i,
  /\bcad\b/i,
];

const RESIN_ONLY_TERMS = [
  /resin only/i,
  /sla .*only/i,
  /no filament/i,
  /no fdm/i,
  /resin printing only/i,
  /sla printing only/i,
  /\bdlp\b .*only/i,
];

const QUOTE_PATTERNS = {
  automated_quote: [
    /instant quote/i,
    /instant pricing/i,
    /price calculator/i,
    /quote calculator/i,
    /online estimator/i,
    /upload .* instant/i,
    /automatic .*slicer/i,
    /slicer .*price/i,
  ],
  bad_calculator: [
    /calculator .* estimate only/i,
    /estimate .* final price/i,
    /quote calculator .* contact/i,
    /price may change/i,
  ],
  upload_no_instant_price: [
    /upload .*stl/i,
    /upload .*file/i,
    /select material/i,
    /place order/i,
    /pay online/i,
    /review .* before confirming price/i,
  ],
  manual_email_quote: [
    /email .*cad/i,
    /email .*file/i,
    /send .*file/i,
    /send .*stl/i,
    /work out .*price/i,
    /price.*once.*set up/i,
  ],
  manual_form: [
    /request a quote/i,
    /quote form/i,
    /contact form/i,
    /submit .*enquiry/i,
    /get a quote/i,
  ],
};

const CUSTOM_SERVICE_TERMS = [
  /custom 3d print/i,
  /custom fdm/i,
  /3d printing service/i,
  /fdm(?: 3d)? printing service/i,
  /custom order/i,
  /custom orders/i,
  /commission/i,
  /commissions/i,
  /print on demand/i,
  /we print/i,
  /print your (model|part|design)/i,
  /we can print/i,
  /printed for you/i,
  /upload.{0,80}stl/i,
  /upload.{0,80}file/i,
  /send.{0,80}cad/i,
  /send.{0,80}stl/i,
  /send.{0,80}(part|model|file)/i,
  /email.{0,80}cad/i,
  /email.{0,80}(stl|file)/i,
  /request a quote/i,
  /get a quote/i,
  /quote form/i,
  /rapid prototyp/i,
  /prototype/i,
  /prototyping/i,
  /small batch/i,
  /on[- ]?demand/i,
];

const SUPPLIER_STORE_TERMS = [
  /shop .*filament/i,
  /buy .*filament/i,
  /filament .*delivery/i,
  /3d printers? .*accessor/i,
  /spare nozzles?/i,
  /replacement parts/i,
  /reseller/i,
  /authorized dealer/i,
  /printer sales/i,
  /sell .*3d printers?/i,
];

const MINI_TABLETOP_TERMS = [
  /miniature/i,
  /tabletop/i,
  /terrain/i,
  /warhammer/i,
  /dungeons? and dragons/i,
  /\bdnd\b/i,
  /dice tower/i,
  /wargaming/i,
];

const PREMADE_PRODUCT_TERMS = [
  /ready[- ]?made/i,
  /pre[- ]?made/i,
  /painted models?/i,
  /finished models?/i,
  /tabletop terrain/i,
  /stl file downloads?/i,
  /digital downloads?/i,
  /downloadable stl/i,
  /add to cart/i,
  /shop .*miniatures?/i,
  /buy .*miniatures?/i,
];

const DIRECTORY_TERMS = [
  /directory/i,
  /marketplace/i,
  /find .*service/i,
  /compare .*suppliers/i,
];

const STRONG_AUTOMATED_TERMS = {
  upload: [/upload.{0,80}stl/i, /upload.{0,80}file/i, /drag.{0,80}drop/i],
  slicer: [/slicer/i, /mesh/i, /model analysis/i, /analyse .*model/i, /automatic .*price/i, /instant pricing/i],
  options: [/material/i, /\bpla\b/i, /\bpetg\b/i, /layer height/i, /infill/i, /quantity/i, /turnaround/i],
  checkout: [/add to cart/i, /checkout/i, /pay online/i, /payment/i, /place order/i],
};

const QUOTE_FRICTION = {
  no_quote_system: 90,
  manual_email_quote: 92,
  manual_form: 85,
  upload_no_instant_price: 72,
  bad_calculator: 68,
  unknown: 50,
  automated_quote: 20,
};

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return cleanText(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function matchAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function matchingEvidence(text, patterns, label) {
  const evidence = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) evidence.push(`${label}: "${match[0].slice(0, 120)}"`);
  }
  return evidence;
}

function classifyFdm(text) {
  const hasFdm = matchAny(text, FDM_TERMS);
  const hasPrint = matchAny(text, PRINT_TERMS);
  const resinOnly = matchAny(text, RESIN_ONLY_TERMS);

  if (resinOnly) return 'not_fdm';
  if (hasFdm) return 'fdm_confirmed';
  if (hasPrint) return 'fdm_likely';
  return 'unknown';
}

function classifyQuoteSystem(text) {
  const hasAutomated = matchAny(text, QUOTE_PATTERNS.automated_quote);
  const hasBad = matchAny(text, QUOTE_PATTERNS.bad_calculator);
  const hasUpload = matchAny(text, QUOTE_PATTERNS.upload_no_instant_price);
  const hasManualEmail = matchAny(text, QUOTE_PATTERNS.manual_email_quote);
  const hasManualForm = matchAny(text, QUOTE_PATTERNS.manual_form);
  const hasQuoteWords = /quote|pricing|price|order|upload|contact/i.test(text);

  if (hasBad) return 'bad_calculator';
  if (hasAutomated) return 'automated_quote';
  if (hasUpload) return 'upload_no_instant_price';
  if (hasManualEmail) return 'manual_email_quote';
  if (hasManualForm) return 'manual_form';
  if (!hasQuoteWords) return 'no_quote_system';
  return 'unknown';
}

function hasStrongAutomatedPricing(text) {
  return Object.values(STRONG_AUTOMATED_TERMS).every(patterns => matchAny(text, patterns));
}

function pricingMaturity(quoteSystem, text) {
  if (quoteSystem === 'automated_quote') {
    return hasStrongAutomatedPricing(text) ? 'automated_strong' : 'automated_basic';
  }
  if (quoteSystem === 'bad_calculator') return 'bad_calculator';
  if (quoteSystem === 'upload_no_instant_price') return 'upload_no_instant_price';
  if (['manual_email_quote', 'manual_form', 'no_quote_system'].includes(quoteSystem)) return 'manual_quote';
  return 'unknown';
}

function servicePresenceStatus(targetStatus, serviceModel) {
  if (targetStatus === 'target_confirmed') return 'service_confirmed';
  if (targetStatus === 'target_likely') return 'service_likely';
  if (serviceModel === 'supplier_store') return 'supplier_only';
  if (serviceModel === 'premade_products_only') return 'premade_only';
  if (serviceModel === 'resin_only') return 'resin_only';
  if (serviceModel === 'marketplace_or_directory') return 'directory';
  return 'unknown';
}

function opportunityType(customFdmStatus, serviceModel, maturity) {
  if (customFdmStatus === 'not_target') {
    if (serviceModel === 'supplier_store') return 'exclude_supplier';
    return 'exclude_non_service';
  }
  if (customFdmStatus === 'review_needed') return 'verify_service';
  if (maturity === 'automated_strong') return 'benchmark_auto_pricing';
  if (maturity === 'automated_basic') return 'improve_auto_pricing';
  if (maturity === 'bad_calculator') return 'fix_bad_calculator';
  if (maturity === 'upload_no_instant_price') return 'improve_upload_flow';
  if (maturity === 'manual_quote') return 'replace_manual_quoting';
  return 'verify_pricing';
}

function conversionLeakFromPricing(maturity, quoteSystem) {
  if (maturity === 'automated_strong') return 22;
  if (maturity === 'automated_basic') return 34;
  if (maturity === 'bad_calculator') return 68;
  if (maturity === 'upload_no_instant_price') return 74;
  if (maturity === 'manual_quote') {
    return quoteSystem === 'no_quote_system' || quoteSystem === 'manual_email_quote' ? 86 : 82;
  }
  return 50;
}

function evidenceLabel(text, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) matches.push(match[0].slice(0, 48));
    if (matches.length >= 3) break;
  }
  return matches.join(' + ');
}

function classifyCustomFdmTarget(text, pages, fdmStatus, quoteSystem) {
  const hasPages = pages.length > 0 && cleanText(text);
  if (!hasPages) {
    return {
      custom_fdm_status: 'review_needed',
      service_model: 'unknown',
      target_reason: 'No website pages could be scanned; review manually before outreach.',
    };
  }

  const hasFdmEvidence = matchAny(text, FDM_TERMS);
  const hasPrintEvidence = matchAny(text, PRINT_TERMS);
  const hasCustomService = matchAny(text, CUSTOM_SERVICE_TERMS);
  const hasMiniTabletop = matchAny(text, MINI_TABLETOP_TERMS);
  const premadeProducts = matchAny(text, PREMADE_PRODUCT_TERMS);
  const resinOnly = matchAny(text, RESIN_ONLY_TERMS);
  const supplierStore = matchAny(text, SUPPLIER_STORE_TERMS);
  const directory = matchAny(text, DIRECTORY_TERMS);
  const hasQuoteWorkflow = !['no_quote_system', 'unknown'].includes(quoteSystem);

  if (directory && !hasCustomService) {
    return {
      custom_fdm_status: 'not_target',
      service_model: 'marketplace_or_directory',
      target_reason: 'Skipped: directory or marketplace wording found without direct custom print-service evidence.',
    };
  }

  if (resinOnly && !hasCustomService) {
    return {
      custom_fdm_status: 'not_target',
      service_model: 'resin_only',
      target_reason: 'Skipped: resin-only or no-filament wording found without custom FDM service evidence.',
    };
  }

  if (supplierStore && !hasCustomService) {
    return {
      custom_fdm_status: 'not_target',
      service_model: 'supplier_store',
      target_reason: 'Skipped: supplier/store signals found without custom print-service wording.',
    };
  }

  if (premadeProducts && !hasCustomService) {
    return {
      custom_fdm_status: 'not_target',
      service_model: 'premade_products_only',
      target_reason: 'Skipped: premade miniatures/products or STL downloads found without custom print-service wording.',
    };
  }

  if (hasFdmEvidence && hasCustomService) {
    const fdmEvidence = evidenceLabel(text, FDM_TERMS);
    const serviceEvidence = evidenceLabel(text, CUSTOM_SERVICE_TERMS);
    const isMiniService = hasMiniTabletop && hasCustomService;
    return {
      custom_fdm_status: 'target_confirmed',
      service_model: isMiniService ? 'miniatures_custom_service' : 'custom_fdm_service',
      target_reason: `${isMiniService ? 'Miniatures/tabletop shop with custom FDM service evidence found' : 'Custom FDM service evidence found'}: ${[fdmEvidence, serviceEvidence].filter(Boolean).join(' + ')}.`,
    };
  }

  if (hasFdmEvidence && hasQuoteWorkflow) {
    return {
      custom_fdm_status: 'target_likely',
      service_model: 'fdm_likely_service',
      target_reason: 'FDM/material evidence plus quote/order workflow found; verify custom service fit.',
    };
  }

  if (hasPrintEvidence || hasCustomService || fdmStatus === 'fdm_likely') {
    return {
      custom_fdm_status: 'review_needed',
      service_model: 'generic_3d_printing',
      target_reason: '3D printing service evidence found, but FDM/material evidence is missing or weak.',
    };
  }

  return {
    custom_fdm_status: 'review_needed',
    service_model: 'unknown',
    target_reason: 'No clear custom FDM service evidence found; review manually.',
  };
}

function scoreReviewDemand(reviewCount = 0, rating = 0) {
  const reviews = Number(reviewCount) || 0;
  const reviewScore = reviews >= 80 ? 90 : reviews >= 30 ? 75 : reviews >= 10 ? 60 : reviews >= 3 ? 45 : 30;
  const ratingAdjustment = Number(rating) >= 4.6 ? 8 : Number(rating) >= 4.2 ? 4 : 0;
  return Math.min(100, reviewScore + ratingAdjustment);
}

function contactabilityFromCandidate(candidate = {}, pages = []) {
  const text = pages.map(page => page.text || '').join(' ');
  let score = 30;
  if (candidate.email || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) score += 35;
  if (candidate.phone || /\+?64|\b0\d{1,2}[\s-]?\d{3}/.test(text)) score += 20;
  if (/contact/i.test(text)) score += 10;
  return Math.min(100, score);
}

function classifyWebsitePages(pages = [], candidate = {}) {
  const pageTexts = pages.map(page => `${page.url || ''} ${stripHtml(page.html || page.text || '')}`);
  const combinedText = cleanText(pageTexts.join(' '));
  const lower = combinedText.toLowerCase();
  const fdmStatus = classifyFdm(combinedText);
  const quoteSystem = classifyQuoteSystem(combinedText);
  const maturity = pricingMaturity(quoteSystem, combinedText);
  const target = classifyCustomFdmTarget(combinedText, pages, fdmStatus, quoteSystem);
  const servicePresence = servicePresenceStatus(target.custom_fdm_status, target.service_model);
  const opportunity = opportunityType(target.custom_fdm_status, target.service_model, maturity);
  const evidence = [
    ...matchingEvidence(combinedText, FDM_TERMS, 'FDM signal'),
    ...matchingEvidence(combinedText, CUSTOM_SERVICE_TERMS, 'Custom service signal'),
    ...matchingEvidence(combinedText, MINI_TABLETOP_TERMS, 'Mini/tabletop signal'),
    ...matchingEvidence(combinedText, PREMADE_PRODUCT_TERMS, 'Premade-product signal'),
    ...matchingEvidence(combinedText, QUOTE_PATTERNS[quoteSystem] || [], 'Quote signal'),
  ].slice(0, 12);

  const hasInstant = quoteSystem === 'automated_quote';
  const conversionLeakScore = conversionLeakFromPricing(maturity, quoteSystem);
  const businessFitScore = target.custom_fdm_status === 'target_confirmed'
    ? 90
    : target.custom_fdm_status === 'target_likely'
      ? 76
      : target.custom_fdm_status === 'not_target'
        ? 10
        : 45;
  const trafficScore = scoreReviewDemand(candidate.google_review_count, candidate.google_rating);
  const contactabilityScore = contactabilityFromCandidate(candidate, pages);

  return {
    fdm_status: fdmStatus,
    custom_fdm_status: target.custom_fdm_status,
    service_model: target.service_model,
    service_presence_status: servicePresence,
    target_reason: target.target_reason,
    quote_system: quoteSystem,
    pricing_maturity: maturity,
    opportunity_type: opportunity,
    pricing_friction_score: QUOTE_FRICTION[quoteSystem] || QUOTE_FRICTION.unknown,
    traffic_score: trafficScore,
    conversion_leak_score: conversionLeakScore,
    business_fit_score: businessFitScore,
    contactability_score: contactabilityScore,
    has_obvious_instant_pricing: hasInstant,
    evidence: evidence.length ? evidence : [`Scanned ${pages.length} page(s); no strong quote/FDM signal found.`],
    confidence: target.custom_fdm_status === 'target_confirmed' || quoteSystem !== 'unknown' ? 'observed' : 'estimated',
    notes: lower.includes('resin') && fdmStatus !== 'fdm_confirmed' ? 'May be resin-only; verify before outreach.' : '',
  };
}

function normaliseUrl(url) {
  const value = cleanText(url).toLowerCase().replace(/\/+$/, '');
  return value.replace(/^https?:\/\/(www\.)?/, '');
}

function normalisePhone(phone) {
  return cleanText(phone).replace(/[^\d+]/g, '');
}

function normaliseName(name) {
  return cleanText(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalisePlaceResult(place, sourceQuery = '', context = {}) {
  return {
    google_place_id: place.id || place.name || place.place_id || '',
    company_name: place.displayName?.text || place.name || '',
    website: place.websiteUri || place.website || '',
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || place.formatted_phone_number || '',
    address: place.formattedAddress || place.formatted_address || '',
    region: place.region || context.countryName || '',
    country: place.country || context.countryName || '',
    google_rating: Number(place.rating) || 0,
    google_review_count: Number(place.userRatingCount || place.user_ratings_total) || 0,
    google_types: place.types || [],
    discovery_source_query: sourceQuery,
  };
}

function dedupePlaces(candidates = []) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const keys = [
      candidate.website && `web:${normaliseUrl(candidate.website)}`,
      candidate.google_place_id && `place:${candidate.google_place_id}`,
      candidate.phone && `phone:${normalisePhone(candidate.phone)}`,
      candidate.company_name && `name:${normaliseName(candidate.company_name)}`,
    ].filter(Boolean);
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    out.push(candidate);
  }
  return out;
}

function quoteSystemToPricingSignal(quoteSystem) {
  if (quoteSystem === 'automated_quote') return 'good_calculator';
  if (quoteSystem === 'bad_calculator') return 'bad_calculator';
  if (quoteSystem === 'upload_no_instant_price') return 'bad_calculator';
  if (quoteSystem === 'manual_email_quote') return 'no_instant_quote';
  if (quoteSystem === 'manual_form') return 'manual_form';
  if (quoteSystem === 'no_quote_system') return 'no_instant_quote';
  return 'unknown';
}

function salesBoostSummary(record, classifications) {
  const name = record.company_name || 'this business';
  const quote = classifications.quote_system.replace(/_/g, ' ');
  const reviews = record.google_review_count
    ? `${record.google_review_count} Google review(s)`
    : 'its existing local demand';
  if (classifications.custom_fdm_status === 'review_needed') {
    return `${name} needs manual verification before outreach. If they do offer custom FDM printing, Trennen can help make the quote path faster and clearer.`;
  }
  if (classifications.custom_fdm_status === 'not_target') {
    return `${name} does not currently look like a custom FDM print-service prospect. Keep it out of outreach unless manual research proves otherwise.`;
  }
  if (classifications.quote_system === 'automated_quote') {
    return `${name} appears to have an online quote workflow, so Trennen should be positioned as a benchmark: faster STL pricing, clearer checkout, and better follow-up rather than a basic quoting replacement.`;
  }
  return `${name} has ${quote} signals. Trennen can help convert ${reviews} into more completed quote requests by giving FDM customers faster pricing, clearer material choices, and fewer manual back-and-forth steps.`;
}

function pitchAngle(record, classifications) {
  if (classifications.custom_fdm_status === 'review_needed') {
    return 'Verify whether they sell custom FDM printing before writing outreach.';
  }
  if (classifications.custom_fdm_status === 'not_target') {
    return 'Do not contact unless manual research confirms custom FDM services.';
  }
  if (classifications.quote_system === 'automated_quote') {
    return 'Lead with a quick benchmark of their current quote flow and ask whether abandoned quote requests are visible.';
  }
  if (classifications.quote_system === 'manual_email_quote') {
    return 'Lead with the cost of asking customers to email files before they know price or turnaround.';
  }
  if (classifications.quote_system === 'manual_form') {
    return 'Lead with replacing manual quote forms with instant guided FDM pricing.';
  }
  return 'Lead with a short quote-flow audit and a specific improvement opportunity.';
}

function discoveryRecordToLead(record) {
  const classifications = record.classifications || {};
  const sourceName = record.discovery_source === 'seed_list' ? 'Seed website audit' : 'Google Places';
  const lead = researchCore.normaliseLead({
    company_name: record.company_name,
    website: record.website,
    contact_email: record.email,
    contact_phone: record.phone,
    city: record.city || '',
    region: record.region || 'New Zealand',
    services: classifications.fdm_status === 'fdm_confirmed' ? 'FDM 3D printing' : '3D printing service',
    source: `${sourceName}${record.discovery_source_query ? `: ${record.discovery_source_query}` : ''}`,
    status: record.email && ['target_confirmed', 'target_likely'].includes(classifications.custom_fdm_status) ? 'ready' : 'research',
    pricing_signal: quoteSystemToPricingSignal(classifications.quote_system || 'unknown'),
    traffic_band: classifications.traffic_score >= 75 ? 'high' : classifications.traffic_score >= 55 ? 'medium' : 'low',
    conversion_leak_score: classifications.conversion_leak_score,
    business_fit_score: classifications.business_fit_score,
    contactability_score: classifications.contactability_score,
    confidence: classifications.confidence || 'estimated',
    evidence: classifications.evidence || [],
    notes: [
      classifications.target_reason || '',
      record.address,
      record.google_rating ? `Google rating ${record.google_rating} from ${record.google_review_count || 0} review(s).` : '',
      classifications.notes || '',
    ].filter(Boolean).join('\n'),
    pain_point: `Current quote-system classification: ${(classifications.quote_system || 'unknown').replace(/_/g, ' ')}.`,
    sales_boost_summary: salesBoostSummary(record, classifications),
    pitch_angle: pitchAngle(record, classifications),
    fdm_status: classifications.fdm_status,
    custom_fdm_status: classifications.custom_fdm_status,
    service_model: classifications.service_model,
    service_presence_status: classifications.service_presence_status,
    target_reason: classifications.target_reason,
    quote_system: classifications.quote_system,
    pricing_maturity: classifications.pricing_maturity,
    opportunity_type: classifications.opportunity_type,
    google_place_id: record.google_place_id,
    google_rating: record.google_rating,
    google_review_count: record.google_review_count,
    discovery_confidence: classifications.confidence,
  });

  return {
    ...lead,
    fdm_status: classifications.fdm_status || 'unknown',
    custom_fdm_status: classifications.custom_fdm_status || 'review_needed',
    service_model: classifications.service_model || 'unknown',
    service_presence_status: classifications.service_presence_status || 'unknown',
    target_reason: classifications.target_reason || '',
    quote_system: classifications.quote_system || 'unknown',
    pricing_maturity: classifications.pricing_maturity || 'unknown',
    opportunity_type: classifications.opportunity_type || 'verify_service',
    google_place_id: record.google_place_id || '',
    google_rating: Number(record.google_rating) || 0,
    google_review_count: Number(record.google_review_count) || 0,
    discovery_confidence: classifications.confidence || 'estimated',
  };
}

module.exports = {
  classifyWebsitePages,
  dedupePlaces,
  discoveryRecordToLead,
  normalisePlaceResult,
  stripHtml,
  scoreReviewDemand,
};
