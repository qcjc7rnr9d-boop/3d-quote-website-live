const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateLeadScores,
  discoveryJsonToLeads,
  normaliseLead,
  csvToLeads,
  leadsToResearchCsv,
  leadsToEmailCsv,
  generateCompanyBrief,
  leadToPresentationRow,
  generateDashboardInsights,
  generateMiniDeck,
  generatePitchDeck,
  generateDeckEvidenceLedger,
  deckReadiness,
  refreshLeadFromDiscoveryData,
  generateScoreExplanation,
  leadsToPresentationCsv,
  leadsToDeckMarkdown,
  mergeLeadLists,
  leadIdentityKeys,
  markNewLeads,
  generateOutreachEmail,
  outreachEligibility,
  updateLeadPipelineStatus,
  leadsToSelectedEmailCsv,
  leadsToCallSheetCsv,
} = require('./prospect-research-core.js');

test('calculateLeadScores weights pricing friction, traffic, conversion leak, fit, and contactability', () => {
  const scored = calculateLeadScores({
    pricing_signal: 'no_instant_quote',
    traffic_band: 'high',
    conversion_leak_score: 85,
    business_fit_score: 80,
    contactability_score: 70,
  });

  assert.equal(scored.pricing_friction_score, 95);
  assert.equal(scored.traffic_score, 90);
  assert.equal(scored.opportunity_score, 86);
});

test('generateScoreExplanation describes opportunity score weights and tiers', () => {
  const lead = normaliseLead({
    company_name: 'Score FDM',
    pricing_signal: 'no_instant_quote',
    traffic_band: 'high',
    conversion_leak_score: 85,
    business_fit_score: 80,
    contactability_score: 70,
  });

  const explanation = generateScoreExplanation(lead);

  assert.equal(explanation.score, 86);
  assert.equal(explanation.tier.key, 'strong');
  assert.match(explanation.meaning, /opportunity score/i);
  assert.match(explanation.meaning, /not a claim/i);
  assert.deepEqual(
    explanation.components.map(component => [component.key, component.weight]),
    [
      ['pricing_friction', 30],
      ['conversion_leak', 25],
      ['demand_proxy', 20],
      ['custom_fdm_fit', 15],
      ['contactability', 10],
    ]
  );
  assert.equal(explanation.components.reduce((sum, component) => sum + component.weight, 0), 100);
});

test('normaliseLead creates a sales-help summary without fake exact conversion claims', () => {
  const lead = normaliseLead({
    company: '  Wellington 3D Prints ',
    website: 'https://example.co.nz',
    email: 'HELLO@EXAMPLE.CO.NZ',
    pricing: 'manual_form',
    traffic: 'medium',
    conversion_leak_score: 75,
    confidence: 'estimated',
    pain_point: 'Customers must wait for a manual quote.',
  });

  assert.equal(lead.company_name, 'Wellington 3D Prints');
  assert.equal(lead.contact_email, 'hello@example.co.nz');
  assert.equal(lead.pricing_signal, 'manual_form');
  assert.match(lead.sales_boost_summary, /manual quote/i);
  assert.doesNotMatch(lead.sales_boost_summary, /\d+% conversion/i);
});

test('csvToLeads accepts common raw lead headers', () => {
  const csv = [
    'company,website,email,city,notes',
    'Maker Lab,https://maker.example,team@maker.example,Auckland,"No visible instant quote"',
  ].join('\n');

  const leads = csvToLeads(csv);

  assert.equal(leads.length, 1);
  assert.equal(leads[0].company_name, 'Maker Lab');
  assert.equal(leads[0].contact_email, 'team@maker.example');
  assert.equal(leads[0].city, 'Auckland');
  assert.match(leads[0].notes, /instant quote/);
});

test('leadIdentityKeys generates stable keys for skip and merge matching', () => {
  const keys = leadIdentityKeys({
    google_place_id: 'places/abc',
    website: 'https://www.Example.nz/',
    contact_email: 'HELLO@EXAMPLE.NZ',
    contact_phone: '(09) 123-4567',
    company_name: 'Maker Lab Ltd',
  });

  assert.ok(keys.includes('place:places/abc'));
  assert.ok(keys.includes('web:example.nz'));
  assert.ok(keys.includes('email:hello@example.nz'));
  assert.ok(keys.includes('phone:091234567'));
  assert.ok(keys.includes('name:makerlabltd'));
});

