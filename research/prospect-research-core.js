(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.ProspectResearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PRICING_FRICTION = {
    no_instant_quote: 95,
    manual_form: 85,
    bad_calculator: 70,
    unclear_pricing: 60,
    unknown: 45,
    good_calculator: 15,
  };

  const TRAFFIC_SCORE = {
    high: 90,
    medium: 60,
    low: 30,
    unknown: 40,
  };

  const SCORE_COMPONENTS = [
    {
      key: 'pricing_friction',
      label: 'Pricing friction',
      scoreField: 'pricing_friction_score',
      weight: 30,
      description: 'How much the current quote path appears to slow a motivated buyer.',
    },
    {
      key: 'conversion_leak',
      label: 'Quote-flow leak',
      scoreField: 'conversion_leak_score',
      weight: 25,
      description: 'Where the customer journey likely loses momentum before a quote request is complete.',
    },
    {
      key: 'demand_proxy',
      label: 'Demand proxy',
      scoreField: 'traffic_score',
      weight: 20,
      description: 'Estimated demand signal from Google reviews, search discovery, and manual traffic band.',
    },
    {
      key: 'custom_fdm_fit',
      label: 'Custom FDM fit',
      scoreField: 'business_fit_score',
      weight: 15,
      description: 'How clearly the business offers custom FDM printing for customer-submitted parts.',
    },
    {
      key: 'contactability',
      label: 'Contactability',
      scoreField: 'contactability_score',
      weight: 10,
      description: 'How easy it is to reach the business with a specific outreach angle.',
    },
  ];

  const STATUS_VALUES = new Set(['research', 'ready', 'exported', 'not_fit']);
  const PIPELINE_STATUS_VALUES = new Set(['new_lead', 'researched', 'emailed', 'called', 'interested', 'follow_up', 'not_interested', 'won', 'do_not_contact']);
  const PIPELINE_CONTACTED_VALUES = new Set(['emailed', 'called', 'interested', 'follow_up', 'not_interested', 'won', 'do_not_contact']);
  const PRICING_VALUES = new Set(Object.keys(PRICING_FRICTION));
  const TRAFFIC_VALUES = new Set(Object.keys(TRAFFIC_SCORE));
  const CONFIDENCE_VALUES = new Set(['observed', 'estimated', 'unknown']);
  const CUSTOM_FDM_VALUES = new Set(['target_confirmed', 'target_likely', 'review_needed', 'not_target']);
  const SERVICE_MODEL_VALUES = new Set(['custom_fdm_service', 'miniatures_custom_service', 'fdm_likely_service', 'supplier_store', 'premade_products_only', 'resin_only', 'marketplace_or_directory', 'generic_3d_printing', 'unknown']);
  const SERVICE_PRESENCE_VALUES = new Set(['service_confirmed', 'service_likely', 'supplier_only', 'premade_only', 'resin_only', 'directory', 'unknown']);
  const PRICING_MATURITY_VALUES = new Set(['manual_quote', 'upload_no_instant_price', 'bad_calculator', 'automated_basic', 'automated_strong', 'unknown']);
  const OPPORTUNITY_TYPE_VALUES = new Set(['replace_manual_quoting', 'improve_upload_flow', 'fix_bad_calculator', 'improve_auto_pricing', 'benchmark_auto_pricing', 'verify_service', 'verify_pricing', 'exclude_supplier', 'exclude_non_service']);
  const DECK_STATUS_VALUES = new Set(['ready', 'needs_evidence', 'needs_refresh', 'not_suitable']);
  const DECK_REFRESH_DAYS = 30;

  function cleanText(value, max = 1200) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function clampScore(value, fallback = 50) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function cleanEnum(value, allowed, fallback) {
    const next = cleanText(value, 80).toLowerCase();
    return allowed.has(next) ? next : fallback;
  }

  function legacyPipelineStatus(source = {}) {
    const explicit = cleanEnum(firstValue(source, ['pipeline_status', 'pipeline']), PIPELINE_STATUS_VALUES, '');
    if (explicit) return explicit;
    const legacyStatus = cleanEnum(source.status, STATUS_VALUES, 'research');
    if (source.do_not_contact || source.unsubscribed || source.suppressed || legacyStatus === 'not_fit') return 'do_not_contact';
    if (source.outreach_last_sent_at || legacyStatus === 'exported') return 'emailed';
    if (legacyStatus === 'ready') return 'researched';
    return 'new_lead';
  }

  function compatibilityStatusForPipeline(pipelineStatus) {
    if (pipelineStatus === 'new_lead') return 'research';
    if (pipelineStatus === 'do_not_contact' || pipelineStatus === 'not_interested') return 'not_fit';
    if (pipelineStatus === 'emailed' || pipelineStatus === 'won') return 'exported';
    return 'ready';
  }

  function firstValue(input, keys) {
    for (const key of keys) {
      if (input[key] != null && cleanText(input[key])) return input[key];
    }
    return '';
  }

  function splitEvidence(value) {
    if (Array.isArray(value)) return value.map(v => cleanText(v, 240)).filter(Boolean);
    return cleanText(value, 2000).split(/\r?\n|;/).map(v => cleanText(v, 240)).filter(Boolean);
  }

  function calculateLeadScores(lead) {
    const pricingSignal = cleanEnum(lead.pricing_signal || lead.pricing, PRICING_VALUES, 'unknown');
    const trafficBand = cleanEnum(lead.traffic_band || lead.traffic, TRAFFIC_VALUES, 'unknown');
    const pricingFrictionScore = Number.isFinite(Number(lead.pricing_friction_score))
      ? clampScore(lead.pricing_friction_score, PRICING_FRICTION[pricingSignal])
      : PRICING_FRICTION[pricingSignal];
    const trafficScore = Number.isFinite(Number(lead.traffic_score))
      ? clampScore(lead.traffic_score, TRAFFIC_SCORE[trafficBand])
      : TRAFFIC_SCORE[trafficBand];
    const conversionLeakScore = clampScore(lead.conversion_leak_score, 50);
    const businessFitScore = clampScore(lead.business_fit_score, 50);
    const contactabilityScore = clampScore(lead.contactability_score, 50);

    return {
      pricing_friction_score: pricingFrictionScore,
      traffic_score: trafficScore,
      conversion_leak_score: conversionLeakScore,
      business_fit_score: businessFitScore,
      contactability_score: contactabilityScore,
      opportunity_score: Math.floor(
        pricingFrictionScore * 0.30 +
        trafficScore * 0.20 +
        conversionLeakScore * 0.25 +
        businessFitScore * 0.15 +
        contactabilityScore * 0.10
      ),
    };
  }

  function scoreTier(score) {
    const value = clampScore(score, 0);
    if (value >= 75) {
      return {
        key: 'strong',
        label: 'Strong outreach opportunity',
        short_label: 'Strong',
        class_name: 'high',
        description: 'Prioritise for outreach because fit, quote friction, and reachable demand look strong.',
      };
    }
    if (value >= 50) {
      return {
        key: 'review',
        label: 'Worth reviewing',
        short_label: 'Review',
        class_name: 'mid',
        description: 'Worth a closer look, especially if evidence can confirm custom FDM fit or contactability.',
      };
    }
    return {
      key: 'lower',
      label: 'Lower priority or incomplete evidence',
      short_label: 'Low',
      class_name: 'low',
      description: 'Lower priority until more evidence shows a clear custom FDM quoting opportunity.',
    };
  }

  function generateScoreExplanation(input) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const score = clampScore(lead.opportunity_score, 0);
    const components = SCORE_COMPONENTS.map(component => {
      const componentScore = clampScore(lead[component.scoreField], 0);
      return {
        key: component.key,
        label: component.label,
        score: componentScore,
        weight: component.weight,
        contribution: Math.round(componentScore * component.weight) / 100,
        description: component.description,
      };
    });
    const tier = scoreTier(score);

    return {
      score,
      tier,
      components,
      meaning: 'This is an opportunity score for how useful a Trennen quote-flow pitch may be. It is not a claim about the company’s actual traffic, revenue, conversion rate, or business quality.',
      summary: `${score} out of 100: ${tier.label}.`,
    };
  }

  function defaultSalesBoostSummary(lead) {
    const pricing = {
      no_instant_quote: 'add instant quoting so more visitors can price a job while they are motivated',
      manual_form: 'replace manual quote back-and-forth with a faster guided quote flow',
      bad_calculator: 'make the existing calculator clearer, more trustworthy, and easier to complete',
      unclear_pricing: 'make pricing easier to understand before a customer gives up or emails competitors',
      good_calculator: 'benchmark the current quote flow and look for smaller checkout or follow-up gains',
      unknown: 'audit the quote journey and identify where potential buyers lose momentum',
    }[lead.pricing_signal] || 'audit the quote journey';

    const traffic = lead.traffic_band === 'unknown'
      ? 'available demand'
      : `${lead.traffic_band} estimated demand`;

    return `Trennen can help ${lead.company_name || 'this business'} turn ${traffic} into more quote requests by helping them ${pricing}.`;
  }

  function bucketCount(rows, buckets, resolver) {
    return buckets.map(bucket => ({
      ...bucket,
      count: rows.filter(row => resolver(row) === bucket.key).length,
    }));
  }

  function quoteSystemBucket(lead) {
    const quote = lead.quote_system || 'unknown';
    if (['no_quote_system', 'manual_email_quote', 'manual_form', 'bad_calculator'].includes(quote)) return 'manual';
    if (quote === 'upload_no_instant_price') return 'upload';
    if (quote === 'automated_quote') return 'automated';
    return 'unknown';
  }

  function servicePresenceBucket(lead) {
    const value = lead.service_presence_status || 'unknown';
    if (value === 'service_confirmed' || value === 'service_likely') return 'service';
    if (value === 'supplier_only') return 'supplier';
    if (value === 'premade_only') return 'premade';
    if (value === 'resin_only') return 'resin';
    if (value === 'directory') return 'directory';
    return 'unknown';
  }

  function pricingMaturityBucket(lead) {
    const value = lead.pricing_maturity || 'unknown';
    if (value === 'manual_quote') return 'manual';
    if (value === 'upload_no_instant_price') return 'upload';
    if (value === 'bad_calculator') return 'bad';
    if (value === 'automated_basic' || value === 'automated_strong') return 'automated';
    return 'unknown';
  }

  function customFdmFitBucket(lead) {
    const value = lead.custom_fdm_status || 'review_needed';
    if (value === 'target_confirmed' || value === 'target_likely') return 'target';
    if (value === 'not_target') return 'not_target';
    return 'review';
  }

  function average(rows, field) {
    if (!rows.length) return 0;
    return Math.round(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0) / rows.length);
  }

  function topOpportunityLever(lead) {
    const explanation = generateScoreExplanation(lead);
    const component = [...explanation.components].sort((a, b) => b.contribution - a.contribution)[0];
    return component ? component.label : 'Opportunity needs review';
  }

  function recommendedActionLabel(lead) {
    if (lead.custom_fdm_status === 'review_needed') return 'Verify custom FDM fit';
    if (lead.quote_system === 'automated_quote') return 'Offer quote-flow benchmark';
    if (lead.status === 'ready' && lead.contact_email) return 'Send outreach';
    if (!lead.contact_email && !lead.contact_phone) return 'Find contact';
    return 'Open pitch deck';
  }

  function generateDashboardInsights(inputs = []) {
    const rows = (inputs || []).map(input => normaliseLead(input, { skipDeck: true }));
    const targetRows = rows.filter(row => ['target_confirmed', 'target_likely'].includes(row.custom_fdm_status));
    const targetOrReviewRows = rows.filter(row => row.custom_fdm_status !== 'not_target');
    const stats = {
      totalLeads: rows.length,
      targetLeads: targetRows.length,
      needsReview: rows.filter(row => row.custom_fdm_status === 'review_needed').length,
      serviceConfirmed: rows.filter(row => row.service_presence_status === 'service_confirmed').length,
      automatedBenchmarks: rows.filter(row => row.opportunity_type === 'benchmark_auto_pricing').length,
      excludedNonServices: rows.filter(row => row.custom_fdm_status === 'not_target').length,
      emailReady: rows.filter(row => row.status === 'ready' && row.contact_email && ['target_confirmed', 'target_likely'].includes(row.custom_fdm_status)).length,
      highOpportunity: rows.filter(row => Number(row.opportunity_score) >= 75).length,
      averageScore: rows.length ? average(rows, 'opportunity_score') : 0,
    };

    const topProspects = [...targetRows]
      .sort((a, b) => Number(b.opportunity_score) - Number(a.opportunity_score))
      .slice(0, 5)
      .map(row => ({
        id: row.id,
        company_name: row.company_name,
        score: row.opportunity_score,
        tier: scoreTier(row.opportunity_score),
        quote_system: row.quote_system,
        custom_fdm_status: row.custom_fdm_status,
        pain_point: row.pain_point || salesLeakHypothesis(row),
        opportunity_lever: topOpportunityLever(row),
        recommended_action: recommendedActionLabel(row),
      }));

    return {
      stats,
      topProspects,
      scoreTiers: bucketCount(rows, [
        { key: 'strong', label: 'Strong', description: '75 to 100' },
        { key: 'review', label: 'Worth review', description: '50 to 74' },
        { key: 'lower', label: 'Lower priority', description: 'Below 50' },
      ], row => scoreTier(row.opportunity_score).key),
      quoteSystem: bucketCount(targetOrReviewRows, [
        { key: 'manual', label: 'Manual/no instant quote' },
        { key: 'upload', label: 'Upload workflow' },
        { key: 'automated', label: 'Automated quote' },
        { key: 'unknown', label: 'Unknown' },
      ], quoteSystemBucket),
      customFdmFit: bucketCount(rows, [
        { key: 'target', label: 'Target prospects' },
        { key: 'review', label: 'Needs review' },
        { key: 'not_target', label: 'Not target' },
      ], customFdmFitBucket),
      servicePresence: bucketCount(rows, [
        { key: 'service', label: 'Confirmed/likely service' },
        { key: 'supplier', label: 'Supplier only' },
        { key: 'premade', label: 'Premade only' },
        { key: 'resin', label: 'Resin only' },
        { key: 'directory', label: 'Directory' },
        { key: 'unknown', label: 'Unknown' },
      ], servicePresenceBucket),
      pricingMaturity: bucketCount(targetOrReviewRows, [
        { key: 'manual', label: 'Manual quote' },
        { key: 'upload', label: 'Upload/no instant price' },
        { key: 'bad', label: 'Bad/basic calculator' },
        { key: 'automated', label: 'Auto pricing' },
        { key: 'unknown', label: 'Unknown' },
      ], pricingMaturityBucket),
      demandContactability: {
        averageDemandScore: average(targetOrReviewRows, 'traffic_score'),
        averageContactabilityScore: average(targetOrReviewRows, 'contactability_score'),
        rows: targetOrReviewRows.map(row => ({
          id: row.id,
          company_name: row.company_name,
          demand_score: row.traffic_score,
          contactability_score: row.contactability_score,
        })),
      },
      frictionLeak: {
        averagePricingFriction: average(targetOrReviewRows, 'pricing_friction_score'),
        averageConversionLeak: average(targetOrReviewRows, 'conversion_leak_score'),
        rows: targetOrReviewRows.map(row => ({
          id: row.id,
          company_name: row.company_name,
          pricing_friction_score: row.pricing_friction_score,
          conversion_leak_score: row.conversion_leak_score,
        })),
      },
    };
  }

  function normaliseLead(input, options = {}) {
    const source = input || {};
    const now = cleanText(options.now || source.deck_last_checked_at || source.deck_generated_at) || new Date().toISOString();
    const explicitPipeline = cleanEnum(firstValue(source, ['pipeline_status', 'pipeline']), PIPELINE_STATUS_VALUES, '');
    const pipelineStatus = explicitPipeline || legacyPipelineStatus(source);
    const compatibilityStatus = compatibilityStatusForPipeline(pipelineStatus);
    const base = {
      id: cleanText(source.id) || String(Date.now() + Math.random()).replace('.', ''),
      company_name: cleanText(firstValue(source, ['company_name', 'company', 'business', 'name']), 180),
      website: cleanText(firstValue(source, ['website', 'url', 'domain']), 240),
      city: cleanText(firstValue(source, ['city', 'town']), 100),
      region: cleanText(firstValue(source, ['region', 'area']) || 'New Zealand', 120),
      services: cleanText(firstValue(source, ['services', 'service', 'category']), 500),
      contact_name: cleanText(firstValue(source, ['contact_name', 'contact', 'owner']), 160),
      contact_email: cleanText(firstValue(source, ['contact_email', 'email']), 240).toLowerCase(),
      contact_phone: cleanText(firstValue(source, ['contact_phone', 'phone', 'telephone']), 80),
      source: cleanText(source.source || 'manual', 160),
      status: explicitPipeline ? compatibilityStatus : cleanEnum(source.status, STATUS_VALUES, compatibilityStatus),
      pipeline_status: pipelineStatus,
      pricing_signal: cleanEnum(source.pricing_signal || source.pricing, PRICING_VALUES, 'unknown'),
      traffic_band: cleanEnum(source.traffic_band || source.traffic, TRAFFIC_VALUES, 'unknown'),
      traffic_notes: cleanText(source.traffic_notes, 1000),
      conversion_notes: cleanText(source.conversion_notes, 1000),
      pain_point: cleanText(firstValue(source, ['pain_point', 'pain', 'conversion_leak', 'notes']), 1000),
      confidence: cleanEnum(source.confidence, CONFIDENCE_VALUES, 'unknown'),
      discovery_confidence: cleanEnum(source.discovery_confidence || source.confidence, CONFIDENCE_VALUES, 'unknown'),
      fdm_status: cleanText(source.fdm_status || 'unknown', 80),
      custom_fdm_status: cleanEnum(firstValue(source, ['custom_fdm_status', 'custom_fdm_fit', 'target_status']), CUSTOM_FDM_VALUES, 'review_needed'),
      service_model: cleanEnum(firstValue(source, ['service_model', 'business_model']), SERVICE_MODEL_VALUES, 'unknown'),
      service_presence_status: cleanEnum(firstValue(source, ['service_presence_status', 'service_status']), SERVICE_PRESENCE_VALUES, 'unknown'),
      target_reason: cleanText(firstValue(source, ['target_reason', 'targeting_reason', 'fit_reason']), 1000),
      quote_system: cleanText(source.quote_system || 'unknown', 80),
      pricing_maturity: cleanEnum(firstValue(source, ['pricing_maturity', 'pricing_workflow']), PRICING_MATURITY_VALUES, 'unknown'),
      opportunity_type: cleanEnum(firstValue(source, ['opportunity_type', 'opportunity']), OPPORTUNITY_TYPE_VALUES, 'verify_service'),
      google_place_id: cleanText(source.google_place_id, 160),
      google_rating: Number(source.google_rating) || 0,
      google_review_count: Number(source.google_review_count) || 0,
      evidence: splitEvidence(source.evidence),
      pitch_angle: cleanText(source.pitch_angle, 1000),
      notes: cleanText(source.notes, 2000),
      contact_notes: cleanText(source.contact_notes, 2000),
      last_contacted_at: cleanText(source.last_contacted_at),
      next_follow_up_at: cleanText(source.next_follow_up_at, 80),
      deck_status: cleanEnum(source.deck_status, DECK_STATUS_VALUES, ''),
      deck_generated_at: cleanText(source.deck_generated_at) || now,
      deck_last_checked_at: cleanText(source.deck_last_checked_at) || now,
      deck_evidence: Array.isArray(source.deck_evidence) ? source.deck_evidence : [],
      deck_warnings: Array.isArray(source.deck_warnings) ? source.deck_warnings.map(item => cleanText(item, 500)).filter(Boolean) : [],
      pitch_deck: source.pitch_deck && typeof source.pitch_deck === 'object' ? source.pitch_deck : null,
      do_not_contact: Boolean(source.do_not_contact || source.unsubscribed || source.suppressed || pipelineStatus === 'do_not_contact'),
      outreach_last_sent_at: cleanText(source.outreach_last_sent_at),
      outreach_last_result: cleanText(source.outreach_last_result, 500),
      newly_added_at: cleanText(source.newly_added_at),
      newly_added_source: cleanText(source.newly_added_source, 160),
      newly_added_batch: cleanText(source.newly_added_batch, 160),
      created_at: cleanText(source.created_at) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const scores = calculateLeadScores({ ...base, ...source });
    const lead = { ...base, ...scores };
    lead.sales_boost_summary = cleanText(source.sales_boost_summary, 1200) || defaultSalesBoostSummary(lead);
    if (!options.skipDeck) {
      const deck = generatePitchDeck(lead, { now: lead.deck_last_checked_at });
      lead.pitch_deck = deck;
      lead.deck_status = cleanEnum(source.deck_status, DECK_STATUS_VALUES, deck.status) || deck.status;
      if (lead.deck_status !== deck.status) lead.pitch_deck = { ...deck, status: lead.deck_status };
      lead.deck_generated_at = deck.generated_at;
      lead.deck_last_checked_at = deck.last_checked_at;
      lead.deck_evidence = deck.evidence;
      lead.deck_warnings = deck.warnings;
    }
    return lead;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    const input = String(text || '');

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      const next = input[i + 1];
      if (ch === '"' && quoted && next === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        row.push(value);
        value = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(value);
        if (row.some(cell => cleanText(cell))) rows.push(row);
        row = [];
        value = '';
      } else {
        value += ch;
      }
    }

    row.push(value);
    if (row.some(cell => cleanText(cell))) rows.push(row);
    return rows;
  }

  function csvToLeads(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows.shift().map(header => cleanText(header).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    return rows
      .map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] || ''])))
      .filter(item => cleanText(firstValue(item, ['company_name', 'company', 'business', 'name'])))
      .map(item => normaliseLead({ ...item, source: item.source || 'CSV import' }));
  }

  function discoveryJsonToLeads(text) {
    const parsed = typeof text === 'string' ? JSON.parse(text || '{}') : text;
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.leads)
        ? parsed.leads
        : Array.isArray(parsed?.records)
          ? parsed.records.map(record => ({
            ...record,
            ...(record.classifications || {}),
            contact_email: record.email,
            contact_phone: record.phone,
          }))
          : [];
    return rows.map(row => normaliseLead({ ...row, source: row.source || 'Discovery import' }));
  }

  function csvEscape(value) {
    const text = String(value == null ? '' : value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function normaliseMergeUrl(url) {
    return String(url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  }

  function normaliseMergePhone(phone) {
    return String(phone || '').replace(/[^\d+]/g, '');
  }

  function normaliseMergeName(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function leadMergeKey(lead = {}) {
    return leadIdentityKeys(lead)[0] || '';
  }

  function leadIdentityKeys(lead = {}) {
    const keys = [
      lead.google_place_id && `place:${cleanText(lead.google_place_id, 180)}`,
      lead.website && `web:${normaliseMergeUrl(lead.website)}`,
      lead.contact_email && `email:${String(lead.contact_email).trim().toLowerCase()}`,
      lead.email && `email:${String(lead.email).trim().toLowerCase()}`,
      lead.contact_phone && `phone:${normaliseMergePhone(lead.contact_phone)}`,
      lead.phone && `phone:${normaliseMergePhone(lead.phone)}`,
      lead.company_name && `name:${normaliseMergeName(lead.company_name)}`,
      lead.name && `name:${normaliseMergeName(lead.name)}`,
    ].filter(key => key && !key.endsWith(':'));
    return [...new Set(keys)];
  }

  function candidateIdentityKeys(candidate = {}) {
    return leadIdentityKeys({
      google_place_id: candidate.google_place_id || candidate.place_id || candidate.id,
      website: candidate.website || candidate.websiteUri || candidate.url,
      contact_email: candidate.contact_email || candidate.email,
      contact_phone: candidate.contact_phone || candidate.phone || candidate.nationalPhoneNumber || candidate.internationalPhoneNumber,
      company_name: candidate.company_name || candidate.name || candidate.displayName?.text,
    });
  }

  function sanitizeIdentityKeys(keys = [], limit = 1000) {
    if (!Array.isArray(keys)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of keys) {
      const key = cleanText(raw, 180);
      if (!/^(place|web|email|phone|name):[^\s]{2,}$/.test(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= limit) break;
    }
    return out;
  }

  function knownLeadKeys(leads = []) {
    const keys = new Set();
    (leads || []).forEach(lead => leadIdentityKeys(lead).forEach(key => keys.add(key)));
    return [...keys];
  }

  function hasKnownIdentity(candidate, knownKeys = []) {
    const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys || []);
    return candidateIdentityKeys(candidate).some(key => known.has(key));
  }

  function findExistingMergeKey(byKey, lead, fallback) {
    for (const key of leadIdentityKeys(lead)) {
      if (byKey.has(key)) return key;
    }
    return fallback;
  }

  function setLeadForKeys(byKey, lead, fallbackKey) {
    const keys = leadIdentityKeys(lead);
    if (!keys.length && fallbackKey) {
      byKey.set(fallbackKey, lead);
      return [fallbackKey];
    }
    keys.forEach(key => byKey.set(key, lead));
    return keys;
  }

  function setMergedLeadForKeys(byKey, previous, incoming, merged, fallbackKey) {
    const keys = [...new Set([
      ...leadIdentityKeys(previous),
      ...leadIdentityKeys(incoming),
      fallbackKey,
    ].filter(Boolean))];
    keys.forEach(nextKey => byKey.set(nextKey, merged));
    return keys;
  }

  function orderedUniqueLeads(order, byKey) {
    const seen = new Set();
    const out = [];
    for (const key of order) {
      const lead = byKey.get(key);
      if (!lead || seen.has(lead)) continue;
      seen.add(lead);
      out.push(lead);
    }
    return out;
  }

  function mergeLeadLists(existing = [], incoming = []) {
    const byKey = new Map();
    const order = [];
    existing.forEach((lead, index) => {
      const fallback = `existing:${index}`;
      const keys = setLeadForKeys(byKey, lead, fallback);
      order.push(keys[0] || fallback);
    });
    incoming.forEach((lead, index) => {
      const fallback = `incoming:${index}`;
      const key = findExistingMergeKey(byKey, lead, fallback);
      const previous = byKey.get(key);
      if (previous) {
        const merged = {
          ...previous,
          ...lead,
          status: previous.status && previous.status !== 'research' ? previous.status : lead.status,
          pipeline_status: previous.pipeline_status && previous.pipeline_status !== 'new_lead' ? previous.pipeline_status : lead.pipeline_status,
          last_contacted_at: previous.last_contacted_at || lead.last_contacted_at,
          next_follow_up_at: previous.next_follow_up_at || lead.next_follow_up_at,
          contact_notes: previous.contact_notes || lead.contact_notes,
          notes: previous.notes || lead.notes,
          pitch_angle: previous.pitch_angle || lead.pitch_angle,
          sales_boost_summary: previous.sales_boost_summary || lead.sales_boost_summary,
          target_reason: previous.target_reason || lead.target_reason,
          traffic_notes: previous.traffic_notes || lead.traffic_notes,
          newly_added_at: previous.newly_added_at || lead.newly_added_at,
          newly_added_source: previous.newly_added_source || lead.newly_added_source,
          newly_added_batch: previous.newly_added_batch || lead.newly_added_batch,
        };
        setMergedLeadForKeys(byKey, previous, lead, merged, key);
      } else {
        const keys = setLeadForKeys(byKey, lead, fallback);
        order.push(keys[0] || fallback);
      }
    });
    return orderedUniqueLeads(order, byKey);
  }

  function markNewLeads(existing = [], incoming = [], options = {}) {
    const existingKeys = new Set();
    (existing || []).forEach(lead => leadIdentityKeys(lead).forEach(key => existingKeys.add(key)));
    const seenIncoming = new Set();
    const now = cleanText(options.now) || new Date().toISOString();
    const source = cleanText(options.source, 160) || 'Added';
    const batch = cleanText(options.batch, 160);

    return (incoming || []).map(input => {
      const lead = normaliseLead(input || {}, { skipDeck: true });
      const keys = leadIdentityKeys(lead);
      const alreadyKnown = keys.some(key => existingKeys.has(key) || seenIncoming.has(key));
      keys.forEach(key => seenIncoming.add(key));
      if (alreadyKnown) {
        return {
          ...lead,
          newly_added_at: '',
          newly_added_source: '',
          newly_added_batch: '',
        };
      }
      return {
        ...lead,
        newly_added_at: lead.newly_added_at || now,
        newly_added_source: lead.newly_added_source || source,
        newly_added_batch: lead.newly_added_batch || batch,
      };
    });
  }

  function isPresentationTarget(lead, includeReview) {
    if (lead.custom_fdm_status === 'target_confirmed' || lead.custom_fdm_status === 'target_likely') return true;
    return Boolean(includeReview && lead.custom_fdm_status === 'review_needed');
  }

  function presentationConfidence(lead) {
    if (lead.custom_fdm_status === 'review_needed' || lead.custom_fdm_status === 'not_target') return 'needs_review';
    if (lead.confidence === 'observed' || lead.discovery_confidence === 'observed') return 'observed';
    if (lead.custom_fdm_status === 'target_confirmed' && (lead.target_reason || (lead.evidence || []).length)) return 'observed';
    return 'estimated';
  }

  function quoteWorkflowPhrase(quoteSystem) {
    return {
      manual_email_quote: 'manual email quote',
      manual_form: 'manual quote form',
      upload_no_instant_price: 'upload workflow without visible instant pricing',
      bad_calculator: 'unclear calculator',
      automated_quote: 'existing automated quote workflow',
      no_quote_system: 'no obvious quote system',
      unknown: 'unverified quote workflow',
    }[quoteSystem] || 'unverified quote workflow';
  }

  function quoteSystemPositioning(input) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const quote = lead.quote_system || 'unknown';
    if (quote === 'automated_quote' || lead.pricing_signal === 'good_calculator') {
      return {
        current_system: 'Automated quote workflow observed',
        current_read: 'They appear to already have some form of automated pricing or quoting, so the pitch should not claim they are missing a quote system.',
        pitch_focus: 'Benchmark their existing quote flow against Trennen for speed, clarity, material guidance, follow-up capture, and how confidently customers can finish a quote.',
        why_trennen_better: 'Trennen is better when it makes the guided FDM path clearer, easier to complete, better at explaining price drivers, and stronger at follow-up than their current automated workflow.',
        caution: 'Only pitch this as a benchmark unless the audit proves their current calculator is confusing, incomplete, or hard to finish.',
      };
    }
    if (quote === 'upload_no_instant_price') {
      return {
        current_system: 'Upload workflow without clear instant price',
        current_read: 'They appear to collect files or orders, but public evidence does not clearly show instant price certainty before submission.',
        pitch_focus: 'Turn upload interest into a guided quote path where customers understand material, quantity, quality, turnaround, and price drivers earlier.',
        why_trennen_better: 'Trennen is better because upload, material choices, and pricing logic sit in one guided flow instead of leaving the customer unsure what happens after file submission.',
        caution: 'Verify whether their upload flow already prices instantly before claiming a gap.',
      };
    }
    if (quote === 'bad_calculator') {
      return {
        current_system: 'Calculator exists but appears unclear',
        current_read: 'They may already have a calculator, but the audit suggests the calculator or pricing path may be hard to trust or complete.',
        pitch_focus: 'Position Trennen as a clearer, more guided calculator with better material explanations, quote confidence, and completion follow-up.',
        why_trennen_better: 'Trennen is better if it reduces calculator confusion and turns pricing into a guided buying path instead of a bare estimate box.',
        caution: 'Use this only when the confusing-calculator evidence is visible or manually verified.',
      };
    }
    if (quote === 'manual_email_quote' || quote === 'manual_form' || quote === 'no_quote_system') {
      return {
        current_system: quote === 'manual_email_quote' ? 'Manual quote workflow' : quote === 'manual_form' ? 'Manual form workflow' : 'No clear quote system observed',
        current_read: quote === 'manual_email_quote'
          ? 'Customers appear to email CAD/STL files before seeing price, material options, or turnaround.'
          : quote === 'manual_form'
            ? 'Customers appear to submit a form and wait for a manual reply before they have price certainty.'
            : 'No obvious public quote path was found, so a motivated buyer may need to contact the business before understanding price or next steps.',
        pitch_focus: 'Lead with replacing manual back-and-forth with an instant guided quote path for common FDM jobs.',
        why_trennen_better: 'Trennen is better because it gives customers a guided instant quote path, captures print-ready job details upfront, and reduces manual back-and-forth for the business.',
        caution: 'Phrase this as public workflow evidence, not a claim about their internal process.',
      };
    }
    return {
      current_system: 'Quote workflow needs verification',
      current_read: 'The audit does not have enough evidence to know whether pricing is manual, automated, or hidden behind another workflow.',
      pitch_focus: 'Verify their pricing flow first, then decide whether to pitch instant quoting, calculator improvement, or workflow benchmarking.',
      why_trennen_better: 'Trennen should only be positioned as better after the current pricing system is verified.',
      caution: 'Do not send a confident pitch until the quote system is checked.',
    };
  }

  function leadHeadline(lead) {
    const name = lead.company_name || 'This prospect';
    if (lead.custom_fdm_status === 'review_needed') return `${name}: verify custom FDM fit before outreach`;
    if (lead.quote_system === 'manual_email_quote') return `${name}: manual quote by file email is a clear sales friction point`;
    if (lead.quote_system === 'manual_form') return `${name}: manual quote form creates response-time friction`;
    if (lead.quote_system === 'upload_no_instant_price') return `${name}: upload workflow can be turned into clearer instant pricing`;
    if (lead.quote_system === 'automated_quote') return `${name}: benchmark and improve an existing quote workflow`;
    return `${name}: custom FDM quote journey has a likely improvement opportunity`;
  }

  function salesLeakHypothesis(lead) {
    if (lead.custom_fdm_status === 'review_needed') {
      return 'Custom FDM fit needs manual verification before making a sales claim.';
    }
    if (lead.quote_system === 'manual_email_quote') {
      return 'Customers appear to need to email CAD or STL files before seeing price, material options, or turnaround, which creates quote-flow friction.';
    }
    if (lead.quote_system === 'manual_form') {
      return 'Customers appear to submit a quote form and wait for a reply, which can slow motivated buyers during the pricing step.';
    }
    if (lead.quote_system === 'upload_no_instant_price') {
      return 'Customers can upload or order, but visible instant pricing is not clear, so the drop-off risk is around price certainty.';
    }
    if (lead.quote_system === 'automated_quote') {
      return 'They appear to have a quote workflow already, so the opportunity is a benchmark: speed, clarity, follow-up, and material guidance.';
    }
    if (lead.quote_system === 'no_quote_system') {
      return 'No obvious quote path was found, so visitors may need to contact the business before understanding price or next steps.';
    }
    return 'The quote path needs manual review, but the current evidence suggests a possible quote-flow clarity gap.';
  }

  function demandProxy(lead) {
    const parts = [];
    if (lead.google_review_count) {
      parts.push(`${lead.google_review_count} Google review(s)`);
      if (lead.google_rating) parts.push(`${lead.google_rating}/5 rating`);
    }
    if (lead.source && /google places/i.test(lead.source)) parts.push('found through Google Places discovery');
    if (lead.contact_email || lead.contact_phone) parts.push('direct contact path available');
    if (!parts.length) return 'Demand proxy is estimated from discovery fit and website evidence; no Google review count is available yet.';
    return `Demand proxy: ${parts.join(', ')}.`;
  }

  function contactSnapshot(lead) {
    return [
      lead.website ? `Website: ${lead.website}` : '',
      [lead.city, lead.region].filter(Boolean).join(', '),
      lead.contact_email ? `Email: ${lead.contact_email}` : '',
      lead.contact_phone ? `Phone: ${lead.contact_phone}` : '',
    ].filter(Boolean).join(' | ');
  }

  function evidenceList(lead) {
    return [
      lead.target_reason,
      lead.google_review_count ? `Observed Google profile: ${lead.google_review_count} review(s)${lead.google_rating ? `, ${lead.google_rating}/5 rating` : ''}.` : '',
      `Quote workflow classification: ${quoteWorkflowPhrase(lead.quote_system)}.`,
      ...(lead.evidence || []).slice(0, 4),
    ].filter(Boolean).map(item => presentationSafeText(item));
  }

  function helpBullets(lead) {
    if (lead.custom_fdm_status === 'review_needed') {
      return [
        'Verify that custom FDM printing is a real service before outreach.',
        'If confirmed, map their quote path and show where instant guided pricing can reduce back-and-forth.',
        'Prepare a short demo using the materials and file-upload steps visible on their site.',
      ];
    }
    if (lead.quote_system === 'automated_quote') {
      return [
        'Benchmark their existing quote flow against a faster guided FDM pricing experience.',
        'Show clearer material and turnaround choices during quoting.',
        'Improve follow-up capture for customers who start a quote but do not finish.',
      ];
    }
    if (lead.quote_system === 'upload_no_instant_price') {
      return [
        'Turn file upload into a clearer instant-pricing path for common FDM materials.',
        'Show material, quantity, and turnaround choices before the customer waits for review.',
        'Capture quote intent and follow-up details from each uploaded CAD or STL file.',
      ];
    }
    if (lead.quote_system === 'manual_form') {
      return [
        'Replace manual quote-form waiting time with guided FDM pricing for common jobs.',
        'Make material and turnaround choices visible before the customer submits.',
        'Reduce manual back-and-forth by collecting print-ready job details upfront.',
      ];
    }
    return [
      'Give customers a guided FDM quote path before they need to email or wait.',
      'Make material, quantity, and turnaround choices clear at the pricing step.',
      'Capture better job details and follow-up context from each quote request.',
    ];
  }

  function recommendedNextStep(lead) {
    if (lead.custom_fdm_status === 'review_needed') {
      return 'Verify custom FDM service evidence, then decide whether to pitch a quote-flow audit.';
    }
    if (lead.quote_system === 'automated_quote') {
      return 'Offer a quick benchmark of their current quote workflow against a Trennen guided FDM quoting flow.';
    }
    return 'Offer a 10-minute quote-flow audit showing how a Trennen guided FDM quote path could reduce manual back-and-forth.';
  }

  function pitchAngleForLead(lead) {
    if (lead.pitch_angle) return presentationSafeText(lead.pitch_angle);
    if (lead.custom_fdm_status === 'review_needed') return 'Lead by asking whether they currently offer custom FDM printing before pitching.';
    if (lead.quote_system === 'manual_email_quote') return 'Lead with the cost of asking customers to email files before they know price or turnaround.';
    if (lead.quote_system === 'manual_form') return 'Lead with replacing manual quote forms with faster guided FDM pricing.';
    if (lead.quote_system === 'upload_no_instant_price') return 'Lead with turning upload interest into clearer instant price certainty.';
    if (lead.quote_system === 'automated_quote') return 'Lead with a benchmark of quote-flow speed, clarity, and follow-up.';
    return 'Lead with a short quote-flow audit tied to their custom FDM evidence.';
  }

  function presentationSafeText(value) {
    return cleanText(value, 2000)
      .replace(/\bconversion rate\b/gi, 'quote completion')
      .replace(/\bvisitors per month\b/gi, 'visitor demand')
      .replace(/\brevenue\b/gi, 'sales opportunity')
      .replace(/\buplift\b/gi, 'improvement opportunity')
      .replace(/\b(\d+(?:\.\d+)?)%\b/g, '$1 percent');
  }

  function checkedAtForLead(lead, now) {
    return cleanText(now || lead.deck_last_checked_at || lead.updated_at || lead.created_at) || new Date().toISOString();
  }

  function deckEvidenceItem(lead, claim, sourceType, confidence, snippet, now) {
    return {
      claim: presentationSafeText(claim),
      source_type: sourceType,
      confidence: ['observed', 'estimated', 'needs_review'].includes(confidence) ? confidence : 'needs_review',
      snippet: presentationSafeText(snippet || 'Evidence needs manual review.'),
      last_checked_at: checkedAtForLead(lead, now),
    };
  }

  function generateDeckEvidenceLedger(input, options = {}) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const now = checkedAtForLead(lead, options.now);
    const confidence = presentationConfidence(lead);
    const ledger = [];

    if (lead.website || lead.company_name) {
      ledger.push(deckEvidenceItem(
        lead,
        `${lead.company_name || 'This business'} has a public prospect profile to audit.`,
        'website',
        lead.website ? 'observed' : 'needs_review',
        lead.website || 'No website recorded yet.',
        now
      ));
    }

    if (lead.target_reason) {
      ledger.push(deckEvidenceItem(
        lead,
        `Custom FDM fit: ${labelValue(lead.custom_fdm_status)}.`,
        'classifier',
        lead.custom_fdm_status === 'review_needed' || lead.custom_fdm_status === 'not_target' ? 'needs_review' : confidence,
        lead.target_reason,
        now
      ));
    }

    ledger.push(deckEvidenceItem(
      lead,
      `Current quote workflow is classified as ${quoteWorkflowPhrase(lead.quote_system)}.`,
      'classifier',
      lead.quote_system === 'unknown' ? 'needs_review' : confidence,
      `Quote workflow classification: ${quoteWorkflowPhrase(lead.quote_system)}.`,
      now
    ));

    if (lead.google_review_count || lead.google_rating) {
      ledger.push(deckEvidenceItem(
        lead,
        'Demand proxy is based on Google profile signals.',
        'google_places',
        'observed',
        `${lead.google_review_count || 0} Google review(s)${lead.google_rating ? `, ${lead.google_rating}/5 rating` : ''}.`,
        now
      ));
    } else {
      ledger.push(deckEvidenceItem(
        lead,
        'Demand proxy is not verified with Google review data yet.',
        'google_places',
        'needs_review',
        'No Google review count or rating is stored for this lead.',
        now
      ));
    }

    (lead.evidence || []).slice(0, 8).forEach(snippet => {
      ledger.push(deckEvidenceItem(
        lead,
        'Website scan found supporting evidence for the pitch.',
        'website',
        confidence === 'needs_review' ? 'needs_review' : 'observed',
        snippet,
        now
      ));
    });

    if (lead.pain_point) {
      ledger.push(deckEvidenceItem(
        lead,
        'Sales-leak hypothesis is based on the recorded pain point.',
        'manual_note',
        lead.confidence === 'observed' ? 'observed' : 'estimated',
        lead.pain_point,
        now
      ));
    }

    if (lead.notes) {
      ledger.push(deckEvidenceItem(
        lead,
        'Internal research note is available for outreach context.',
        'manual_note',
        'estimated',
        lead.notes,
        now
      ));
    }

    return ledger;
  }

  function daysSince(iso, now = new Date()) {
    const date = new Date(iso || 0);
    if (!Number.isFinite(date.getTime())) return Infinity;
    return (now.getTime() - date.getTime()) / 86400000;
  }

  function deckReadiness(input, options = {}) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const warnings = [];
    const checkedAt = cleanText(lead.deck_last_checked_at || lead.deck_generated_at);

    if (lead.custom_fdm_status === 'not_target') {
      return {
        status: 'not_suitable',
        label: 'Not suitable',
        warnings: ['This business is currently classified as not a custom FDM service prospect.'],
      };
    }

    if (checkedAt && daysSince(checkedAt, options.now ? new Date(options.now) : new Date()) > DECK_REFRESH_DAYS) {
      warnings.push(`Evidence was last checked more than ${DECK_REFRESH_DAYS} days ago.`);
      return { status: 'needs_refresh', label: 'Needs refresh', warnings };
    }

    if (!checkedAt) warnings.push('No last-checked timestamp is stored for this deck.');
    if (lead.custom_fdm_status === 'review_needed') warnings.push('Needs review before outreach: custom FDM fit is not confirmed.');
    if (!lead.evidence.length && !lead.target_reason) warnings.push('Missing website evidence snippets for the pitch.');
    if (lead.quote_system === 'unknown') warnings.push('Quote workflow is unknown and should be checked before sending.');

    if (warnings.length) return { status: 'needs_evidence', label: 'Needs evidence', warnings };
    return { status: 'ready', label: 'Ready', warnings };
  }

  function deckMetricCards(lead, score) {
    return [
      {
        label: 'Opportunity score',
        value: `${score.score}/100`,
        detail: score.tier.label,
      },
      {
        label: 'Demand proxy',
        value: lead.google_review_count ? `${lead.google_review_count} reviews` : labelValue(lead.traffic_band),
        detail: lead.google_rating ? `${lead.google_rating}/5 Google rating` : 'Treat as an estimate until verified.',
      },
      {
        label: 'Quote workflow',
        value: quoteWorkflowPhrase(lead.quote_system),
        detail: lead.quote_system === 'unknown' ? 'Needs manual review' : 'Based on website scan/classifier evidence.',
      },
      {
        label: 'Custom FDM fit',
        value: labelValue(lead.custom_fdm_status),
        detail: lead.service_model ? labelValue(lead.service_model) : 'Service model needs review.',
      },
    ];
  }

  function richDeckSlide(layout, title, kicker, claim, bullets, proof = [], footer = '', extra = {}) {
    return {
      layout,
      title: presentationSafeText(title),
      kicker: presentationSafeText(kicker),
      claim: presentationSafeText(claim),
      bullets: (bullets || []).filter(Boolean).map(presentationSafeText),
      proof: (proof || []).filter(Boolean).map(presentationSafeText),
      footer: presentationSafeText(footer),
      ...extra,
    };
  }

  function templateTheme() {
    return {
      background: '#F6F2EB',
      ink: '#171717',
      muted: '#6F6A60',
      green: '#123F33',
      mint: '#BFD9CD',
      gold: '#C8954A',
      card: '#FFFDF8',
      border: '#DED6C8',
    };
  }

  function quotePathSteps() {
    return ['Upload file', 'Pick material', 'Select quality', 'Choose turnaround', 'Approve quote'];
  }

  function adjacentServicesSupportNote() {
    return 'FDM pricing is the first instant-pricing path in Trennen. If they also offer MJF or other services, we should not pretend Trennen can auto-price those today; we can still help map those services into the customer intake workflow, route them as guided enquiries where needed, plan future pricing logic, help integrate the setup, and stay with the team step by step.';
  }

  function scoreFitLabel(score) {
    return Number(score) >= 75 ? 'strong outreach fit' : Number(score) >= 50 ? 'worth review' : 'needs more evidence';
  }

  function editableCalculator(lead) {
    const requests = lead.google_review_count >= 30 ? '[30]' : lead.google_review_count >= 10 ? '[20]' : '[30]';
    return {
      cards: [
        { label: 'Quote requests / mo', value: requests, note: 'replace with client-supplied data' },
        { label: 'Manual quote share', value: '[35 percent]', note: 'editable assumption, not observed analytics' },
        { label: 'Minutes saved / quote', value: '[12 min]', note: 'editable team-time assumption' },
        { label: 'Average order value', value: '[$85]', note: 'optional client-supplied context' },
      ],
      formula: '[quote requests per month] x [manual quote share] x [minutes saved per quote] = estimated quoting-time opportunity',
      impact_line: 'Replace the bracketed values with the client’s own numbers before using this as a business case. Until then, this is a discussion calculator, not a measured result.',
      best_stack: [
        'How data was gathered',
        'Public demand signal',
        'Current workflow classification',
        'Friction hypothesis',
        'Editable impact calculator',
      ],
    };
  }

  function auditMethodology(lead, ledger, now) {
    const googleSignal = lead.google_review_count
      ? `${lead.google_review_count} Google review(s)${lead.google_rating ? ` and ${lead.google_rating}/5 rating` : ''}`
      : 'No Google review/rating signal stored yet';
    const websiteEvidence = (lead.evidence || []).slice(0, 3).join(' | ') || lead.target_reason || 'No website snippets stored yet';
    return {
      summary: 'We ran an external audit using publicly visible website pages, Google business profile signals when available, and stored evidence snippets from discovery. We did not access private analytics, traffic reports, sales figures, conversion data, or backend systems.',
      disclaimer: 'These results are an outside-in audit. They are designed to start a practical conversation and should be updated with the client’s real quote volume, team time, order value, and analytics before making performance claims.',
      last_checked_at: now,
      sources: [
        {
          label: 'Public website scan',
          value: lead.website ? `${lead.website} | ${websiteEvidence}` : websiteEvidence,
          confidence: lead.website && (lead.evidence.length || lead.target_reason) ? 'observed' : 'needs_review',
        },
        {
          label: 'Google business profile signals',
          value: googleSignal,
          confidence: lead.google_review_count ? 'observed proxy' : 'needs_review',
        },
        {
          label: 'Quote-flow classifier',
          value: `Custom FDM fit: ${labelValue(lead.custom_fdm_status)}; quote workflow: ${quoteWorkflowPhrase(lead.quote_system)}.`,
          confidence: lead.quote_system === 'unknown' || lead.custom_fdm_status === 'review_needed' ? 'needs_review' : 'estimated from public evidence',
        },
        {
          label: 'Editable calculator assumptions',
          value: 'Bracketed fields are placeholders for client-supplied values, not claims from the audit.',
          confidence: 'needs client data',
        },
      ],
    };
  }

  function beforeAfter(lead) {
    const beforeTitle = lead.quote_system === 'manual_email_quote'
      ? 'Before: email-based quoting'
      : lead.quote_system === 'upload_no_instant_price'
        ? 'Before: upload without clear pricing'
        : lead.quote_system === 'automated_quote'
          ? 'Before: existing quote workflow'
          : 'Before: manual quote form';
    return {
      before_title: beforeTitle,
      after_title: 'After: guided quote path',
      before: [
        'Customer submits incomplete details',
        'Team checks file and materials manually',
        'Reply needed before price approval',
        'Lead can cool off during back-and-forth',
      ],
      after: [
        'File, material, layer height, and quantity captured upfront',
        'Customer sees clearer price drivers',
        'Staff receive cleaner job info',
        'Better handoff from quote to production',
      ],
    };
  }

  function appendixRows(lead, ledger, now, methodology = auditMethodology(lead, ledger, now)) {
    const rows = [
      {
        field: 'How data was gathered',
        value: methodology.summary,
        confidence: 'External audit',
      },
      {
        field: 'Audit limits',
        value: methodology.disclaimer,
        confidence: 'Disclosure',
      },
      {
        field: 'Website observed',
        value: lead.website || '[website needed]',
        confidence: lead.website ? 'Observed' : 'Needs review',
      },
      {
        field: 'Custom FDM evidence',
        value: (lead.evidence || []).slice(0, 4).join(' + ') || lead.target_reason || '[evidence needed]',
        confidence: lead.custom_fdm_status === 'review_needed' ? 'Needs review' : 'Observed',
      },
      {
        field: 'Quote workflow',
        value: quoteWorkflowPhrase(lead.quote_system),
        confidence: lead.quote_system === 'unknown' ? 'Needs review' : 'Classifier observation',
      },
      {
        field: 'Other services support',
        value: adjacentServicesSupportNote(),
        confidence: 'Product scope disclosure',
      },
      {
        field: 'Public demand proxy',
        value: lead.google_review_count ? `${lead.google_review_count} Google reviews${lead.google_rating ? `, ${lead.google_rating}/5 rating` : ''}` : '[public demand signal needed]',
        confidence: lead.google_review_count ? 'Proxy only' : 'Needs review',
      },
      {
        field: 'Last checked',
        value: now,
        confidence: 'Timestamp',
      },
    ];
    return rows.concat(ledger.slice(0, 4).map(item => ({
      field: labelValue(item.source_type),
      value: item.snippet,
      confidence: labelValue(item.confidence),
    })));
  }

  function generatePitchDeck(input, options = {}) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const now = checkedAtForLead(lead, options.now);
    const brief = generateCompanyBrief(lead);
    const score = generateScoreExplanation(lead);
    const readiness = deckReadiness({ ...lead, deck_last_checked_at: now }, { now });
    const ledger = generateDeckEvidenceLedger({ ...lead, deck_last_checked_at: now }, { now });
    const warnings = [...new Set(readiness.warnings)];
    const name = lead.company_name || 'this business';
    const evidence = brief.evidence.length ? brief.evidence : ['Needs review before outreach: no supporting website snippets are stored yet.'];
    const metricCards = deckMetricCards(lead, score);
    const guidedQuotePath = quotePathSteps();
    const calculator = editableCalculator(lead);
    const beforeAfterModel = beforeAfter(lead);
    const methodology = auditMethodology(lead, ledger, now);
    const quotePositioning = quoteSystemPositioning(lead);
    const adjacentServicesNote = adjacentServicesSupportNote();
    const appendix = appendixRows(lead, ledger, now, methodology);
    const footerNote = 'External audit only: based on public website/profile signals and stored evidence. Editable client metric fields are marked with [brackets] and need client-supplied data before making performance claims.';
    const sourceProof = ledger.slice(0, 5).map(item => `${item.confidence}: ${item.snippet}`);

    const slides = [
      richDeckSlide(
        'cover',
        'A clearer path from file upload to quote approval',
        'Client-specific quote-flow pitch',
        readiness.status === 'ready'
          ? `${name} looks like a fit for a guided custom FDM quoting conversation.`
          : `${name} needs more evidence before this pitch should be sent confidently.`,
        [
          name,
          labelValue(lead.custom_fdm_status),
          brief.quote_workflow,
          'External public audit',
        ],
        [
          methodology.summary,
          ...metricCards.map(card => `${card.label}: ${card.value} - ${card.detail}`),
        ],
        footerNote,
        { metric_cards: metricCards, guided_quote_path: guidedQuotePath, readiness: readiness.label }
      ),
      richDeckSlide(
        'observed_situation',
        'Current quote-flow audit',
        'Observed situation',
        brief.sales_leak,
        [
          `How we gathered this: ${methodology.summary}`,
          `Current pricing system: ${quotePositioning.current_system}.`,
          `Quote workflow: ${brief.quote_workflow}.`,
          `Primary friction lever: ${topOpportunityLever(lead)}.`,
          `Evidence: ${evidence.slice(0, 4).join(', ')}.`,
          `Confidence level: ${brief.confidence}.`,
          lead.pain_point || 'Pain point needs manual confirmation before outreach.',
        ],
        sourceProof,
        'Use this slide to make the problem feel specific without claiming access to private analytics.'
      ),
      richDeckSlide(
        'changeable_metrics',
        'A simple business case calculator the prospect can recognise',
        'Changeable metrics',
        'These fields are intentionally editable and should be replaced with public observations, discovery-call answers, or customer-supplied data.',
        calculator.cards.map(card => `${card.label}: ${card.value} (${card.note})`),
        [
          `Formula: ${calculator.formula}`,
          calculator.impact_line,
          `Best metric stack: ${calculator.best_stack.join(' > ')}`,
        ],
        footerNote,
        { calculator }
      ),
      richDeckSlide(
        'proposed_solution',
        'Move common FDM jobs into a guided quote conversation',
        'Proposed solution',
        'Trennen can turn material, quality, quantity, and file details into a cleaner quote path before the customer submits.',
        guidedQuotePath,
        [
          `Current pricing system: ${quotePositioning.current_read}`,
          `Why Trennen is better: ${quotePositioning.why_trennen_better}`,
          `Other services: ${adjacentServicesNote}`,
          'Customer benefit: fewer blank submissions, clearer expectations, faster quote decisions for common FDM work.',
          'Business benefit: more complete job data before staff spend time pricing or asking follow-up questions.',
        ],
        footerNote,
        { guided_quote_path: guidedQuotePath, quote_positioning: quotePositioning }
      ),
      richDeckSlide(
        'before_after',
        'Position the benefit around their current quote workflow',
        'Before / after',
        'This should feel like an operational improvement, not a generic software pitch.',
        [...beforeAfterModel.before, ...beforeAfterModel.after],
        [
          `Before: ${beforeAfterModel.before_title}`,
          `After: ${beforeAfterModel.after_title}`,
        ],
        'Avoid promising exact conversion lift unless the customer gives baseline data or a pilot produces it.',
        { before_after: beforeAfterModel }
      ),
      richDeckSlide(
        'small_ask',
        'A low-risk next step for the cold email',
        'Small ask',
        'The call-to-action should be short, concrete, and based on their visible website path.',
        [
          '10-minute quote-flow audit: walk through the existing website quote path and identify where pricing friction appears.',
          'Tailored guided-quote demo: show material, quality, quantity, file-upload, and turnaround options using their FDM workflow.',
          'Implementation support: if they run MJF or other services too, map those into guided intake and integration steps without claiming instant pricing is ready for them.',
          'Pilot decision: only continue if they see a practical reduction in quoting back-and-forth.',
        ],
        [
          'Suggested email CTA: Worth a 10-minute look at where your current quote path could be made faster?',
          ...(warnings.length ? warnings : ['No blocking warnings stored for this deck.']),
        ],
        footerNote
      ),
      richDeckSlide(
        'evidence_appendix',
        'Evidence appendix',
        'Claims, sources, confidence, and last-checked details',
        'Use this slide to keep the pitch honest and auditable.',
        appendix.map(row => `${row.field}: ${row.value} (${row.confidence})`),
        ledger.map(item => item.snippet).slice(0, 8),
        'This deck uses public website/profile observations and editable assumptions. It is not private analytics and should be updated with real customer data before making performance claims.',
        { appendix_rows: appendix }
      ),
    ];

    return {
      company_name: name,
      title: `Trennen quote-flow pitch for ${name}`,
      status: readiness.status,
      status_label: readiness.label,
      generated_at: now,
      last_checked_at: now,
      score: score.score,
      score_label: score.tier.label,
      confidence: brief.confidence,
      warnings,
      evidence: ledger,
      metrics: metricCards,
      metric_cards: metricCards,
      audit_methodology: methodology,
      theme: templateTheme(),
      guided_quote_path: guidedQuotePath,
      calculator,
      quote_positioning: quotePositioning,
      adjacent_services_note: adjacentServicesNote,
      before_after: beforeAfterModel,
      appendix_rows: appendix,
      footer_note: footerNote,
      slides,
      email_intro: presentationSafeText(`I put together a short quote-flow audit for ${name}. It uses only public website and Google signals, flags anything that needs review, and shows where Trennen could make custom FDM quoting clearer for customers.`),
      copy: slides.map((slide, index) => [
        `Slide ${index + 1}: ${slide.title}`,
        slide.kicker,
        slide.claim,
        ...slide.bullets.map(item => `- ${item}`),
        slide.proof.length ? 'Proof:' : '',
        ...slide.proof.map(item => `- ${item}`),
        slide.footer,
      ].filter(Boolean).join('\n')).join('\n\n'),
    };
  }

  function refreshLeadFromDiscoveryData(existing, refreshed, checkedAt = new Date().toISOString()) {
    const previous = normaliseLead(existing || {}, { skipDeck: true });
    const incoming = normaliseLead(refreshed || {}, { skipDeck: true, now: checkedAt });
    const merged = {
      ...previous,
      ...incoming,
      status: previous.status && previous.status !== 'research' ? previous.status : incoming.status,
      notes: previous.notes || incoming.notes,
      pitch_angle: previous.pitch_angle || incoming.pitch_angle,
      sales_boost_summary: previous.sales_boost_summary || incoming.sales_boost_summary,
      target_reason: previous.target_reason || incoming.target_reason,
      traffic_notes: previous.traffic_notes || incoming.traffic_notes,
      deck_generated_at: checkedAt,
      deck_last_checked_at: checkedAt,
      deck_status: '',
      pitch_deck: null,
    };
    return normaliseLead(merged, { now: checkedAt });
  }

  function generateCompanyBrief(input) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const evidence = evidenceList(lead);
    const howTrennenHelps = helpBullets(lead).map(presentationSafeText);
    const brief = {
      company_name: lead.company_name,
      headline: presentationSafeText(leadHeadline(lead)),
      snapshot: presentationSafeText([
        contactSnapshot(lead),
        lead.custom_fdm_status ? `Fit: ${labelValue(lead.custom_fdm_status)}` : '',
      lead.service_model ? `Model: ${labelValue(lead.service_model)}` : '',
        lead.pricing_maturity ? `Pricing: ${labelValue(lead.pricing_maturity)}` : '',
      ].filter(Boolean).join(' | ')),
      evidence,
      quote_workflow: quoteWorkflowPhrase(lead.quote_system),
      sales_leak: presentationSafeText(salesLeakHypothesis(lead)),
      demand_proxy: presentationSafeText(demandProxy(lead)),
      how_trennen_helps: howTrennenHelps,
      pitch_angle: pitchAngleForLead(lead),
      recommended_next_step: presentationSafeText(recommendedNextStep(lead)),
      confidence: presentationConfidence(lead),
    };
    brief.copy = [
      brief.headline,
      '',
      `Snapshot: ${brief.snapshot || 'Company details need review.'}`,
      `Evidence: ${brief.evidence.join(' | ') || 'Evidence needs review.'}`,
      `Sales leak hypothesis: ${brief.sales_leak}`,
      `Demand/opportunity proxy: ${brief.demand_proxy}`,
      'How Trennen helps:',
      ...brief.how_trennen_helps.map(item => `- ${item}`),
      `Pitch angle: ${brief.pitch_angle}`,
      `Recommended next step: ${brief.recommended_next_step}`,
      `Confidence: ${brief.confidence}`,
    ].join('\n');
    return brief;
  }

  function deckSlide(title, kicker, bullets, footer = '') {
    return {
      title: presentationSafeText(title),
      kicker: presentationSafeText(kicker),
      bullets: (bullets || []).filter(Boolean).map(presentationSafeText),
      footer: presentationSafeText(footer),
    };
  }

  function generateMiniDeck(input) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const brief = generateCompanyBrief(lead);
    const score = generateScoreExplanation(lead);
    const name = lead.company_name || 'this business';
    const scoreText = `${score.score} out of 100 opportunity score: ${score.tier.label}.`;
    const evidence = brief.evidence.length ? brief.evidence.slice(0, 3) : ['Evidence needs manual review before outreach.'];
    const help = brief.how_trennen_helps.slice(0, 3);

    const slides = [
      deckSlide(
        `Quick quote-flow audit for ${name}`,
        'Prepared as an evidence-led custom FDM outreach snapshot.',
        [
          scoreText,
          brief.snapshot || 'Company details need review.',
          `Current quote workflow: ${brief.quote_workflow}.`,
        ],
        `Confidence: ${brief.confidence}`
      ),
      deckSlide(
        'What customers likely experience today',
        'Observed website and Google signals, not private analytics.',
        [
          ...evidence,
          brief.demand_proxy,
        ],
        'Treat demand as a proxy unless the business shares analytics.'
      ),
      deckSlide(
        'Where sales may be leaking',
        'The outreach angle should focus on quote-flow friction.',
        [
          brief.sales_leak,
          `Top opportunity lever: ${topOpportunityLever(lead)}.`,
          `Recommended action: ${recommendedActionLabel(lead)}.`,
        ],
        'Avoid promising exact lift; lead with a short audit and demo.'
      ),
      deckSlide(
        'How Trennen can help',
        'A guided quoting experience for custom FDM jobs.',
        [
          ...help,
          brief.recommended_next_step,
        ],
        `Pitch angle: ${brief.pitch_angle}`
      ),
    ];

    return {
      company_name: name,
      title: `Quick quote-flow audit for ${name}`,
      score: score.score,
      score_label: score.tier.label,
      confidence: brief.confidence,
      slides,
      email_intro: presentationSafeText(`I put together a quick quote-flow audit for ${name} showing where custom FDM customers may hesitate before requesting a price, and how Trennen could make that path clearer.`),
      copy: slides.map((slide, index) => [
        `Slide ${index + 1}: ${slide.title}`,
        slide.kicker,
        ...slide.bullets.map(item => `- ${item}`),
        slide.footer,
      ].filter(Boolean).join('\n')).join('\n\n'),
    };
  }

  function leadToPresentationRow(input) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const brief = generateCompanyBrief(lead);
    return {
      headline: brief.headline,
      evidence: brief.evidence.join('; '),
      sales_leak: brief.sales_leak,
      how_trennen_helps: brief.how_trennen_helps.join(' | '),
      pitch_angle: brief.pitch_angle,
      confidence: brief.confidence,
      recommended_next_step: brief.recommended_next_step,
      company_name: lead.company_name,
      website: lead.website,
      contact_email: lead.contact_email,
      quote_system: lead.quote_system,
      custom_fdm_status: lead.custom_fdm_status,
      service_presence_status: lead.service_presence_status,
      pricing_maturity: lead.pricing_maturity,
      opportunity_type: lead.opportunity_type,
      demand_proxy: brief.demand_proxy,
    };
  }

  function presentationLeads(leads, options = {}) {
    return (leads || [])
      .map(lead => normaliseLead(lead, { skipDeck: true }))
      .filter(lead => isPresentationTarget(lead, options.includeReview));
  }

  function leadsToPresentationCsv(leads, options = {}) {
    const headers = [
      'headline',
      'evidence',
      'sales_leak',
      'how_trennen_helps',
      'pitch_angle',
      'confidence',
      'recommended_next_step',
      'company_name',
      'website',
      'contact_email',
      'quote_system',
      'custom_fdm_status',
      'service_presence_status',
      'pricing_maturity',
      'opportunity_type',
      'demand_proxy',
    ];
    const rows = presentationLeads(leads, options).map(lead => {
      const row = leadToPresentationRow(lead);
      return headers.map(header => row[header] || '');
    });
    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function leadsToDeckMarkdown(leads, options = {}) {
    const rows = presentationLeads(leads, options);
    if (!rows.length) return '# Trennen Prospect Briefs\n\nNo target custom FDM prospects selected.';
    return [
      '# Trennen Prospect Briefs',
      '',
      ...rows.map((lead, index) => {
        const brief = generateCompanyBrief(lead);
        return [
          `## ${index + 1}. ${brief.headline}`,
          '',
          `**Snapshot:** ${brief.snapshot || 'Company details need review.'}`,
          '',
          `**Evidence:** ${brief.evidence.join(' | ') || 'Evidence needs review.'}`,
          '',
          `**Sales Leak Hypothesis:** ${brief.sales_leak}`,
          '',
          `**Demand / Opportunity Proxy:** ${brief.demand_proxy}`,
          '',
          '**How Trennen Helps:**',
          ...brief.how_trennen_helps.map(item => `- ${item}`),
          '',
          `**Pitch Angle:** ${brief.pitch_angle}`,
          '',
          `**Recommended Next Step:** ${brief.recommended_next_step}`,
          '',
          `**Confidence:** ${brief.confidence}`,
          '',
        ].join('\n');
      }),
    ].join('\n');
  }

  function pipelineStatusLabel(value) {
    return {
      new_lead: 'New lead',
      researched: 'Researched',
      emailed: 'Emailed',
      called: 'Called',
      interested: 'Interested',
      follow_up: 'Follow up',
      not_interested: 'Not interested',
      won: 'Won',
      do_not_contact: 'Do not contact',
    }[value] || 'New lead';
  }

  function updateLeadPipelineStatus(input, pipelineStatus, options = {}) {
    const existing = normaliseLead(input || {}, { skipDeck: true });
    const nextStatus = cleanEnum(pipelineStatus, PIPELINE_STATUS_VALUES, existing.pipeline_status || 'new_lead');
    const now = cleanText(options.now) || new Date().toISOString();
    const contactNotes = cleanText(options.contact_notes, 2000);
    return normaliseLead({
      ...existing,
      pipeline_status: nextStatus,
      status: compatibilityStatusForPipeline(nextStatus),
      do_not_contact: nextStatus === 'do_not_contact' ? true : existing.do_not_contact,
      last_contacted_at: PIPELINE_CONTACTED_VALUES.has(nextStatus) ? now : existing.last_contacted_at,
      next_follow_up_at: cleanText(options.next_follow_up_at, 80) || existing.next_follow_up_at,
      contact_notes: contactNotes || existing.contact_notes,
    });
  }

  function canExportForOutreach(lead, options = {}) {
    if (lead.do_not_contact) return false;
    if (lead.pipeline_status === 'do_not_contact' || lead.pipeline_status === 'not_interested') return false;
    if (lead.custom_fdm_status === 'not_target') return false;
    if (options.targetOnly && !['target_confirmed', 'target_likely'].includes(lead.custom_fdm_status)) return false;
    if (options.requireEmail && !lead.contact_email) return false;
    return true;
  }

  function metricSummaryForLead(lead) {
    return [
      `pipeline ${pipelineStatusLabel(lead.pipeline_status)}`,
      `custom FDM ${labelValue(lead.custom_fdm_status || 'review_needed')}`,
      `FDM ${lead.fdm_status || 'unknown'}`,
      `quote system ${lead.quote_system || 'unknown'}`,
      `pricing maturity ${lead.pricing_maturity || 'unknown'}`,
      `opportunity type ${lead.opportunity_type || 'unknown'}`,
      `pricing friction ${lead.pricing_friction_score}/100`,
      `traffic ${lead.traffic_band}`,
      `conversion leak ${lead.conversion_leak_score}/100`,
      `fit ${lead.business_fit_score}/100`,
      lead.google_review_count ? `Google reviews ${lead.google_review_count}` : '',
    ].filter(Boolean).join('; ');
  }

  function leadsToEmailCsv(leads) {
    const headers = [
      'company_name',
      'contact_email',
      'contact_name',
      'website',
      'city',
      'region',
      'pipeline_status',
      'custom_fdm_status',
      'target_reason',
      'opportunity_score',
      'metric_summary',
      'pain_point',
      'sales_boost_summary',
      'pitch_angle',
      'confidence',
    ];

    const rows = (leads || [])
      .map(lead => normaliseLead(lead, { skipDeck: true }))
      .filter(lead => lead.status === 'ready' && canExportForOutreach(lead, { requireEmail: true, targetOnly: true }))
      .map(lead => {
        return [
          lead.company_name,
          lead.contact_email,
          lead.contact_name,
          lead.website,
          lead.city,
          lead.region,
          pipelineStatusLabel(lead.pipeline_status),
          labelValue(lead.custom_fdm_status),
          lead.target_reason,
          lead.opportunity_score,
          metricSummaryForLead(lead),
          lead.pain_point,
          lead.sales_boost_summary,
          lead.pitch_angle,
          lead.confidence,
        ];
      });

    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function leadsToSelectedEmailCsv(leads) {
    const rows = (leads || [])
      .map(lead => normaliseLead(lead, { skipDeck: true }))
      .filter(lead => canExportForOutreach(lead, { requireEmail: true, targetOnly: true }));
    return leadsToEmailCsv(rows.map(lead => ({ ...lead, status: 'ready' })));
  }

  function leadsToCallSheetCsv(leads) {
    const headers = [
      'company_name',
      'contact_phone',
      'contact_email',
      'contact_name',
      'website',
      'city',
      'pipeline_status',
      'last_contacted_at',
      'next_follow_up_at',
      'next_action',
      'pitch_angle',
      'pain_point',
      'contact_notes',
      'opportunity_score',
      'quote_system',
      'custom_fdm_status',
    ];
    const rows = (leads || [])
      .map(lead => normaliseLead(lead, { skipDeck: true }))
      .filter(lead => canExportForOutreach(lead))
      .map(lead => [
        lead.company_name,
        lead.contact_phone,
        lead.contact_email,
        lead.contact_name,
        lead.website,
        lead.city,
        pipelineStatusLabel(lead.pipeline_status),
        lead.last_contacted_at,
        lead.next_follow_up_at,
        recommendedActionLabel(lead),
        lead.pitch_angle,
        lead.pain_point,
        lead.contact_notes,
        lead.opportunity_score,
        labelValue(lead.quote_system),
        labelValue(lead.custom_fdm_status),
      ]);
    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function firstName(name) {
    return cleanText(name, 80).split(/\s+/).filter(Boolean)[0] || '';
  }

  function htmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function unsubscribeLine(options = {}) {
    const email = cleanText(options.unsubscribeEmail || options.replyTo || options.senderEmail, 200);
    if (email) return `Unsubscribe / do not contact: reply "no thanks" or email ${email} and I won't contact you again.`;
    return 'Unsubscribe / do not contact: reply "no thanks" and I won\'t contact you again.';
  }

  function outreachEligibility(input, suppressionKeys = []) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const suppressed = new Set(sanitizeIdentityKeys(suppressionKeys));
    const reasons = [];
    const warnings = [];

    if (!lead.contact_email) reasons.push('Missing contact email.');
    if (lead.do_not_contact) reasons.push('Lead is marked do not contact.');
    if (lead.custom_fdm_status === 'not_target') reasons.push('Lead is classified as not a custom FDM target.');
    if (!['target_confirmed', 'target_likely'].includes(lead.custom_fdm_status)) reasons.push('Custom FDM target fit is not confirmed or likely.');
    if (lead.status === 'not_fit') reasons.push('Lead status is not fit.');
    if (leadIdentityKeys(lead).some(key => suppressed.has(key))) reasons.push('Lead is suppressed on the local do-not-contact list.');

    const deckStatus = lead.deck_status || deckReadiness(lead).status;
    if (deckStatus === 'not_suitable') reasons.push('Pitch deck is marked not suitable.');
    if (deckStatus === 'needs_evidence') warnings.push('Pitch deck needs evidence review before sending.');
    if (deckStatus === 'needs_refresh') warnings.push('Pitch deck evidence is stale and should be refreshed before sending.');
    if (lead.status !== 'ready') warnings.push('Lead is not marked email ready.');

    return {
      eligible: reasons.length === 0,
      reasons,
      warnings,
      deck_status: deckStatus,
    };
  }

  function generateOutreachEmail(input, options = {}) {
    const lead = normaliseLead(input || {}, { skipDeck: true });
    const senderName = cleanText(options.senderName, 80) || 'Daniel';
    const senderBusiness = cleanText(options.senderBusiness, 120) || 'Trennen';
    const company = lead.company_name || 'your 3D printing business';
    const recipientName = firstName(lead.contact_name);
    const greeting = recipientName ? `Hey ${recipientName},` : `Hey ${company} team,`;
    const pain = presentationSafeText(lead.pain_point || salesLeakHypothesis(lead));
    const positioning = quoteSystemPositioning(lead);
    const evidence = (lead.evidence || []).slice(0, 2).map(presentationSafeText).join(' / ');
    const subject = presentationSafeText(`quick quote-flow thought for ${company}`);
    const adjacentServices = adjacentServicesSupportNote();
    const softener = lead.confidence === 'observed' || lead.discovery_confidence === 'observed'
      ? 'I used the public stuff I could see online, so the deck separates what I actually saw from what still needs checking.'
      : 'I used the public stuff I could see online, so a few parts are marked as needing review instead of pretending I know your private numbers.';
    const deckLine = `I attached a short PDF deck for ${company}. It is not a giant sales brochure, more like a quick audit you can poke holes in.`;
    const cta = 'Worth taking a look and seeing if a faster quote path would be useful? Happy to show what this could look like for your current workflow.';
    const signature = `${senderName}\n${senderBusiness}`;
    const footer = unsubscribeLine(options);

    const lines = [
      greeting,
      '',
      `I was looking at ${company} and made a quick quote-flow audit from public website/Google info.`,
      softener,
      '',
      `The main thing I noticed: ${pain}`,
      `I also tried to account for your current pricing setup: ${positioning.current_read} ${positioning.why_trennen_better}`,
      `Also, if you run MJF or other services as well, I do not want to pretend we auto-price those today. ${adjacentServices}`,
      evidence ? `A couple of the signals I used: ${evidence}.` : 'I did not find enough source snippets to make that a hard claim, so the deck calls that out.',
      '',
      deckLine,
      cta,
      '',
      signature,
      '',
      footer,
    ];
    const text = presentationSafeText(lines.join('\n'));
    const html = text.split(/\n{2,}/).map(paragraph => `<p>${htmlEscape(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n');

    return {
      subject,
      text,
      html,
      attachment_label: `${company} pitch deck PDF`,
      tone: 'human_casual',
    };
  }

  function leadsToResearchCsv(leads) {
    const headers = [
      'company_name',
      'website',
      'contact_email',
      'contact_name',
      'contact_phone',
      'city',
      'region',
      'services',
      'status',
      'pipeline_status',
      'last_contacted_at',
      'next_follow_up_at',
      'contact_notes',
      'fdm_status',
      'custom_fdm_status',
      'service_model',
      'service_presence_status',
      'target_reason',
      'quote_system',
      'pricing_maturity',
      'opportunity_type',
      'pricing_signal',
      'traffic_band',
      'pricing_friction_score',
      'traffic_score',
      'conversion_leak_score',
      'business_fit_score',
      'contactability_score',
      'opportunity_score',
      'confidence',
      'discovery_confidence',
      'google_place_id',
      'google_rating',
      'google_review_count',
      'pain_point',
      'sales_boost_summary',
      'pitch_angle',
      'traffic_notes',
      'evidence',
      'notes',
      'newly_added_at',
      'newly_added_source',
      'newly_added_batch',
      'source',
    ];

    const rows = (leads || []).map(lead => headers.map(header => {
      if (header === 'evidence') return (lead.evidence || []).join('; ');
      return lead[header] == null ? '' : lead[header];
    }));

    return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function labelValue(value) {
    return cleanText(value, 120).replace(/_/g, ' ');
  }

  return {
    calculateLeadScores,
    normaliseLead,
    generateDashboardInsights,
    generateDeckEvidenceLedger,
    generateMiniDeck,
    generatePitchDeck,
    generateScoreExplanation,
    deckReadiness,
    refreshLeadFromDiscoveryData,
    quoteSystemPositioning,
    leadIdentityKeys,
    candidateIdentityKeys,
    leadMergeKey,
    knownLeadKeys,
    sanitizeIdentityKeys,
    hasKnownIdentity,
    markNewLeads,
    mergeLeadLists,
    csvToLeads,
    discoveryJsonToLeads,
    generateCompanyBrief,
    leadToPresentationRow,
    leadsToEmailCsv,
    leadsToSelectedEmailCsv,
    leadsToCallSheetCsv,
    updateLeadPipelineStatus,
    pipelineStatusLabel,
    generateOutreachEmail,
    outreachEligibility,
    leadsToPresentationCsv,
    leadsToDeckMarkdown,
    leadsToResearchCsv,
    parseCsv,
  };
});
