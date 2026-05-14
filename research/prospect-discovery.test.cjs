const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyWebsitePages,
  dedupePlaces,
  normalisePlaceResult,
  discoveryRecordToLead,
} = require('./prospect-discovery-core.cjs');
const { leadsToEmailCsv } = require('./prospect-research-core.js');

test('classifies Davis-style CAD email page as manual email quote with high friction', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/custom-orders',
      text: 'Custom orders: email us your CAD files and we will work out print prices once files are set up.',
    },
  ]);

  assert.equal(result.fdm_status, 'fdm_likely');
  assert.equal(result.quote_system, 'manual_email_quote');
  assert.ok(result.pricing_friction_score >= 85);
  assert.match(result.evidence.join(' '), /email/i);
});

test('classifies custom FDM CAD email service as a confirmed target', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/custom-orders',
      text: 'Custom FDM 3D printing service. Email your CAD or STL files for PLA and PETG parts and we will work out the print price.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'target_confirmed');
  assert.equal(result.service_model, 'custom_fdm_service');
  assert.equal(result.quote_system, 'manual_email_quote');
  assert.match(result.target_reason, /custom FDM service/i);
});

test('classifies upload/order/payment flow without instant price as upload_no_instant_price', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/home',
      text: 'Upload your STL file, select material, place order and pay online. We will review your model before confirming price.',
    },
  ]);

  assert.equal(result.fdm_status, 'fdm_likely');
  assert.equal(result.quote_system, 'upload_no_instant_price');
});

test('classifies FDM upload/order/payment flow as a custom FDM target', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/home',
      text: 'Upload your STL file for custom FDM printing, choose PLA or PETG material, place order and pay online. We review your model before confirming price.',
    },
  ]);

  assert.ok(['target_confirmed', 'target_likely'].includes(result.custom_fdm_status));
  assert.equal(result.quote_system, 'upload_no_instant_price');
  assert.notEqual(result.service_model, 'supplier_store');
});

test('classifies resin-only site as not FDM confirmed', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test',
      text: 'We offer resin SLA miniatures and high-detail resin printing only. No filament services.',
    },
  ]);

  assert.equal(result.fdm_status, 'not_fdm');
  assert.equal(result.custom_fdm_status, 'not_target');
  assert.equal(result.service_model, 'resin_only');
});

test('classifies PLA PETG FDM service as FDM confirmed', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test',
      text: 'FDM 3D printing service using PLA, PETG, ABS and other filament materials.',
    },
  ]);

  assert.equal(result.fdm_status, 'fdm_confirmed');
});

test('classifies printer and filament store without service wording as not target supplier store', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/shop',
      text: 'Shop PLA filament, PETG filament, spare nozzles, 3D printers, accessories and replacement parts. Add to cart for fast NZ delivery.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'not_target');
  assert.equal(result.service_model, 'supplier_store');
  assert.match(result.target_reason, /supplier/i);
});

test('keeps miniatures shops when they also offer custom FDM print services', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/pages/custom-order',
      text: 'Tabletop terrain and miniatures. Custom order commissions are welcome: send us your STL file and we print your model in PLA or PETG filament. Request a quote for custom FDM 3D printing.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'target_confirmed');
  assert.equal(result.service_model, 'miniatures_custom_service');
  assert.equal(result.service_presence_status, 'service_confirmed');
  assert.equal(result.pricing_maturity, 'manual_quote');
  assert.equal(result.opportunity_type, 'replace_manual_quoting');
  assert.match(result.target_reason, /miniatures/i);
});

test('excludes premade minis or terrain shops without custom print service evidence', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/shop',
      text: 'Shop ready-made resin miniatures, tabletop terrain, dice towers, STL file downloads and painted models. Add to cart for shipping.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'not_target');
  assert.equal(result.service_model, 'premade_products_only');
  assert.equal(result.service_presence_status, 'premade_only');
  assert.equal(result.opportunity_type, 'exclude_non_service');
  assert.match(result.target_reason, /premade/i);
});

test('keeps service businesses with strong automated slicer pricing as benchmark prospects', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/upload-3d-file',
      text: 'Upload STL file to our automatic slicer for instant pricing. Choose FDM material, PLA, PETG, layer height, infill and quantity, then add the custom 3D print to cart and checkout.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'target_confirmed');
  assert.equal(result.quote_system, 'automated_quote');
  assert.equal(result.pricing_maturity, 'automated_strong');
  assert.equal(result.opportunity_type, 'benchmark_auto_pricing');
  assert.ok(result.pricing_friction_score <= 25);
  assert.ok(result.conversion_leak_score <= 35);
});

test('keeps generic 3D printing service without FDM evidence in review', () => {
  const result = classifyWebsitePages([
    {
      url: 'https://example.test/services',
      text: 'We provide 3D printing service and rapid prototyping for local businesses. Contact us for pricing.',
    },
  ]);

  assert.equal(result.custom_fdm_status, 'review_needed');
  assert.equal(result.service_model, 'generic_3d_printing');
  assert.match(result.target_reason, /FDM/i);
});

test('keeps zero-page crawl results in review instead of target list', () => {
  const result = classifyWebsitePages([]);

  assert.equal(result.custom_fdm_status, 'review_needed');
  assert.equal(result.service_model, 'unknown');
  assert.match(result.target_reason, /No website pages/i);
});

test('normalises Google Places result into discovery candidate', () => {
  const result = normalisePlaceResult({
    id: 'places/abc',
    displayName: { text: 'Auckland Print Lab' },
    websiteUri: 'https://printlab.example',
    nationalPhoneNumber: '09 123 4567',
    formattedAddress: '1 Queen Street, Auckland, New Zealand',
    rating: 4.8,
    userRatingCount: 37,
    types: ['point_of_interest', 'store'],
  }, '3D printing service Auckland');

  assert.equal(result.google_place_id, 'places/abc');
  assert.equal(result.company_name, 'Auckland Print Lab');
  assert.equal(result.website, 'https://printlab.example');
  assert.equal(result.google_review_count, 37);
  assert.equal(result.discovery_source_query, '3D printing service Auckland');
});

test('dedupes places by website, place id, phone, then normalised name', () => {
  const places = [
    { google_place_id: 'a', company_name: 'Maker Lab', website: 'https://maker.example' },
    { google_place_id: 'b', company_name: 'Maker Lab Ltd', website: 'https://maker.example/' },
    { google_place_id: 'c', company_name: 'Other Lab', phone: '09 111 2222' },
    { google_place_id: 'd', company_name: 'Other Lab', phone: '(09) 111-2222' },
  ];

  assert.equal(dedupePlaces(places).length, 2);
});

test('discovery result feeds email-list export through research core', () => {
  const lead = discoveryRecordToLead({
    company_name: 'Ready FDM',
    website: 'https://ready.example',
    email: 'owner@ready.example',
    phone: '021 123 456',
    google_rating: 4.7,
    google_review_count: 19,
    classifications: {
      fdm_status: 'fdm_confirmed',
      quote_system: 'manual_form',
      custom_fdm_status: 'target_confirmed',
      service_model: 'custom_fdm_service',
      target_reason: 'Custom FDM service evidence found: FDM + request a quote.',
      pricing_friction_score: 85,
      traffic_score: 60,
      conversion_leak_score: 80,
      evidence: ['Request a quote form with no instant price'],
    },
  });
  lead.status = 'ready';

  const csv = leadsToEmailCsv([lead]);
  assert.match(csv, /Ready FDM/);
  assert.match(csv, /owner@ready.example/);
  assert.match(csv, /manual form/i);
  assert.match(csv, /target confirmed/i);
});