test('mergeLeadLists matches duplicates by secondary identity keys', () => {
  const merged = mergeLeadLists([
    normaliseLead({
      company_name: 'Existing Maker',
      website: 'https://old.example',
      contact_phone: '09 123 4567',
      notes: 'keep me',
    }),
  ], [
    normaliseLead({
      company_name: 'Updated Maker',
      website: 'https://new.example',
      contact_phone: '(09) 123-4567',
      google_review_count: 7,
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].company_name, 'Updated Maker');
  assert.equal(merged[0].notes, 'keep me');
  assert.equal(merged[0].google_review_count, 7);
});

test('markNewLeads flags genuinely new incoming leads without marking duplicates', () => {
  const existing = [
    normaliseLead({
      company_name: 'Known Print',
      website: 'https://known.example',
    }),
  ];
  const incoming = [
    normaliseLead({
      company_name: 'Known Print Updated',
      website: 'https://known.example/',
    }),
    normaliseLead({
      company_name: 'Fresh Print',
      website: 'https://fresh.example',
    }),
  ];

  const marked = markNewLeads(existing, incoming, {
    now: '2026-05-14T01:02:03.000Z',
    source: 'Seed audit',
    batch: 'batch-1',
  });

  assert.equal(marked[0].newly_added_at, '');
  assert.equal(marked[1].newly_added_at, '2026-05-14T01:02:03.000Z');
  assert.equal(marked[1].newly_added_source, 'Seed audit');
  assert.equal(marked[1].newly_added_batch, 'batch-1');
});

test('leadsToEmailCsv exports outreach-ready fields only', () => {
  const leads = [
    normaliseLead({
      company_name: 'Ready Prints',
      contact_email: 'owner@ready.example',
      website: 'https://ready.example',
      status: 'ready',
      custom_fdm_status: 'target_confirmed',
      service_model: 'custom_fdm_service',
      pricing_signal: 'bad_calculator',
      traffic_band: 'medium',
      conversion_leak_score: 70,
      pain_point: 'Calculator hides the final price.',
      pitch_angle: 'Lead with a quote-flow audit.',
      confidence: 'observed',
    }),
    normaliseLead({
      company_name: 'Missing Email',
      status: 'ready',
    }),
  ];

  const csv = leadsToEmailCsv(leads);

  assert.match(csv, /Ready Prints/);
  assert.match(csv, /owner@ready.example/);
  assert.match(csv, /quote-flow audit/);
  assert.doesNotMatch(csv, /Missing Email/);
});

test('leadsToEmailCsv excludes review and non-target discovery results', () => {
  const leads = [
    normaliseLead({
      company_name: 'Target FDM',
      contact_email: 'target@example.test',
      status: 'ready',
      custom_fdm_status: 'target_likely',
      quote_system: 'manual_email_quote',
    }),
    normaliseLead({
      company_name: 'Needs Review',
      contact_email: 'review@example.test',
      status: 'ready',
      custom_fdm_status: 'review_needed',
    }),
    normaliseLead({
      company_name: 'Supplier Store',
      contact_email: 'store@example.test',
      status: 'ready',
      custom_fdm_status: 'not_target',
    }),
  ];

  const csv = leadsToEmailCsv(leads);

  assert.match(csv, /Target FDM/);
  assert.doesNotMatch(csv, /Needs Review/);
  assert.doesNotMatch(csv, /Supplier Store/);
});

test('normaliseLead maps legacy status into simple pipeline status', () => {
  assert.equal(normaliseLead({ company_name: 'New', status: 'research' }).pipeline_status, 'new_lead');
  assert.equal(normaliseLead({ company_name: 'Ready', status: 'ready' }).pipeline_status, 'researched');
  assert.equal(normaliseLead({ company_name: 'Sent', status: 'exported' }).pipeline_status, 'emailed');
  assert.equal(normaliseLead({ company_name: 'Suppressed', status: 'not_fit' }).pipeline_status, 'do_not_contact');
  assert.equal(normaliseLead({ company_name: 'Explicit', status: 'ready', pipeline_status: 'called' }).pipeline_status, 'called');
});

test('updateLeadPipelineStatus updates compatibility status, contact timestamps, suppression, and notes', () => {
  const called = updateLeadPipelineStatus(
    normaliseLead({ company_name: 'Call Me', status: 'research' }),
    'called',
    {
      now: '2026-05-14T02:00:00.000Z',
      contact_notes: 'Left voicemail.',
      next_follow_up_at: '2026-05-21',
    }
  );

  assert.equal(called.pipeline_status, 'called');
  assert.equal(called.status, 'ready');
  assert.equal(called.last_contacted_at, '2026-05-14T02:00:00.000Z');
  assert.equal(called.next_follow_up_at, '2026-05-21');
  assert.equal(called.contact_notes, 'Left voicemail.');

  const blocked = updateLeadPipelineStatus(called, 'do_not_contact', {
    now: '2026-05-14T03:00:00.000Z',
    contact_notes: 'Asked not to be contacted.',
  });

  assert.equal(blocked.pipeline_status, 'do_not_contact');
  assert.equal(blocked.status, 'not_fit');
  assert.equal(blocked.do_not_contact, true);
  assert.match(blocked.contact_notes, /Asked not to be contacted/);
});

test('selected outreach exports exclude do-not-contact, not-interested, and non-target leads', () => {
  const selected = [
    normaliseLead({
      company_name: 'Ready FDM',
      contact_email: 'ready@example.test',
      contact_phone: '021 111 222',
      pipeline_status: 'researched',
      custom_fdm_status: 'target_confirmed',
      quote_system: 'manual_form',
      pitch_angle: 'Worth a quick quote-flow audit.',
      pain_point: 'Manual form creates waiting time.',
    }),
    normaliseLead({
      company_name: 'No Thanks',
      contact_email: 'no@example.test',
      pipeline_status: 'not_interested',
      custom_fdm_status: 'target_confirmed',
    }),
    normaliseLead({
      company_name: 'Supplier',
      contact_email: 'supplier@example.test',
      pipeline_status: 'researched',
      custom_fdm_status: 'not_target',
    }),
    normaliseLead({
      company_name: 'Blocked',
      contact_email: 'blocked@example.test',
      pipeline_status: 'do_not_contact',
      custom_fdm_status: 'target_likely',
    }),
  ];

  const emailCsv = leadsToSelectedEmailCsv(selected);
  assert.match(emailCsv, /Ready FDM/);
  assert.match(emailCsv, /pipeline_status/);
  assert.doesNotMatch(emailCsv, /No Thanks/);
  assert.doesNotMatch(emailCsv, /Supplier/);
  assert.doesNotMatch(emailCsv, /Blocked/);

  const callCsv = leadsToCallSheetCsv(selected);
  assert.match(callCsv, /Ready FDM/);
  assert.match(callCsv, /021 111 222/);
  assert.match(callCsv, /next_action/);
  assert.doesNotMatch(callCsv, /No Thanks/);
  assert.doesNotMatch(callCsv, /Supplier/);
  assert.doesNotMatch(callCsv, /Blocked/);
});

test('generateOutreachEmail creates casual evidence-safe copy with deck attachment context', () => {
  const lead = normaliseLead({
    company_name: 'Boarding FDM',
    contact_name: 'Sam',
    contact_email: 'sam@boarding.example',
    website: 'https://boarding.example',
    status: 'ready',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_email_quote',
    pricing_signal: 'no_instant_quote',
    pain_point: 'Customers appear to email CAD files before seeing price or turnaround.',
    target_reason: 'Observed PLA and upload STL evidence.',
    evidence: ['FDM signal: PLA', 'Quote signal: email CAD files'],
    deck_status: 'ready',
  });

  const email = generateOutreachEmail(lead, {
    senderName: 'Daniel',
    senderBusiness: 'Trennen',
    unsubscribeEmail: 'hello@trennen.co.nz',
  });

  assert.match(email.subject, /Boarding FDM|quote/i);
  assert.match(email.text, /Hey Sam/);
  assert.match(email.text, /public/i);
  assert.match(email.text, /attached/i);
  assert.match(email.text, /email CAD files/i);
  assert.match(email.text, /Trennen/i);
  assert.match(email.text, /unsubscribe|don.t contact/i);
  assert.doesNotMatch(email.text, /\d+%\s*(lift|uplift|conversion|revenue|traffic)/i);
});

test('outreachEligibility excludes non-targets, missing emails, and suppressed leads', () => {
  const ready = normaliseLead({
    company_name: 'Ready FDM',
    contact_email: 'hello@ready.example',
    status: 'ready',
    custom_fdm_status: 'target_likely',
    deck_status: 'ready',
  });
  const missingEmail = normaliseLead({
    company_name: 'No Email',
    status: 'ready',
    custom_fdm_status: 'target_confirmed',
  });
  const nonTarget = normaliseLead({
    company_name: 'Printer Store',
    contact_email: 'sales@store.example',
    status: 'ready',
    custom_fdm_status: 'not_target',
  });
  const suppressed = normaliseLead({
    company_name: 'Suppressed FDM',
    contact_email: 'stop@example.test',
    status: 'ready',
    custom_fdm_status: 'target_confirmed',
  });

  assert.equal(outreachEligibility(ready).eligible, true);
  assert.equal(outreachEligibility(missingEmail).eligible, false);
  assert.match(outreachEligibility(missingEmail).reasons.join(' '), /email/i);
  assert.equal(outreachEligibility(nonTarget).eligible, false);
  assert.match(outreachEligibility(nonTarget).reasons.join(' '), /target/i);
  assert.equal(outreachEligibility(suppressed, ['email:stop@example.test']).eligible, false);
  assert.match(outreachEligibility(suppressed, ['email:stop@example.test']).reasons.join(' '), /suppressed/i);
});

test('discoveryJsonToLeads imports generated discovery output', () => {
  const json = JSON.stringify({
    leads: [
      {
        company_name: 'Discovered FDM',
        website: 'https://discovered.example',
        contact_email: 'owner@discovered.example',
        fdm_status: 'fdm_confirmed',
        quote_system: 'manual_email_quote',
        custom_fdm_status: 'target_confirmed',
        service_model: 'custom_fdm_service',
        target_reason: 'Custom FDM service evidence found.',
        discovery_confidence: 'observed',
        google_review_count: 22,
      },
    ],
  });

  const leads = discoveryJsonToLeads(json);

  assert.equal(leads.length, 1);
  assert.equal(leads[0].fdm_status, 'fdm_confirmed');
  assert.equal(leads[0].quote_system, 'manual_email_quote');
  assert.equal(leads[0].custom_fdm_status, 'target_confirmed');
  assert.equal(leads[0].service_model, 'custom_fdm_service');
  assert.match(leads[0].target_reason, /Custom FDM/);
  assert.equal(leads[0].google_review_count, 22);
});

test('leadsToResearchCsv exports all discovered leads for re-import', () => {
  const lead = normaliseLead({
    company_name: 'No Email Yet',
    website: 'https://no-email.example',
    fdm_status: 'fdm_likely',
    quote_system: 'upload_no_instant_price',
    custom_fdm_status: 'review_needed',
    service_model: 'generic_3d_printing',
    target_reason: 'Needs manual review for FDM evidence.',
    google_review_count: 11,
  });

  const csv = leadsToResearchCsv([lead]);
  const imported = csvToLeads(csv);

  assert.match(csv, /No Email Yet/);
  assert.equal(imported[0].quote_system, 'upload_no_instant_price');
  assert.equal(imported[0].custom_fdm_status, 'review_needed');
  assert.equal(imported[0].service_model, 'generic_3d_printing');
  assert.match(imported[0].target_reason, /manual review/);
  assert.equal(imported[0].google_review_count, 11);
});

test('generateCompanyBrief creates presentation-safe manual email business case', () => {
  const lead = normaliseLead({
    company_name: 'Davis Custom 3D Prints',
    website: 'https://daviscustom3dprints.example',
    city: 'Auckland',
    contact_email: 'hello@daviscustom3dprints.example',
    custom_fdm_status: 'target_confirmed',
    service_model: 'custom_fdm_service',
    fdm_status: 'fdm_confirmed',
    quote_system: 'manual_email_quote',
    pricing_signal: 'no_instant_quote',
    traffic_band: 'low',
    conversion_leak_score: 82,
    business_fit_score: 90,
    contactability_score: 85,
    google_rating: 4,
    google_review_count: 4,
    target_reason: 'Custom FDM service evidence found: PLA + filament + custom 3D print.',
    evidence: ['FDM signal: PLA', 'Quote signal: email CAD files'],
  });

  const brief = generateCompanyBrief(lead);

  assert.equal(brief.company_name, 'Davis Custom 3D Prints');
  assert.match(brief.headline, /manual quote/i);
  assert.match(brief.sales_leak, /email/i);
  assert.match(brief.demand_proxy, /4 Google review/);
  assert.ok(brief.how_trennen_helps.length >= 3);
  assert.match(brief.recommended_next_step, /quote-flow/i);
  assert.equal(brief.confidence, 'observed');
  assert.doesNotMatch(brief.copy, /\b\d+%|\bconversion rate\b|visitors per month|revenue/i);
});

test('generateCompanyBrief adapts to manual form, upload workflow, automated quote, and review-needed leads', () => {
  const manualForm = generateCompanyBrief(normaliseLead({
    company_name: 'Form FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    google_review_count: 43,
    target_reason: 'Custom FDM service evidence found.',
  }));
  const upload = generateCompanyBrief(normaliseLead({
    company_name: 'Upload FDM',
    custom_fdm_status: 'target_likely',
    quote_system: 'upload_no_instant_price',
    target_reason: 'FDM/material evidence plus quote/order workflow found.',
  }));
  const automated = generateCompanyBrief(normaliseLead({
    company_name: 'Auto FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'automated_quote',
    target_reason: 'Custom FDM service evidence found.',
  }));
  const review = generateCompanyBrief(normaliseLead({
    company_name: 'Review FDM',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
    target_reason: '3D printing service evidence found, but FDM/material evidence is missing or weak.',
  }));

  assert.match(manualForm.sales_leak, /form/i);
  assert.match(upload.sales_leak, /upload/i);
  assert.match(automated.sales_leak, /benchmark/i);
  assert.match(review.recommended_next_step, /verify/i);
  assert.equal(review.confidence, 'needs_review');
});

test('presentation exports include target leads by default and optional review leads', () => {
  const target = normaliseLead({
    company_name: 'Target FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    contact_email: 'target@example.test',
    target_reason: 'Custom FDM service evidence found.',
  });
  const review = normaliseLead({
    company_name: 'Needs Review',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
    target_reason: 'Needs manual review.',
  });
  const supplier = normaliseLead({
    company_name: 'Supplier Store',
    custom_fdm_status: 'not_target',
    service_model: 'supplier_store',
    quote_system: 'unknown',
  });

  const defaultMarkdown = leadsToDeckMarkdown([target, review, supplier]);
  const reviewMarkdown = leadsToDeckMarkdown([target, review, supplier], { includeReview: true });
  const csv = leadsToPresentationCsv([target, review, supplier]);

  assert.match(defaultMarkdown, /Target FDM/);
  assert.doesNotMatch(defaultMarkdown, /Needs Review/);
  assert.doesNotMatch(defaultMarkdown, /Supplier Store/);
  assert.match(reviewMarkdown, /Needs Review/);
  assert.match(csv.split('\n')[0], /headline,evidence,sales_leak,how_trennen_helps,pitch_angle,confidence,recommended_next_step/);
  assert.match(csv, /Target FDM/);
  assert.doesNotMatch(csv, /Supplier Store/);
});

test('leadToPresentationRow returns deck-building fields without unsafe analytics claims', () => {
  const row = leadToPresentationRow(normaliseLead({
    company_name: 'Pitch Ready',
    custom_fdm_status: 'target_likely',
    quote_system: 'upload_no_instant_price',
    google_review_count: 12,
    target_reason: 'FDM/material evidence plus upload workflow found.',
    pitch_angle: 'Lead with a quick upload-flow audit.',
  }));

  assert.equal(row.company_name, 'Pitch Ready');
  assert.match(row.headline, /Pitch Ready/);
  assert.match(row.evidence, /upload workflow/i);
  assert.match(row.sales_leak, /upload/i);
  assert.match(row.how_trennen_helps, /instant/i);
  assert.match(row.pitch_angle, /upload-flow audit/);
  assert.doesNotMatch(Object.values(row).join(' '), /\b\d+%|\bconversion rate\b|visitors per month|revenue/i);
});

test('generateDashboardInsights condenses prospects into chart-ready counts and top actions', () => {
  const leads = [
    normaliseLead({
      company_name: 'Manual Target',
      custom_fdm_status: 'target_confirmed',
      quote_system: 'manual_email_quote',
      pricing_signal: 'no_instant_quote',
      traffic_band: 'high',
      conversion_leak_score: 85,
      business_fit_score: 90,
      contactability_score: 90,
      status: 'ready',
      contact_email: 'manual@example.test',
    }),
    normaliseLead({
      company_name: 'Upload Target',
      custom_fdm_status: 'target_likely',
      quote_system: 'upload_no_instant_price',
      pricing_signal: 'unclear_pricing',
      traffic_band: 'medium',
      conversion_leak_score: 65,
      business_fit_score: 78,
      contactability_score: 50,
    }),
    normaliseLead({
      company_name: 'Review Needed',
      custom_fdm_status: 'review_needed',
      quote_system: 'unknown',
      traffic_band: 'unknown',
    }),
  ];

  const insights = generateDashboardInsights(leads);

  assert.equal(insights.stats.targetLeads, 2);
  assert.equal(insights.stats.needsReview, 1);
  assert.equal(insights.stats.emailReady, 1);
  assert.equal(insights.quoteSystem.find(item => item.key === 'manual').count, 1);
  assert.equal(insights.quoteSystem.find(item => item.key === 'upload').count, 1);
  assert.equal(insights.customFdmFit.find(item => item.key === 'target').count, 2);
  assert.equal(insights.topProspects[0].company_name, 'Manual Target');
  assert.ok(insights.demandContactability.averageDemandScore > 0);
  assert.ok(insights.frictionLeak.averagePricingFriction > 0);
});

test('generateMiniDeck creates a printable four-slide customer case without unsafe analytics claims', () => {
  const deck = generateMiniDeck(normaliseLead({
    company_name: 'Deck FDM',
    website: 'https://deck.example',
    city: 'Wellington',
    custom_fdm_status: 'target_confirmed',
    service_model: 'custom_fdm_service',
    quote_system: 'manual_form',
    pricing_signal: 'manual_form',
    traffic_band: 'medium',
    conversion_leak_score: 75,
    business_fit_score: 88,
    contactability_score: 80,
    google_review_count: 21,
    target_reason: 'Custom FDM service evidence found: PLA, PETG, quote form.',
    evidence: ['PLA and PETG listed', 'Request a quote form found'],
  }));

  assert.equal(deck.company_name, 'Deck FDM');
  assert.equal(deck.slides.length, 4);
  assert.match(deck.slides[0].title, /Deck FDM/);
  assert.match(deck.slides[1].title, /customers/i);
  assert.match(deck.slides[2].title, /sales/i);
  assert.match(deck.slides[3].title, /Trennen/i);
  assert.match(deck.email_intro, /quote-flow/i);
  assert.doesNotMatch(JSON.stringify(deck), /\b\d+%|\bconversion rate\b|visitors per month|revenue/i);
});

test('generatePitchDeck creates a detailed evidence-led deck with readiness and appendix', () => {
  const lead = normaliseLead({
    company_name: 'Boarding FDM',
    website: 'https://boarding.example',
    city: 'Auckland',
    custom_fdm_status: 'target_confirmed',
    service_model: 'custom_fdm_service',
    fdm_status: 'fdm_confirmed',
    quote_system: 'manual_email_quote',
    pricing_signal: 'no_instant_quote',
    traffic_band: 'medium',
    conversion_leak_score: 82,
    business_fit_score: 92,
    contactability_score: 86,
    google_rating: 4.8,
    google_review_count: 33,
    contact_email: 'hello@boarding.example',
    target_reason: 'Custom FDM service evidence found: PLA + PETG + send STL.',
    evidence: ['FDM signal: "PLA"', 'Custom service signal: "send STL"', 'Quote signal: "email CAD"'],
    notes: 'Manual note: owner appears to serve local prototypes.',
  });

  const deck = generatePitchDeck(lead);

  assert.equal(deck.company_name, 'Boarding FDM');
  assert.equal(deck.status, 'ready');
  assert.ok(deck.generated_at);
  assert.ok(deck.last_checked_at);
  assert.equal(deck.slides.length, 7);
  assert.match(deck.slides[0].bullets.join(' '), /Boarding FDM/);
  assert.match(deck.slides[1].title, /quote-flow audit/i);
  assert.equal(deck.slides[2].layout, 'changeable_metrics');
  assert.match(deck.slides[6].title, /evidence appendix/i);
  assert.ok(deck.evidence.length >= 5);
  assert.ok(deck.evidence.every(item => item.claim && item.source_type && item.confidence && item.last_checked_at));
  assert.match(deck.email_intro, /Boarding FDM/);
  assert.doesNotMatch(JSON.stringify(deck), /\b\d+%|\bconversion rate\b|visitors per month|revenue|uplift/i);
});

test('generatePitchDeck returns template-aligned slide layouts and design fields', () => {
  const deck = generatePitchDeck(normaliseLead({
    company_name: 'Template FDM',
    website: 'https://template.example',
    custom_fdm_status: 'target_confirmed',
    service_model: 'custom_fdm_service',
    fdm_status: 'fdm_confirmed',
    quote_system: 'manual_form',
    pricing_signal: 'manual_form',
    traffic_band: 'medium',
    conversion_leak_score: 82,
    business_fit_score: 90,
    contactability_score: 80,
    google_rating: 4.9,
    google_review_count: 43,
    evidence: ['PLA', 'PETG', 'ABS', '3D Printing Service'],
    target_reason: 'Custom FDM service evidence found: PLA + PETG + ABS + 3D Printing Service.',
  }));

  assert.deepEqual(deck.slides.map(slide => slide.layout), [
    'cover',
    'observed_situation',
    'changeable_metrics',
    'proposed_solution',
    'before_after',
    'small_ask',
    'evidence_appendix',
  ]);
  assert.ok(deck.theme);
  assert.equal(deck.guided_quote_path.length, 5);
  assert.equal(deck.metric_cards.length, 4);
  assert.ok(deck.calculator.cards.every(card => /\[.*\]/.test(card.value)));
  assert.ok(deck.before_after.before.length >= 3);
  assert.ok(deck.before_after.after.length >= 3);
  assert.ok(deck.appendix_rows.every(row => row.field && row.value && row.confidence));
  assert.match(deck.footer_note, /Editable client metric fields/);
});

test('generatePitchDeck uses bracketed placeholders for uncertain calculator metrics', () => {
  const deck = generatePitchDeck(normaliseLead({
    company_name: 'Unknown Metrics FDM',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
    traffic_band: 'unknown',
  }));

  assert.equal(deck.slides[2].layout, 'changeable_metrics');
  assert.ok(deck.calculator.cards.some(card => card.value === '[30]'));
  assert.ok(deck.calculator.cards.some(card => card.value === '[35 percent]'));
  assert.ok(deck.warnings.length > 0);
  assert.doesNotMatch(JSON.stringify(deck), /\b35%|\bconversion rate\b|visitors per month|revenue|uplift/i);
});

test('generatePitchDeck explains external audit data sources and confidence', () => {
  const deck = generatePitchDeck(normaliseLead({
    company_name: 'Audit Source FDM',
    website: 'https://audit.example',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    google_review_count: 18,
    google_rating: 4.7,
    evidence: ['FDM signal: "PLA"', 'Quote signal: "request a quote"'],
    target_reason: 'Website shows PLA and request-a-quote workflow.',
  }));

  const text = JSON.stringify(deck);

  assert.match(text, /external audit/i);
  assert.match(text, /public website/i);
  assert.match(text, /Google/i);
  assert.match(text, /not private analytics/i);
  assert.ok(deck.audit_methodology.sources.some(source => /website/i.test(source.label)));
  assert.ok(deck.audit_methodology.sources.some(source => /Google/i.test(source.label)));
  assert.ok(deck.appendix_rows.some(row => /How data was gathered/i.test(row.field)));
});

test('generatePitchDeck calculator shows formula, editable assumptions, and no fake precise result', () => {
  const deck = generatePitchDeck(normaliseLead({
    company_name: 'Calculator FDM',
    custom_fdm_status: 'target_likely',
    quote_system: 'manual_email_quote',
    google_review_count: 44,
    evidence: ['FDM signal: "PETG"', 'Quote signal: "email CAD files"'],
  }));

  assert.equal(deck.calculator.cards.length, 4);
  assert.match(deck.calculator.formula, /\[quote requests per month\]/i);
  assert.match(deck.calculator.impact_line, /replace the bracketed values/i);
  assert.doesNotMatch(deck.calculator.impact_line, /\d+\s*x\s*\d+\s*=/i);
  assert.doesNotMatch(JSON.stringify(deck.calculator), /\bconversion rate\b|revenue|uplift|\d+%/i);
});

test('generatePitchDeck positions Trennen against manual and automated quote systems honestly', () => {
  const manualDeck = generatePitchDeck(normaliseLead({
    company_name: 'Manual Quote FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_email_quote',
    pricing_signal: 'no_instant_quote',
    evidence: ['FDM signal: "PLA"', 'Quote signal: "email CAD files"'],
  }));
  const automatedDeck = generatePitchDeck(normaliseLead({
    company_name: 'Auto Quote FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'automated_quote',
    pricing_signal: 'good_calculator',
    evidence: ['FDM signal: "PETG"', 'Quote signal: "instant quote"'],
  }));

  assert.equal(manualDeck.quote_positioning.current_system, 'Manual quote workflow');
  assert.match(manualDeck.quote_positioning.why_trennen_better, /instant|guided|back-and-forth/i);
  assert.match(JSON.stringify(manualDeck.slides), /Current pricing system|Why Trennen is better/i);
  assert.equal(automatedDeck.quote_positioning.current_system, 'Automated quote workflow observed');
  assert.match(automatedDeck.quote_positioning.why_trennen_better, /benchmark|clarity|follow-up/i);
  assert.doesNotMatch(JSON.stringify(automatedDeck), /no quote system|manual quote by file email is a clear sales friction point/i);
});

test('generateOutreachEmail talks around the observed quote system', () => {
  const manualEmail = generateOutreachEmail(normaliseLead({
    company_name: 'Manual Email FDM',
    contact_email: 'hello@example.test',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_email_quote',
    evidence: ['Quote signal: "email CAD files"'],
  }));
  const automatedEmail = generateOutreachEmail(normaliseLead({
    company_name: 'Auto Email FDM',
    contact_email: 'hello@example.test',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'automated_quote',
    evidence: ['Quote signal: "instant quote"'],
  }));

  assert.match(manualEmail.text, /manual|email/i);
  assert.match(manualEmail.text, /guided|instant|back-and-forth/i);
  assert.match(automatedEmail.text, /already have|automated/i);
  assert.match(automatedEmail.text, /benchmark|clarity|follow-up/i);
});

test('pitch deck and outreach explain support for MJF and other non-FDM services honestly', () => {
  const lead = normaliseLead({
    company_name: 'Multi Process Prints',
    contact_email: 'hello@example.test',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    evidence: ['FDM signal: "PLA"', 'Service signal: "request a quote"'],
  });

  const deck = generatePitchDeck(lead);
  const email = generateOutreachEmail(lead);
  const combined = `${JSON.stringify(deck)}\n${email.text}`;

  assert.match(combined, /\bMJF\b/i);
  assert.match(combined, /other services/i);
  assert.match(combined, /FDM pricing is the first/i);
  assert.match(combined, /step by step/i);
  assert.match(combined, /not.*auto-price.*today|not.*instant-pricing option/i);
  assert.doesNotMatch(combined, /MJF instant pricing is ready|auto-price MJF today/i);
});

test('generatePitchDeck marks weak evidence as needs evidence instead of making confident claims', () => {
  const deck = generatePitchDeck(normaliseLead({
    company_name: 'Maybe Prints',
    website: 'https://maybe.example',
    custom_fdm_status: 'review_needed',
    service_model: 'generic_3d_printing',
    quote_system: 'unknown',
    traffic_band: 'unknown',
    target_reason: '3D printing service evidence found, but FDM/material evidence is missing or weak.',
  }));

  assert.equal(deck.status, 'needs_evidence');
  assert.ok(deck.warnings.some(warning => /needs review|evidence/i.test(warning)));
  assert.match(JSON.stringify(deck), /Needs review before outreach|needs manual verification/i);
  assert.doesNotMatch(JSON.stringify(deck), /strong proof|guaranteed|will increase/i);
});

test('generateDeckEvidenceLedger labels source types and confidence for deck claims', () => {
  const lead = normaliseLead({
    company_name: 'Ledger FDM',
    website: 'https://ledger.example',
    custom_fdm_status: 'target_likely',
    quote_system: 'manual_form',
    google_rating: 4.6,
    google_review_count: 14,
    evidence: ['Quote signal: "request a quote"', 'FDM signal: "PETG"'],
    target_reason: 'FDM/material evidence plus quote/order workflow found; verify custom service fit.',
    notes: 'Manual note: good local reviews.',
  });

  const ledger = generateDeckEvidenceLedger(lead);

  assert.ok(ledger.some(item => item.source_type === 'website'));
  assert.ok(ledger.some(item => item.source_type === 'google_places'));
  assert.ok(ledger.some(item => item.source_type === 'classifier'));
  assert.ok(ledger.some(item => item.source_type === 'manual_note'));
  assert.ok(ledger.every(item => ['observed', 'estimated', 'needs_review'].includes(item.confidence)));
});

test('deckReadiness identifies ready, needs evidence, needs refresh, and not suitable leads', () => {
  const ready = deckReadiness(normaliseLead({
    company_name: 'Ready FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    evidence: ['FDM signal: "PLA"', 'Quote signal: "request a quote"'],
    deck_last_checked_at: new Date().toISOString(),
  }));
  const weak = deckReadiness(normaliseLead({
    company_name: 'Weak FDM',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
  }));
  const stale = deckReadiness(normaliseLead({
    company_name: 'Stale FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    evidence: ['FDM signal: "PLA"', 'Quote signal: "request a quote"'],
    deck_last_checked_at: '2020-01-01T00:00:00.000Z',
  }));
  const notSuitable = deckReadiness(normaliseLead({
    company_name: 'Supplier Only',
    custom_fdm_status: 'not_target',
    service_model: 'supplier_store',
  }));

  assert.equal(ready.status, 'ready');
  assert.equal(weak.status, 'needs_evidence');
  assert.equal(stale.status, 'needs_refresh');
  assert.equal(notSuitable.status, 'not_suitable');
});

test('normaliseLead auto-generates and preserves rich pitch deck fields', () => {
  const lead = normaliseLead({
    company_name: 'Auto Deck FDM',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    evidence: ['FDM signal: "PLA"', 'Quote signal: "quote form"'],
  });

  assert.equal(lead.pitch_deck.company_name, 'Auto Deck FDM');
  assert.ok(lead.deck_generated_at);
  assert.ok(lead.deck_last_checked_at);
  assert.ok(Array.isArray(lead.deck_evidence));
  assert.ok(Array.isArray(lead.deck_warnings));
  assert.equal(lead.deck_status, lead.pitch_deck.status);
});

test('refreshLeadFromDiscoveryData updates generated deck while preserving manual pitch edits', () => {
  const existing = normaliseLead({
    company_name: 'Refresh FDM',
    website: 'https://refresh.example',
    pitch_angle: 'Manual pitch stays.',
    notes: 'Manual note stays.',
    target_reason: 'Manual target reason stays.',
    custom_fdm_status: 'review_needed',
    quote_system: 'unknown',
  });
  const refreshed = normaliseLead({
    company_name: 'Refresh FDM Updated',
    website: 'https://refresh.example/',
    pitch_angle: 'Generated pitch should not override.',
    notes: 'Generated note should not override.',
    target_reason: 'Generated target should not override.',
    custom_fdm_status: 'target_confirmed',
    quote_system: 'manual_form',
    evidence: ['FDM signal: "PLA"', 'Quote signal: "request a quote"'],
    google_review_count: 28,
  });

  const merged = refreshLeadFromDiscoveryData(existing, refreshed, '2026-05-14T00:00:00.000Z');

  assert.equal(merged.company_name, 'Refresh FDM Updated');
  assert.equal(merged.pitch_angle, 'Manual pitch stays.');
  assert.equal(merged.notes, 'Manual note stays.');
  assert.equal(merged.target_reason, 'Manual target reason stays.');
  assert.equal(merged.google_review_count, 28);
  assert.equal(merged.deck_last_checked_at, '2026-05-14T00:00:00.000Z');
  assert.equal(merged.pitch_deck.status, 'ready');
});

test('mergeLeadLists preserves manual pitch notes and target reason on duplicate discovery import', () => {
  const merged = mergeLeadLists([
    normaliseLead({
      company_name: 'Manual FDM',
      website: 'https://manual.example',
      pitch_angle: 'Manual pitch angle.',
      notes: 'Manual internal note.',
      target_reason: 'Manual target research note.',
    }),
  ], [
    normaliseLead({
      company_name: 'Manual FDM Updated',
      website: 'https://manual.example/',
      pitch_angle: 'Generated pitch angle.',
      notes: 'Generated note.',
      target_reason: 'Generated target reason.',
      google_review_count: 19,
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].company_name, 'Manual FDM Updated');
  assert.equal(merged[0].pitch_angle, 'Manual pitch angle.');
  assert.equal(merged[0].notes, 'Manual internal note.');
  assert.equal(merged[0].target_reason, 'Manual target research note.');
  assert.equal(merged[0].google_review_count, 19);
});
