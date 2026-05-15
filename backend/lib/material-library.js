/**
 * 3D-printing material library — curated reference data used by the admin
 * panel's "Suggest from library" feature.
 *
 * Each entry has:
 *   key         — normalised id
 *   displayName — friendly label
 *   category    — FDM | Resin | SLS | Specialty
 *   aliases     — alternate names / brand variants for fuzzy matching
 *   strength    / flexibility / heat — bar values (0–100)
 *   production_days_min / max — typical lead-time suggestion
 *   ideal_for   — short bullet list (3–5 items)
 *   not_for     — short bullet list (2–4 items)
 *
 * Values are derived from common manufacturer datasheets and 3D-printing
 * community references. They are intentionally on a 0–100 perceptual scale,
 * not literal MPa / °C values.
 */

const BASE_MATERIAL_LIBRARY = [
  // ── FDM / FFF filaments ──────────────────────────────────────
  {
    key: 'pla', displayName: 'PLA', category: 'FDM',
    aliases: ['pla', 'standard pla', 'basic pla', 'polylactic acid', 'pla basic'],
    strength: 62, flexibility: 20, heat: 30,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Prototypes & concept models',
      'Display pieces & figurines',
      'Everyday household objects',
      'Low-stress decorative parts',
    ],
    not_for: [
      'Outdoor UV exposure',
      'High-heat environments (>55 °C)',
      'Load-bearing functional parts',
    ],
  },
  {
    key: 'pla_plus', displayName: 'PLA+', category: 'FDM',
    aliases: ['pla+', 'pla plus', 'pla pro', 'pla tough', 'tough pla', 'pla max', 'polymax pla'],
    strength: 72, flexibility: 32, heat: 35,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Functional prototypes',
      'Light-duty mechanical parts',
      'Snap-fit assemblies',
      'Drop-tolerant display pieces',
    ],
    not_for: [
      'Sustained heat exposure',
      'High-cycle fatigue applications',
      'Outdoor long-term use',
    ],
  },
  {
    key: 'pla_silk', displayName: 'PLA Silk', category: 'FDM',
    aliases: ['pla silk', 'silk pla', 'silky pla', 'pla shine'],
    strength: 55, flexibility: 22, heat: 30,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Decorative prints with metallic sheen',
      'Vase-mode prints',
      'Cosplay & display props',
    ],
    not_for: [
      'Mechanical or structural parts',
      'Fine surface detail (slightly more stringing)',
      'Heat-exposed parts',
    ],
  },
  {
    key: 'pla_cf', displayName: 'PLA-CF (Carbon Fiber)', category: 'FDM',
    aliases: ['pla-cf', 'pla cf', 'carbon fiber pla', 'pla carbon', 'cf pla'],
    strength: 78, flexibility: 18, heat: 45,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Lightweight stiff prototypes',
      'RC chassis & drone frames',
      'Tool jigs requiring rigidity',
      'Matte aesthetic parts',
    ],
    not_for: [
      'Flexible or impact-prone parts',
      'Printers without hardened nozzles',
      'Food-contact applications',
    ],
  },
  {
    key: 'pla_wood', displayName: 'PLA-Wood', category: 'FDM',
    aliases: ['pla wood', 'wood pla', 'woodfill', 'wood-fill pla', 'pla-wood'],
    strength: 52, flexibility: 18, heat: 30,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Decorative wood-look pieces',
      'Picture frames & ornaments',
      'Sandable / stainable display models',
    ],
    not_for: [
      'Load-bearing parts',
      'Thin walls or fine detail',
      'Wet environments',
    ],
  },
  {
    key: 'petg', displayName: 'PETG', category: 'FDM',
    aliases: ['petg', 'pet-g', 'pet g', 'copolyester', 'polyethylene terephthalate glycol'],
    strength: 75, flexibility: 45, heat: 55,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Mechanical & structural parts',
      'Water-resistant containers',
      'Brackets and clips',
      'Light outdoor use',
    ],
    not_for: [
      'Very high-precision fine detail',
      'Sustained temperatures above 80 °C',
      'Chemical exposure (solvents)',
    ],
  },
  {
    key: 'petg_cf', displayName: 'PETG-CF (Carbon Fiber)', category: 'FDM',
    aliases: ['petg-cf', 'petg cf', 'carbon fiber petg', 'cf petg'],
    strength: 85, flexibility: 35, heat: 65,
    production_days_min: 2, production_days_max: 4,
    ideal_for: [
      'Rigid engineering prototypes',
      'Drone & robotics components',
      'Tooling and fixtures',
    ],
    not_for: [
      'Flexible parts',
      'Highly detailed cosmetic surfaces',
      'Printers without hardened nozzles',
    ],
  },
  {
    key: 'abs', displayName: 'ABS', category: 'FDM',
    aliases: ['abs', 'acrylonitrile butadiene styrene'],
    strength: 70, flexibility: 55, heat: 72,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Automotive & under-hood prototypes',
      'Functional housings',
      'Parts needing post-processing (acetone smoothing)',
      'Mid-heat applications',
    ],
    not_for: [
      'Open-air printers without enclosure (warping)',
      'Direct outdoor UV exposure',
      'Odour-sensitive environments',
    ],
  },
  {
    key: 'asa', displayName: 'ASA', category: 'FDM',
    aliases: ['asa', 'acrylonitrile styrene acrylate'],
    strength: 72, flexibility: 35, heat: 80,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Outdoor enclosures & housings',
      'Automotive external parts',
      'UV-stable garden fixtures',
      'Weather-exposed signage',
    ],
    not_for: [
      'Food-contact applications',
      'Ultra-fine miniature detail',
      'Open-air printers (warping)',
    ],
  },
  {
    key: 'nylon', displayName: 'Nylon', category: 'FDM',
    aliases: ['nylon', 'pa', 'pa6', 'pa12', 'pa-6', 'pa-12', 'polyamide'],
    strength: 88, flexibility: 65, heat: 78,
    production_days_min: 2, production_days_max: 4,
    ideal_for: [
      'Gears, bearings & bushings',
      'Snap-fit assemblies',
      'Living hinges',
      'Functional engineering prototypes',
    ],
    not_for: [
      'High-moisture environments (absorbs water)',
      'Fine decorative surface detail',
      'Tight tolerance parts without drying',
    ],
  },
  {
    key: 'nylon_cf', displayName: 'Nylon-CF (Carbon Fiber)', category: 'FDM',
    aliases: ['nylon-cf', 'nylon cf', 'pa-cf', 'pa cf', 'carbon fiber nylon', 'onyx'],
    strength: 95, flexibility: 35, heat: 85,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'Industrial tooling & fixtures',
      'Aerospace & robotics components',
      'High-stress functional parts',
      'Lightweight stiff brackets',
    ],
    not_for: [
      'Flexible or rubbery applications',
      'Hobby printers without hardened nozzles',
      'Fine cosmetic surface finish',
    ],
  },
  {
    key: 'nylon_gf', displayName: 'Nylon-GF (Glass Fiber)', category: 'FDM',
    aliases: ['nylon-gf', 'nylon gf', 'pa-gf', 'glass fiber nylon', 'gf nylon'],
    strength: 90, flexibility: 40, heat: 82,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'High-stiffness engineering parts',
      'Tooling and jigs',
      'Light structural brackets',
    ],
    not_for: [
      'Flexible parts',
      'Standard hobbyist nozzles (abrasive)',
      'Highly detailed cosmetic prints',
    ],
  },
  {
    key: 'pc', displayName: 'Polycarbonate (PC)', category: 'FDM',
    aliases: ['pc', 'polycarbonate', 'lexan'],
    strength: 92, flexibility: 55, heat: 88,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'High-temperature engineering parts',
      'Impact-resistant housings',
      'Transparent functional prototypes',
      'Light fixtures & lenses',
    ],
    not_for: [
      'Open-frame printers (warping)',
      'UV-exposed outdoor use (yellows)',
      'Beginner setups (high print temps)',
    ],
  },
  {
    key: 'pc_abs', displayName: 'PC-ABS Blend', category: 'FDM',
    aliases: ['pc-abs', 'pc abs', 'polycarbonate abs blend'],
    strength: 85, flexibility: 55, heat: 80,
    production_days_min: 2, production_days_max: 4,
    ideal_for: [
      'Automotive interior parts',
      'Tool housings',
      'Mid-heat impact-resistant prototypes',
    ],
    not_for: [
      'UV-exposed parts',
      'Open-air printers without enclosure',
    ],
  },
  {
    key: 'tpu_95a', displayName: 'TPU 95A', category: 'FDM',
    aliases: ['tpu', 'tpu 95a', 'tpu95a', 'thermoplastic polyurethane', 'flexible filament'],
    strength: 52, flexibility: 92, heat: 42,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Phone & device cases',
      'Gaskets and seals',
      'Grip handles & soft-touch parts',
      'Wheels & tyres for RC',
    ],
    not_for: [
      'Rigid structural components',
      'Fine surface detail',
      'High-temperature exposure',
    ],
  },
  {
    key: 'tpu_85a', displayName: 'TPU 85A', category: 'FDM',
    aliases: ['tpu 85a', 'tpu85a', 'soft tpu', 'very flexible tpu'],
    strength: 38, flexibility: 100, heat: 38,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Highly flexible parts',
      'Wearable & soft-grip items',
      'Damping pads & vibration mounts',
    ],
    not_for: [
      'Any rigid or load-bearing use',
      'Detailed prints (very slow to print)',
      'High-temperature applications',
    ],
  },
  {
    key: 'tpe', displayName: 'TPE', category: 'FDM',
    aliases: ['tpe', 'thermoplastic elastomer'],
    strength: 45, flexibility: 95, heat: 40,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Soft-touch grips',
      'Rubber-like seals',
      'Wearable accessories',
    ],
    not_for: [
      'Structural parts',
      'Tight tolerance fits',
      'Hot environments',
    ],
  },
  {
    key: 'hips', displayName: 'HIPS', category: 'FDM',
    aliases: ['hips', 'high impact polystyrene'],
    strength: 60, flexibility: 35, heat: 60,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Lightweight parts',
      'Dissolvable support (with ABS)',
      'Models & display pieces',
    ],
    not_for: [
      'Outdoor or UV-exposed parts',
      'High-detail cosmetic surfaces',
    ],
  },
  {
    key: 'pva', displayName: 'PVA (Support)', category: 'FDM',
    aliases: ['pva', 'polyvinyl alcohol', 'water soluble support', 'pva support'],
    strength: 25, flexibility: 30, heat: 25,
    production_days_min: 2, production_days_max: 4,
    ideal_for: [
      'Water-soluble support material',
      'Complex overhangs with PLA',
      'Multi-material prints',
    ],
    not_for: [
      'Any final-part use',
      'Humid storage environments',
      'Single-extruder printers',
    ],
  },
  {
    key: 'pp', displayName: 'Polypropylene (PP)', category: 'FDM',
    aliases: ['pp', 'polypropylene'],
    strength: 60, flexibility: 80, heat: 65,
    production_days_min: 2, production_days_max: 4,
    ideal_for: [
      'Living hinges',
      'Chemical-resistant containers',
      'Watertight parts',
      'Fatigue-resistant applications',
    ],
    not_for: [
      'High-detail prints (warps easily)',
      'Bonding / gluing applications',
      'High-temperature use',
    ],
  },
  {
    key: 'peek', displayName: 'PEEK', category: 'FDM',
    aliases: ['peek', 'polyether ether ketone'],
    strength: 98, flexibility: 50, heat: 100,
    production_days_min: 5, production_days_max: 8,
    ideal_for: [
      'Aerospace & medical-grade parts',
      'Continuous high-heat environments (250 °C+)',
      'Chemically aggressive environments',
      'High-load structural components',
    ],
    not_for: [
      'Cost-sensitive projects',
      'Standard FDM printers (needs 400 °C+ hotend)',
      'Hobbyist applications',
    ],
  },
  {
    key: 'pei', displayName: 'PEI / ULTEM', category: 'FDM',
    aliases: ['pei', 'ultem', 'polyetherimide', 'ultem 9085', 'ultem 1010'],
    strength: 95, flexibility: 45, heat: 95,
    production_days_min: 5, production_days_max: 8,
    ideal_for: [
      'Aerospace & defence components',
      'Flame-retardant electrical housings',
      'High-temperature engineering parts',
    ],
    not_for: [
      'Standard hobby printers',
      'Budget prototypes',
      'Flexible applications',
    ],
  },
  {
    key: 'pom', displayName: 'POM / Acetal', category: 'FDM',
    aliases: ['pom', 'acetal', 'delrin', 'polyoxymethylene'],
    strength: 80, flexibility: 60, heat: 75,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'Low-friction gears & bushings',
      'Mechanical sliding parts',
      'Precision engineering parts',
    ],
    not_for: [
      'Bonding (very hard to glue)',
      'Standard hobbyist setups (poor bed adhesion)',
      'Outdoor UV exposure',
    ],
  },

  // ── Resin (SLA / DLP / MSLA) ────────────────────────────────
  {
    key: 'resin_standard', displayName: 'Standard Resin', category: 'Resin',
    aliases: ['resin', 'standard resin', 'sla resin', 'dlp resin', 'msla resin', 'basic resin', 'normal resin'],
    strength: 55, flexibility: 15, heat: 40,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'High-detail miniatures & figurines',
      'Jewelry masters & prototypes',
      'Smooth display models',
      'Dental and orthodontic models',
    ],
    not_for: [
      'Load-bearing functional parts',
      'Outdoor UV exposure (becomes brittle)',
      'Snap-fit or flexing parts',
    ],
  },
  {
    key: 'resin_tough', displayName: 'Tough Resin (ABS-Like)', category: 'Resin',
    aliases: ['tough resin', 'abs-like resin', 'abs like resin', 'engineering resin', 'durable resin'],
    strength: 72, flexibility: 40, heat: 55,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Functional resin prototypes',
      'Impact-resistant snap parts',
      'Rugged engineering models',
    ],
    not_for: [
      'Continuous high-heat use',
      'Outdoor UV exposure',
      'Extremely flexible applications',
    ],
  },
  {
    key: 'resin_flexible', displayName: 'Flexible Resin', category: 'Resin',
    aliases: ['flexible resin', 'soft resin', 'rubber-like resin', 'elastic resin'],
    strength: 48, flexibility: 85, heat: 40,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Soft-touch grips & buttons',
      'Wearables & ergonomic prototypes',
      'Seals and gaskets',
    ],
    not_for: [
      'Rigid load-bearing parts',
      'Long-term outdoor use',
      'Tight tolerance fits',
    ],
  },
  {
    key: 'resin_hightemp', displayName: 'High-Temp Resin', category: 'Resin',
    aliases: ['high temp resin', 'high-temp resin', 'heat resistant resin', 'thermal resin'],
    strength: 60, flexibility: 18, heat: 90,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Injection-mould prototyping',
      'Heat-exposed test fixtures',
      'Steam-resistant prototypes',
    ],
    not_for: [
      'Impact-prone parts (brittle)',
      'Flexing applications',
    ],
  },
  {
    key: 'resin_castable', displayName: 'Castable Resin', category: 'Resin',
    aliases: ['castable resin', 'jewelry resin', 'wax resin', 'investment casting resin'],
    strength: 35, flexibility: 12, heat: 35,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Jewelry investment casting',
      'Dental crown patterns',
      'Lost-wax patterns for metal casting',
    ],
    not_for: [
      'End-use functional parts',
      'Anything load-bearing',
    ],
  },
  {
    key: 'resin_dental', displayName: 'Dental Resin', category: 'Resin',
    aliases: ['dental resin', 'dental model resin', 'model resin', 'orthodontic resin'],
    strength: 55, flexibility: 18, heat: 50,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Dental and orthodontic model workflows',
      'Review models and fit-check prototypes',
      'Specialty resin demonstrations',
    ],
    not_for: [
      'Certified medical or biocompatible use without exact resin approval',
      'Load-bearing functional parts',
    ],
  },
  {
    key: 'resin_water_washable', displayName: 'Water-Washable Resin', category: 'Resin',
    aliases: ['water washable resin', 'water-washable resin', 'eco resin'],
    strength: 50, flexibility: 15, heat: 38,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Hobbyist miniatures & figurines',
      'Easier post-processing (no IPA)',
      'Detailed display prints',
    ],
    not_for: [
      'High-strength functional parts',
      'Long-term humid storage (absorbs moisture)',
      'Outdoor UV exposure',
    ],
  },
  {
    key: 'resin_transparent', displayName: 'Transparent / Clear Resin', category: 'Resin',
    aliases: ['transparent resin', 'clear resin', 'see through resin'],
    strength: 50, flexibility: 15, heat: 40,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Light-transmitting prototypes',
      'Lenses & optical mock-ups',
      'See-through display models',
    ],
    not_for: [
      'Load-bearing applications',
      'Yellowing-sensitive long-term outdoor use',
    ],
  },

  // ── SLS / MJF (powder) ──────────────────────────────────────
  {
    key: 'sls_pa12', displayName: 'SLS PA12 Nylon', category: 'SLS',
    aliases: ['sls pa12', 'sls nylon', 'mjf pa12', 'pa12 sls', 'sls nylon 12'],
    strength: 85, flexibility: 60, heat: 80,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'Functional end-use parts',
      'Living hinges & snap-fits',
      'Detailed enclosures',
      'Batch production prototypes',
    ],
    not_for: [
      'Highly detailed cosmetic-grade smoothness',
      'Watertight parts without sealing',
    ],
  },
  {
    key: 'sls_pa11', displayName: 'SLS PA11 Nylon', category: 'SLS',
    aliases: ['sls pa11', 'pa11 sls', 'mjf pa11'],
    strength: 80, flexibility: 75, heat: 78,
    production_days_min: 3, production_days_max: 5,
    ideal_for: [
      'Impact-resistant functional parts',
      'Wearables & medical-grade prototypes',
      'Bio-based engineering applications',
    ],
    not_for: [
      'Highest-strength applications (PA-GF wins)',
      'High-detail cosmetic surfaces',
    ],
  },
  {
    key: 'sls_pa_gf', displayName: 'SLS PA-GF (Glass-Filled)', category: 'SLS',
    aliases: ['sls pa-gf', 'pa-gf', 'glass filled sls', 'sls glass nylon'],
    strength: 92, flexibility: 35, heat: 88,
    production_days_min: 4, production_days_max: 6,
    ideal_for: [
      'Stiff industrial components',
      'High-temperature engineering parts',
      'Tooling and jigs',
    ],
    not_for: [
      'Flexible applications',
      'Highly detailed cosmetic prints',
    ],
  },

  // ── Specialty / aesthetic ───────────────────────────────────
  {
    key: 'pla_conductive', displayName: 'Conductive PLA', category: 'Specialty',
    aliases: ['conductive pla', 'electric pla'],
    strength: 50, flexibility: 18, heat: 30,
    production_days_min: 2, production_days_max: 3,
    ideal_for: [
      'Low-voltage prototyping circuits',
      'Touch-sensitive buttons',
      'Educational electronics demos',
    ],
    not_for: [
      'High-current power applications',
      'Structural parts',
    ],
  },
  {
    key: 'pla_glow', displayName: 'Glow-in-the-Dark PLA', category: 'Specialty',
    aliases: ['glow pla', 'glow in the dark pla', 'gid pla', 'phosphorescent pla'],
    strength: 50, flexibility: 18, heat: 30,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Decorative night-glow pieces',
      'Cosplay & party props',
      'Safety markers',
    ],
    not_for: [
      'Mechanical or structural parts',
      'Printers without hardened nozzles (mildly abrasive)',
    ],
  },
];

function fdmMaterial({
  key,
  displayName,
  aliases,
  strength,
  flexibility,
  heat,
  tags = [],
  bestFor = [],
  notFor = [],
  detail = 4,
  outdoorUse = null,
  production = [2, 3],
}) {
  const best = bestFor.length ? bestFor : ['Configurable FDM parts'];
  const avoid = notFor.length ? notFor : ['Applications requiring certified material data'];
  const tagSet = [...new Set(['FDM', ...tags])];
  const specs = [
    { label: 'Process', value: 'FDM / FFF filament' },
    { label: 'Strength', value: `${strength}/100` },
    { label: 'Flexibility', value: `${flexibility}/100` },
    { label: 'Heat resistance', value: `${heat}/100` },
    { label: 'Detail', value: `${detail}/5` },
  ];
  if (outdoorUse != null) specs.push({ label: 'Outdoor use', value: `${outdoorUse}/5` });
  return {
    key,
    displayName,
    category: 'FDM',
    aliases,
    strength,
    flexibility,
    heat,
    detail,
    outdoorUse,
    tags: tagSet,
    best_for: best.slice(0, 4),
    ideal_for: best,
    not_for: avoid,
    specs,
    production_days_min: production[0],
    production_days_max: production[1],
    shortDescription: `Commonly used for ${best.slice(0, 2).join(', ')}.`,
    longDescription: `${displayName} is an FDM/FFF filament option commonly used for ${best.slice(0, 3).join(', ')}. It is less suitable for ${avoid.slice(0, 2).join(', ')}. Review these defaults against the exact brand and printer profile before publishing.`,
    learn_more: `${displayName} defaults are practical quoting estimates. Adjust ratings, colours, finishes, pricing, and print limits to match the material brand your store actually offers.`,
  };
}

const EXPANDED_FDM_LIBRARY = [
  fdmMaterial({ key: 'pla', displayName: 'PLA', aliases: ['pla', 'standard pla', 'basic pla', 'polylactic acid'], strength: 62, flexibility: 20, heat: 30, tags: ['Low cost', 'Smooth finish'], bestFor: ['Concept models', 'Display pieces', 'General prototypes'], notFor: ['High-heat environments', 'Load-bearing parts'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_plus', displayName: 'PLA+', aliases: ['pla+', 'pla plus', 'pla pro', 'pla max', 'polymax pla'], strength: 72, flexibility: 32, heat: 35, tags: ['Low cost', 'Strong'], bestFor: ['Functional prototypes', 'Light-duty brackets', 'Snap-fit assemblies'], notFor: ['Sustained heat', 'Long-term outdoor use'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'tough_pla', displayName: 'Tough PLA / PLA Pro', aliases: ['tough pla', 'pla tough', 'pla pro tough', 'impact pla', 'high toughness pla'], strength: 76, flexibility: 36, heat: 35, tags: ['Strong', 'Low cost'], bestFor: ['Impact-resistant prototypes', 'Jigs', 'Light mechanical parts'], notFor: ['High-temperature use', 'Outdoor UV exposure'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'matte_pla', displayName: 'Matte PLA', aliases: ['matte pla', 'pla matte', 'polyterra pla', 'panchroma matte pla'], strength: 58, flexibility: 18, heat: 30, tags: ['Aesthetic', 'Smooth finish', 'Low cost'], bestFor: ['Presentation models', 'Architectural models', 'Low-gloss display parts'], notFor: ['Mechanical parts', 'Heat-exposed parts'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_silk', displayName: 'Silk PLA', aliases: ['silk pla', 'pla silk', 'silky pla', 'shiny pla', 'metallic silk pla'], strength: 55, flexibility: 22, heat: 30, tags: ['Aesthetic', 'Smooth finish'], bestFor: ['Decorative prints', 'Cosplay props', 'Vase-mode parts'], notFor: ['Structural parts', 'Precision snap fits'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_dual_silk', displayName: 'Dual / Tri-Colour Silk PLA', aliases: ['dual silk pla', 'tri color silk pla', 'tri-colour silk pla', 'multicolor silk pla', 'rainbow silk pla'], strength: 52, flexibility: 22, heat: 30, tags: ['Aesthetic'], bestFor: ['Decorative models', 'Colour-shift display pieces', 'Trophies and ornaments'], notFor: ['Functional parts', 'Colour-critical production runs'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_high_speed', displayName: 'High-Speed PLA', aliases: ['high speed pla', 'pla high speed', 'rapid pla', 'hs pla'], strength: 60, flexibility: 22, heat: 30, tags: ['Low cost'], bestFor: ['Fast prototypes', 'Draft models', 'General-purpose parts'], notFor: ['Certified strength applications', 'High-heat environments'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'recycled_pla', displayName: 'Recycled PLA', aliases: ['recycled pla', 'rpla', 'eco pla', 'reclaimed pla'], strength: 58, flexibility: 20, heat: 30, tags: ['Low cost', 'Aesthetic'], bestFor: ['General prototypes', 'Display parts', 'Lower-impact material demos'], notFor: ['Certified recycled-content claims without supplier data', 'High-heat environments'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_lightweight', displayName: 'Lightweight PLA / LW-PLA', aliases: ['lightweight pla', 'lw-pla', 'lw pla', 'foaming pla', 'aero pla'], strength: 38, flexibility: 18, heat: 28, tags: ['Aesthetic'], bestFor: ['RC aircraft', 'Low-weight shells', 'Large decorative parts'], notFor: ['Load-bearing parts', 'Tight tolerance fits'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'pla_cf', displayName: 'PLA-CF', aliases: ['pla-cf', 'pla cf', 'carbon fiber pla', 'carbon fibre pla', 'cf pla'], strength: 78, flexibility: 18, heat: 45, tags: ['Strong', 'Engineering'], bestFor: ['Rigid prototypes', 'Matte brackets', 'Tooling mockups'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'pla_gf', displayName: 'PLA-GF', aliases: ['pla-gf', 'pla gf', 'glass fiber pla', 'glass fibre pla', 'gf pla'], strength: 74, flexibility: 20, heat: 42, tags: ['Strong', 'Engineering'], bestFor: ['Stiff prototypes', 'Dimensional jigs', 'Matte engineering models'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'pla_wood', displayName: 'Wood PLA', aliases: ['wood pla', 'pla wood', 'woodfill', 'wood-filled pla', 'wood fiber pla'], strength: 52, flexibility: 18, heat: 30, tags: ['Aesthetic'], bestFor: ['Wood-look decorative parts', 'Frames', 'Sandable models'], notFor: ['Thin detailed parts', 'Wet environments'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_metal_fill', displayName: 'Metal-Fill PLA', aliases: ['metal fill pla', 'metal-filled pla', 'bronze pla', 'copper pla', 'steel pla'], strength: 50, flexibility: 16, heat: 30, tags: ['Aesthetic'], bestFor: ['Weighted display parts', 'Polishable models', 'Decorative hardware'], notFor: ['Functional metal replacement', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'pla_marble', displayName: 'Marble / Stone PLA', aliases: ['marble pla', 'stone pla', 'granite pla', 'rock pla'], strength: 52, flexibility: 18, heat: 30, tags: ['Aesthetic'], bestFor: ['Sculptures', 'Planters', 'Stone-look display pieces'], notFor: ['Mechanical parts', 'High-wear surfaces'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_glow', displayName: 'Glow-in-the-Dark PLA', aliases: ['glow pla', 'glow in the dark pla', 'gid pla', 'phosphorescent pla'], strength: 50, flexibility: 18, heat: 30, tags: ['Aesthetic'], bestFor: ['Safety markers', 'Novelty parts', 'Cosplay props'], notFor: ['Structural parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'pla_conductive', displayName: 'Conductive PLA', aliases: ['conductive pla', 'electric pla', 'electrically conductive pla', 'esd pla'], strength: 50, flexibility: 18, heat: 30, tags: ['Specialty'], bestFor: ['Low-voltage demos', 'Touch sensors', 'Educational circuits'], notFor: ['High-current applications', 'Structural parts'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'pvb', displayName: 'PVB', aliases: ['pvb', 'polyvinyl butyral', 'polysmooth', 'smoothable filament'], strength: 55, flexibility: 25, heat: 32, tags: ['Aesthetic', 'Smooth finish'], bestFor: ['Alcohol-smoothed display models', 'Decorative shells', 'Presentation prototypes'], notFor: ['High heat', 'Mechanical wear'], detail: 4, outdoorUse: 2, production: [1, 2] }),
  fdmMaterial({ key: 'petg', displayName: 'PETG', aliases: ['petg', 'pet-g', 'pet g', 'copolyester'], strength: 75, flexibility: 45, heat: 55, tags: ['Strong', 'Outdoor', 'Low cost'], bestFor: ['Brackets', 'Clips', 'Water-resistant containers'], notFor: ['Very fine cosmetic detail', 'Solvent exposure'], detail: 3, outdoorUse: 4, production: [2, 3] }),
  fdmMaterial({ key: 'recycled_petg', displayName: 'Recycled PETG', aliases: ['recycled petg', 'rpetg', 'reclaimed petg', 'eco petg'], strength: 70, flexibility: 44, heat: 54, tags: ['Strong', 'Outdoor'], bestFor: ['Functional prototypes', 'Reusable fixtures', 'Lower-impact material demos'], notFor: ['Certified recycled-content claims without supplier data', 'Very fine cosmetic detail'], detail: 3, outdoorUse: 4, production: [2, 3] }),
  fdmMaterial({ key: 'petg_hf', displayName: 'High-Flow PETG', aliases: ['high flow petg', 'petg high flow', 'petg hf', 'fast petg', 'rapid petg'], strength: 72, flexibility: 45, heat: 55, tags: ['Strong', 'Outdoor'], bestFor: ['Fast functional prototypes', 'Production batches', 'Large PETG parts'], notFor: ['Highly polished surfaces', 'Very high-temperature use'], detail: 3, outdoorUse: 4, production: [1, 2] }),
  fdmMaterial({ key: 'petg_cf', displayName: 'PETG-CF', aliases: ['petg-cf', 'petg cf', 'carbon fiber petg', 'carbon fibre petg', 'cf petg'], strength: 85, flexibility: 35, heat: 65, tags: ['Strong', 'Engineering', 'Outdoor'], bestFor: ['Rigid brackets', 'Tooling fixtures', 'Robotics parts'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'petg_gf', displayName: 'PETG-GF', aliases: ['petg-gf', 'petg gf', 'glass fiber petg', 'glass fibre petg', 'gf petg'], strength: 82, flexibility: 35, heat: 64, tags: ['Strong', 'Engineering', 'Outdoor'], bestFor: ['Stiff functional parts', 'Fixtures', 'Dimensionally stable PETG parts'], notFor: ['Flexible parts', 'Non-abrasive-only printers'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'petg_v0', displayName: 'PETG V0 / PETG-FR', aliases: ['petg v0', 'pet-g v0', 'petg-fr', 'petg fr', 'flame retardant petg', 'flame-retardant petg', 'fire resistant petg'], strength: 72, flexibility: 40, heat: 58, tags: ['Engineering', 'Strong'], bestFor: ['Electrical enclosure prototypes', 'Fixture covers', 'Fire-retardant material evaluations'], notFor: ['Compliance claims without exact supplier certification', 'Highly flexible parts'], detail: 3, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'petg_tungsten', displayName: 'PETG Tungsten', aliases: ['petg tungsten', 'tungsten petg', 'heavy petg', 'weighted petg', 'high density petg'], strength: 64, flexibility: 28, heat: 54, tags: ['Specialty', 'Engineering'], bestFor: ['Weighted prototypes', 'Ballast parts', 'High-density display pieces'], notFor: ['Lightweight parts', 'Printers without hardened nozzles'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'petg_magnetite', displayName: 'PETG Magnetite', aliases: ['petg magnetite', 'magnetite petg', 'magnetic petg', 'ferromagnetic petg', 'iron filled petg'], strength: 62, flexibility: 28, heat: 54, tags: ['Specialty', 'Engineering'], bestFor: ['Magnetic-fixture prototypes', 'Weighted parts', 'Sensor and magnet experiments'], notFor: ['Structural replacement parts', 'Printers without hardened nozzles'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'pctg', displayName: 'PCTG', aliases: ['pctg', 'polycyclohexylenedimethylene terephthalate glycol', 'tough petg alternative'], strength: 78, flexibility: 55, heat: 60, tags: ['Strong', 'Outdoor'], bestFor: ['Impact-resistant parts', 'Transparent prototypes', 'Functional enclosures'], notFor: ['High-temperature applications', 'Ultra-rigid fixtures'], detail: 3, outdoorUse: 4, production: [2, 3] }),
  fdmMaterial({ key: 'pet', displayName: 'PET', aliases: ['pet', 'polyethylene terephthalate', 'pet filament'], strength: 76, flexibility: 42, heat: 68, tags: ['Strong', 'Engineering'], bestFor: ['Functional prototypes', 'Clear or translucent parts', 'Chemical-resistant parts'], notFor: ['Easy beginner printing', 'High-warp geometry'], detail: 3, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'pet_cf', displayName: 'PET-CF', aliases: ['pet-cf', 'pet cf', 'carbon fiber pet', 'carbon fibre pet'], strength: 88, flexibility: 32, heat: 78, tags: ['Strong', 'Engineering'], bestFor: ['Stiff engineering parts', 'Tooling', 'Heat-stable brackets'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'cpe', displayName: 'CPE', aliases: ['cpe', 'co-polyester', 'copolyester cpe'], strength: 74, flexibility: 45, heat: 62, tags: ['Strong', 'Engineering'], bestFor: ['Functional prototypes', 'Chemical-resistant parts', 'Tough enclosures'], notFor: ['Very high heat', 'Beginner open-frame printing'], detail: 4, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'cpe_plus', displayName: 'CPE+', aliases: ['cpe+', 'cpe plus', 'high temperature cpe'], strength: 78, flexibility: 45, heat: 78, tags: ['Strong', 'Engineering'], bestFor: ['Higher-heat enclosures', 'Functional housings', 'Chemical-resistant parts'], notFor: ['Flexible parts', 'Easy low-temperature printing'], detail: 4, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'abs', displayName: 'ABS', aliases: ['abs', 'acrylonitrile butadiene styrene'], strength: 70, flexibility: 55, heat: 72, tags: ['Strong', 'Engineering'], bestFor: ['Functional housings', 'Automotive prototypes', 'Acetone-smoothed parts'], notFor: ['Open-air printing', 'Outdoor UV exposure'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'abs_gf', displayName: 'ABS-GF', aliases: ['abs-gf', 'abs gf', 'glass fiber abs', 'glass fibre abs'], strength: 78, flexibility: 38, heat: 76, tags: ['Strong', 'Engineering'], bestFor: ['Stiff housings', 'Fixtures', 'Heat-resistant brackets'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 2, production: [2, 4] }),
  fdmMaterial({ key: 'abs_cf', displayName: 'ABS-CF', aliases: ['abs-cf', 'abs cf', 'carbon fiber abs', 'carbon fibre abs'], strength: 80, flexibility: 35, heat: 78, tags: ['Strong', 'Engineering'], bestFor: ['Rigid ABS parts', 'Tooling', 'Matte functional prototypes'], notFor: ['Flexible parts', 'Open-frame printing'], detail: 3, outdoorUse: 2, production: [2, 4] }),
  fdmMaterial({ key: 'asa', displayName: 'ASA', aliases: ['asa', 'acrylonitrile styrene acrylate'], strength: 72, flexibility: 35, heat: 80, tags: ['Outdoor', 'Engineering'], bestFor: ['Outdoor enclosures', 'UV-exposed parts', 'Automotive exterior prototypes'], notFor: ['Food contact', 'Open-air printing'], detail: 3, outdoorUse: 5, production: [2, 3] }),
  fdmMaterial({ key: 'asa_cf', displayName: 'ASA-CF', aliases: ['asa-cf', 'asa cf', 'carbon fiber asa', 'carbon fibre asa'], strength: 82, flexibility: 28, heat: 84, tags: ['Outdoor', 'Strong', 'Engineering'], bestFor: ['Rigid outdoor parts', 'Weather-resistant brackets', 'Automotive exterior parts'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 5, production: [2, 4] }),
  fdmMaterial({ key: 'asa_gf', displayName: 'ASA-GF', aliases: ['asa-gf', 'asa gf', 'glass fiber asa', 'glass fibre asa'], strength: 80, flexibility: 30, heat: 83, tags: ['Outdoor', 'Strong', 'Engineering'], bestFor: ['Stiff weather-resistant parts', 'Outdoor fixtures', 'Dimensional ASA parts'], notFor: ['Flexible parts', 'Non-abrasive-only printers'], detail: 3, outdoorUse: 5, production: [2, 4] }),
  fdmMaterial({ key: 'tpu', displayName: 'TPU', aliases: ['generic tpu', 'standard tpu', 'thermoplastic polyurethane', 'flexible filament'], strength: 50, flexibility: 88, heat: 40, tags: ['Flexible'], bestFor: ['Flexible prototypes', 'Grips', 'Bumpers'], notFor: ['Rigid structural components', 'High-temperature parts'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_98a', displayName: 'TPU 98A', aliases: ['tpu 98a', 'tpu98a', '98a tpu', 'shore 98a tpu', 'hard tpu', 'rigid tpu', 'semi-rigid tpu'], strength: 58, flexibility: 72, heat: 45, tags: ['Flexible'], bestFor: ['Semi-flexible brackets', 'Tough wear parts', 'Grippy functional parts'], notFor: ['Very soft parts', 'High-temperature parts'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_95a', displayName: 'TPU 95A', aliases: ['tpu', 'tpu 95a', 'tpu95a', '95a tpu', 'shore 95a tpu', 'thermoplastic polyurethane', 'flexible filament'], strength: 52, flexibility: 92, heat: 42, tags: ['Flexible'], bestFor: ['Phone cases', 'Gaskets', 'Grip handles'], notFor: ['Rigid structural parts', 'Fine cosmetic detail'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_95a_hf', displayName: 'TPU 95A High Flow', aliases: ['tpu 95a high flow', 'tpu high flow', 'tpu hf', 'high flow tpu', 'tpu 95a hf', '95a high flow tpu', 'fast tpu'], strength: 52, flexibility: 90, heat: 42, tags: ['Flexible'], bestFor: ['Faster flexible parts', 'Production TPU batches', 'Grips and bumpers'], notFor: ['Very soft elastomer parts', 'High heat'], detail: 3, outdoorUse: 3, production: [1, 2] }),
  fdmMaterial({ key: 'tpu_ams', displayName: 'TPU for AMS / AMS-Compatible TPU', aliases: ['tpu for ams', 'ams tpu', 'tpu ams', 'tpu ams compatible', 'ams-compatible tpu', 'ams compatible tpu', 'bambu tpu for ams', 'tpu for automatic material system', 'tpu 68d', '68d tpu', 'shore 68d tpu'], strength: 55, flexibility: 82, heat: 42, tags: ['Flexible'], bestFor: ['AMS-compatible flexible prints', 'Multimaterial flexible details', 'Grippy inserts'], notFor: ['Very soft TPU applications', 'Generic AMS profiles without testing'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_90a', displayName: 'TPU 90A', aliases: ['tpu 90a', 'tpu90a', '90a tpu', 'shore 90a tpu', 'flexible 90a', 'soft 90a tpu'], strength: 48, flexibility: 96, heat: 40, tags: ['Flexible'], bestFor: ['Soft bumpers', 'Wearables', 'Flexible grips'], notFor: ['Rigid structural parts', 'Fast print profiles'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_85a', displayName: 'TPU 85A', aliases: ['tpu 85a', 'tpu85a', '85a tpu', 'shore 85a tpu', 'soft 85a tpu', 'soft tpu', 'very flexible tpu', 'flexible 85a'], strength: 38, flexibility: 100, heat: 38, tags: ['Flexible'], bestFor: ['Very flexible parts', 'Wearables', 'Damping pads'], notFor: ['Rigid parts', 'Tight tolerance assemblies'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpu_83a', displayName: 'TPU 83A', aliases: ['tpu 83a', 'tpu83a', '83a tpu', 'shore 83a tpu', 'soft 83a tpu', 'flexible 83a'], strength: 35, flexibility: 100, heat: 37, tags: ['Flexible'], bestFor: ['Soft grips', 'Flexible seals', 'Wearable test parts'], notFor: ['Rigid assemblies', 'Fast print profiles', 'Sharp detail'], detail: 2, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'tpu_80a', displayName: 'TPU 80A', aliases: ['tpu 80a', 'tpu80a', '80a tpu', 'shore 80a tpu', 'super soft tpu', 'flexible 80a'], strength: 32, flexibility: 100, heat: 36, tags: ['Flexible'], bestFor: ['Soft seals', 'Cushioning parts', 'Highly flexible wearables'], notFor: ['Dimensional precision', 'Rigid or load-bearing parts'], detail: 2, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'tpu_75a', displayName: 'TPU 75A', aliases: ['tpu 75a', 'tpu75a', '75a tpu', 'shore 75a tpu', 'ultra soft 75a tpu', 'flexible 75a'], strength: 28, flexibility: 100, heat: 35, tags: ['Flexible'], bestFor: ['Soft pads', 'Compliant prototypes', 'Elastic bumpers'], notFor: ['Tight tolerance assemblies', 'Rigid parts', 'Fast print speeds'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'tpu_70a', displayName: 'TPU 70A', aliases: ['tpu 70a', 'tpu70a', '70a tpu', 'shore 70a tpu', 'ultra soft tpu', 'flexible 70a'], strength: 25, flexibility: 100, heat: 34, tags: ['Flexible'], bestFor: ['Ultra-soft prototypes', 'Rubber-like pads', 'Elastic test pieces'], notFor: ['Detailed prints', 'Fast print speeds'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'peba', displayName: 'PEBA / High-Rebound Flexible', aliases: ['peba', 'pebax', 'pebax-like', 'pebax like', 'super tpu', 'high rebound flexible', 'rebound peba', 'peba 90a', 'peba 95a', 'nylon based flexible'], strength: 55, flexibility: 98, heat: 45, tags: ['Flexible', 'Engineering'], bestFor: ['High-rebound prototypes', 'Sports gear concepts', 'Soft robotics trials'], notFor: ['Rigid parts', 'Generic TPU profiles without testing', 'Certified skin-contact claims'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'peba_cf', displayName: 'PEBA-CF', aliases: ['peba-cf', 'peba cf', 'carbon fiber peba', 'carbon fibre peba', 'cf peba', 'stiff peba'], strength: 66, flexibility: 76, heat: 52, tags: ['Flexible', 'Engineering', 'Strong'], bestFor: ['Reinforced flexible fixtures', 'Impact-absorbing brackets', 'Lightweight resilient prototypes'], notFor: ['Very soft elastomer parts', 'Printers without hardened nozzles', 'Certified performance claims'], detail: 2, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'tpe', displayName: 'TPE', aliases: ['tpe', 'thermoplastic elastomer', 'rubber-like filament'], strength: 45, flexibility: 95, heat: 40, tags: ['Flexible'], bestFor: ['Soft grips', 'Rubber-like seals', 'Wearable accessories'], notFor: ['Structural parts', 'Tight tolerance fits'], detail: 3, outdoorUse: 3, production: [2, 3] }),
  fdmMaterial({ key: 'tpc', displayName: 'TPC', aliases: ['tpc', 'thermoplastic copolyester', 'copolyester elastomer'], strength: 50, flexibility: 88, heat: 58, tags: ['Flexible', 'Engineering'], bestFor: ['Flexible chemical-resistant parts', 'Wear components', 'Outdoor flexible parts'], notFor: ['Rigid structures', 'Very high-temperature use'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'pa6', displayName: 'Nylon PA6', aliases: ['pa6', 'pa-6', 'nylon pa6', 'nylon 6', 'polyamide 6'], strength: 88, flexibility: 65, heat: 78, tags: ['Strong', 'Engineering'], bestFor: ['Gears', 'Bushings', 'Functional mechanical parts'], notFor: ['Undried filament use', 'Decorative high-detail surfaces'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'pa12', displayName: 'Nylon PA12', aliases: ['pa12', 'pa-12', 'nylon pa12', 'nylon 12', 'polyamide 12'], strength: 82, flexibility: 65, heat: 75, tags: ['Strong', 'Engineering'], bestFor: ['Low-moisture nylon parts', 'Snap fits', 'Wear-resistant parts'], notFor: ['Cosmetic smoothness', 'Very high-temperature use'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'nylon_copa', displayName: 'Nylon CoPA', aliases: ['nylon copa', 'copa', 'pa6/pa66', 'nylon copolymer', 'polymide copa'], strength: 86, flexibility: 62, heat: 76, tags: ['Strong', 'Engineering'], bestFor: ['Functional engineering parts', 'Tough brackets', 'Wear-resistant components'], notFor: ['Undried filament use', 'Easy beginner printing'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'pa11_cf', displayName: 'PA11-CF', aliases: ['pa11-cf', 'pa11 cf', 'nylon pa11 cf', 'pa11 carbon fiber', 'pa11 carbon fibre', 'bio-based nylon cf'], strength: 86, flexibility: 45, heat: 80, tags: ['Strong', 'Engineering'], bestFor: ['Impact-resistant nylon parts', 'Lightweight fixtures', 'Functional outdoor prototypes'], notFor: ['Very flexible parts', 'Printers without hardened nozzles', 'Certified bio-based claims without supplier data'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'pa6_cf', displayName: 'PA6-CF', aliases: ['pa6-cf', 'pa6 cf', 'nylon pa6 cf', 'pa6 carbon fiber', 'pa6 carbon fibre'], strength: 95, flexibility: 35, heat: 88, tags: ['Strong', 'Engineering'], bestFor: ['Industrial tooling', 'Structural brackets', 'Robotics parts'], notFor: ['Flexible applications', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'pa6_gf', displayName: 'PA6-GF', aliases: ['pa6-gf', 'pa6 gf', 'nylon pa6 gf', 'pa6 glass fiber', 'pa6 glass fibre'], strength: 90, flexibility: 40, heat: 84, tags: ['Strong', 'Engineering'], bestFor: ['High-stiffness parts', 'Jigs', 'Light structural fixtures'], notFor: ['Flexible applications', 'Non-abrasive-only printers'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'pa12_cf', displayName: 'PA12-CF', aliases: ['pa12-cf', 'pa12 cf', 'nylon pa12 cf', 'pa12 carbon fiber', 'pa12 carbon fibre'], strength: 90, flexibility: 35, heat: 82, tags: ['Strong', 'Engineering'], bestFor: ['Stiff low-moisture nylon parts', 'Fixtures', 'Lightweight brackets'], notFor: ['Flexible parts', 'Cosmetic surfaces'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'paht_cf', displayName: 'PAHT-CF', aliases: ['paht-cf', 'paht cf', 'high temperature nylon cf', 'pa ht cf'], strength: 94, flexibility: 34, heat: 92, tags: ['Strong', 'Engineering'], bestFor: ['Heat-resistant tooling', 'Automotive prototypes', 'Industrial brackets'], notFor: ['Flexible parts', 'Low-temperature printers'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'ppa_cf', displayName: 'PPA-CF', aliases: ['ppa-cf', 'ppa cf', 'carbon fiber ppa', 'carbon fibre ppa', 'polyphthalamide cf'], strength: 96, flexibility: 30, heat: 95, tags: ['Strong', 'Engineering'], bestFor: ['High-performance brackets', 'Heat-stable engineering parts', 'Industrial tooling'], notFor: ['Budget prototypes', 'Flexible applications'], detail: 3, outdoorUse: 4, production: [4, 6] }),
  fdmMaterial({ key: 'pc', displayName: 'Polycarbonate (PC)', aliases: ['pc', 'polycarbonate', 'lexan'], strength: 92, flexibility: 55, heat: 88, tags: ['Strong', 'Engineering'], bestFor: ['Impact-resistant housings', 'High-heat prototypes', 'Transparent functional parts'], notFor: ['Open-frame printers', 'UV-exposed outdoor use'], detail: 3, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'pc_blend', displayName: 'PC Blend', aliases: ['pc blend', 'polycarbonate blend', 'pc blended filament', 'prusament pc blend'], strength: 88, flexibility: 52, heat: 84, tags: ['Strong', 'Engineering'], bestFor: ['Tough housings', 'Heat-resistant prototypes', 'Impact-resistant fixtures'], notFor: ['Open-frame printers', 'UV-exposed outdoor use', 'Flexible parts'], detail: 3, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'pc_abs', displayName: 'PC-ABS', aliases: ['pc-abs', 'pc abs', 'polycarbonate abs blend'], strength: 85, flexibility: 55, heat: 80, tags: ['Strong', 'Engineering'], bestFor: ['Tool housings', 'Automotive interiors', 'Impact-resistant enclosures'], notFor: ['Outdoor UV exposure', 'Open-air printing'], detail: 3, outdoorUse: 2, production: [2, 4] }),
  fdmMaterial({ key: 'pc_cf', displayName: 'PC-CF', aliases: ['pc-cf', 'pc cf', 'carbon fiber pc', 'carbon fibre pc', 'polycarbonate cf'], strength: 95, flexibility: 35, heat: 92, tags: ['Strong', 'Engineering'], bestFor: ['Rigid high-heat parts', 'Fixtures', 'Structural prototypes'], notFor: ['Flexible applications', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'pc_fr', displayName: 'PC-FR', aliases: ['pc-fr', 'pc fr', 'flame retardant pc', 'flame-retardant polycarbonate'], strength: 88, flexibility: 48, heat: 88, tags: ['Strong', 'Engineering'], bestFor: ['Electrical housings', 'Heat-resistant enclosures', 'Flame-retardant prototypes'], notFor: ['Unverified compliance claims', 'Open-frame printing'], detail: 3, outdoorUse: 3, production: [3, 5] }),
  fdmMaterial({ key: 'pp', displayName: 'Polypropylene (PP)', aliases: ['pp', 'polypropylene'], strength: 60, flexibility: 80, heat: 65, tags: ['Flexible', 'Outdoor'], bestFor: ['Living hinges', 'Chemical-resistant containers', 'Fatigue-resistant parts'], notFor: ['High-detail prints', 'Easy bed adhesion'], detail: 3, outdoorUse: 4, production: [2, 4] }),
  fdmMaterial({ key: 'pp_cf', displayName: 'PP-CF', aliases: ['pp-cf', 'pp cf', 'carbon fiber polypropylene', 'carbon fibre polypropylene', 'cf pp'], strength: 76, flexibility: 55, heat: 72, tags: ['Flexible', 'Engineering', 'Strong', 'Outdoor'], bestFor: ['Stiffer living-hinge prototypes', 'Chemical-resistant brackets', 'Fatigue-resistant fixtures'], notFor: ['Very high-detail prints', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'pp_gf', displayName: 'PP-GF', aliases: ['pp-gf', 'pp gf', 'glass fiber polypropylene', 'glass fibre polypropylene', 'gf pp'], strength: 74, flexibility: 56, heat: 70, tags: ['Flexible', 'Engineering', 'Strong', 'Outdoor'], bestFor: ['Stiff chemical-resistant parts', 'Light-duty fixtures', 'Fatigue-resistant prototypes'], notFor: ['Very high-detail prints', 'Non-abrasive-only printers'], detail: 3, outdoorUse: 4, production: [3, 5] }),
  fdmMaterial({ key: 'pom', displayName: 'POM / Acetal', aliases: ['pom', 'acetal', 'delrin', 'polyoxymethylene'], strength: 80, flexibility: 60, heat: 75, tags: ['Strong', 'Engineering'], bestFor: ['Low-friction gears', 'Bushings', 'Sliding mechanical parts'], notFor: ['Easy adhesion', 'Bonded assemblies'], detail: 3, outdoorUse: 2, production: [3, 5] }),
  fdmMaterial({ key: 'pmma', displayName: 'PMMA / Acrylic', aliases: ['pmma', 'acrylic filament', 'polymethyl methacrylate'], strength: 62, flexibility: 20, heat: 65, tags: ['Aesthetic', 'Smooth finish'], bestFor: ['Transparent display parts', 'Light guides', 'Acrylic-like prototypes'], notFor: ['Impact-prone parts', 'Easy printing'], detail: 4, outdoorUse: 3, production: [2, 4] }),
  fdmMaterial({ key: 'peek', displayName: 'PEEK', aliases: ['peek', 'polyether ether ketone'], strength: 98, flexibility: 50, heat: 100, tags: ['Strong', 'Engineering'], bestFor: ['High-heat engineering parts', 'Chemical-resistant components', 'Aerospace prototypes'], notFor: ['Standard printers', 'Cost-sensitive prototypes'], detail: 3, outdoorUse: 4, production: [5, 8] }),
  fdmMaterial({ key: 'pei', displayName: 'PEI / ULTEM', aliases: ['pei', 'ultem', 'polyetherimide', 'ultem 9085', 'ultem 1010'], strength: 95, flexibility: 45, heat: 95, tags: ['Strong', 'Engineering'], bestFor: ['Flame-resistant housings', 'Aerospace parts', 'High-temperature components'], notFor: ['Standard printers', 'Flexible applications'], detail: 3, outdoorUse: 3, production: [5, 8] }),
  fdmMaterial({ key: 'pekk', displayName: 'PEKK', aliases: ['pekk', 'polyetherketoneketone', 'pekk-a'], strength: 96, flexibility: 45, heat: 98, tags: ['Strong', 'Engineering'], bestFor: ['High-performance engineering parts', 'Chemical-resistant components', 'High-heat prototypes'], notFor: ['Standard printers', 'Budget parts'], detail: 3, outdoorUse: 4, production: [5, 8] }),
  fdmMaterial({ key: 'pps', displayName: 'PPS', aliases: ['pps', 'polyphenylene sulfide'], strength: 88, flexibility: 38, heat: 95, tags: ['Strong', 'Engineering'], bestFor: ['Chemical-resistant parts', 'Heat-stable components', 'Electrical housings'], notFor: ['Standard printers', 'Flexible parts'], detail: 3, outdoorUse: 4, production: [4, 6] }),
  fdmMaterial({ key: 'pps_cf', displayName: 'PPS-CF', aliases: ['pps-cf', 'pps cf', 'carbon fiber pps', 'carbon fibre pps'], strength: 94, flexibility: 28, heat: 98, tags: ['Strong', 'Engineering'], bestFor: ['Rigid chemical-resistant parts', 'Heat-stable fixtures', 'Industrial prototypes'], notFor: ['Flexible parts', 'Printers without hardened nozzles'], detail: 3, outdoorUse: 4, production: [4, 6] }),
  fdmMaterial({ key: 'ppsu', displayName: 'PPSU', aliases: ['ppsu', 'polyphenylsulfone'], strength: 90, flexibility: 50, heat: 96, tags: ['Strong', 'Engineering'], bestFor: ['Sterilizable prototypes', 'High-heat housings', 'Chemical-resistant parts'], notFor: ['Standard printers', 'Low-cost parts'], detail: 3, outdoorUse: 3, production: [4, 6] }),
  fdmMaterial({ key: 'psu', displayName: 'PSU', aliases: ['psu', 'polysulfone'], strength: 86, flexibility: 45, heat: 92, tags: ['Strong', 'Engineering'], bestFor: ['High-temperature prototypes', 'Electrical housings', 'Chemical-resistant components'], notFor: ['Standard printers', 'Flexible parts'], detail: 3, outdoorUse: 3, production: [4, 6] }),
  fdmMaterial({ key: 'pvdf', displayName: 'PVDF', aliases: ['pvdf', 'polyvinylidene fluoride', 'fluoropolymer filament'], strength: 78, flexibility: 55, heat: 82, tags: ['Engineering', 'Outdoor'], bestFor: ['Chemical-resistant parts', 'Outdoor components', 'Specialty industrial prototypes'], notFor: ['Easy printing', 'Budget prototypes'], detail: 3, outdoorUse: 5, production: [3, 5] }),
  fdmMaterial({ key: 'pva', displayName: 'PVA Support', aliases: ['pva', 'pva support', 'water soluble support', 'polyvinyl alcohol'], strength: 25, flexibility: 30, heat: 25, tags: ['Support'], bestFor: ['Water-soluble supports', 'Complex overhangs', 'Dual-material prints'], notFor: ['End-use parts', 'Humid storage'], detail: 2, outdoorUse: 1, production: [2, 4] }),
  fdmMaterial({ key: 'bvoh', displayName: 'BVOH Support', aliases: ['bvoh', 'bvoh support', 'water soluble bvoh', 'butenediol vinyl alcohol'], strength: 22, flexibility: 30, heat: 25, tags: ['Support'], bestFor: ['Water-soluble supports', 'Complex support removal', 'Dual extrusion'], notFor: ['End-use parts', 'Humid storage'], detail: 2, outdoorUse: 1, production: [2, 4] }),
  fdmMaterial({ key: 'hips', displayName: 'HIPS Support', aliases: ['hips', 'hips support', 'high impact polystyrene', 'limonene soluble support'], strength: 60, flexibility: 35, heat: 60, tags: ['Support'], bestFor: ['ABS support material', 'Lightweight models', 'Soluble support workflows'], notFor: ['Outdoor UV exposure', 'High-detail cosmetic surfaces'], detail: 3, outdoorUse: 2, production: [2, 3] }),
  fdmMaterial({ key: 'breakaway_support', displayName: 'Breakaway Support', aliases: ['breakaway support', 'breakaway filament', 'support filament', 'manual support material'], strength: 25, flexibility: 22, heat: 35, tags: ['Support'], bestFor: ['Dual-material supports', 'Easy manual support removal', 'PLA or PETG support interfaces'], notFor: ['End-use parts', 'Flexible support geometry'], detail: 2, outdoorUse: 1, production: [2, 4] }),
];

const EXPANDED_FDM_KEYS = new Set(EXPANDED_FDM_LIBRARY.map(m => m.key));
export const MATERIAL_LIBRARY = [
  ...EXPANDED_FDM_LIBRARY,
  ...BASE_MATERIAL_LIBRARY.filter(m => !EXPANDED_FDM_KEYS.has(m.key)),
];

const SEARCH_SYNONYM_REPLACEMENTS = [
  [/\badditive manufacturing\b/g, '3d printing'],
  [/\badditive manufactured\b/g, '3d printing'],
  [/\badditive manufacture\b/g, '3d printing'],
  [/\bam material(s)?\b/g, '3d printing material'],
  [/\bam polymer(s)?\b/g, '3d printing polymer'],
  [/\bam plastic(s)?\b/g, '3d printing plastic'],
  [/\bfused filament fabrication\b/g, 'fff'],
  [/\bfused deposition modeling\b/g, 'fdm'],
  [/\bfused deposition modelling\b/g, 'fdm'],
  [/\bmaterial extrusion\b/g, 'fdm'],
  [/\bvat photopolymerization\b/g, 'resin'],
  [/\bvat photopolymerisation\b/g, 'resin'],
  [/\bphotopolymerization\b/g, 'resin'],
  [/\bphotopolymerisation\b/g, 'resin'],
  [/\bpowder bed fusion\b/g, 'sls'],
  [/\bselective laser sintering\b/g, 'sls'],
  [/\bmulti jet fusion\b/g, 'mjf'],
  [/\bmultijet fusion\b/g, 'mjf'],
  [/\bcarbon fibre\b/g, 'carbon fiber'],
  [/\bglass fibre\b/g, 'glass fiber'],
];

const SEARCH_NOISE_WORDS = new Set([
  '3d', 'print', 'printing', 'printer', 'printed', 'printable',
  'material', 'materials', 'polymer', 'polymers', 'plastic', 'plastics',
  'filament', 'filaments', 'resin', 'resins', 'powder', 'powders',
  'additive', 'manufacturing', 'manufacture', 'manufactured',
  'rapid', 'prototyping', 'prototype', 'industrial', 'commercial',
  'service', 'services', 'process', 'processes', 'technology', 'grade',
  'for', 'and', 'or', 'with', 'using', 'use',
]);

function normaliseSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[^a-z0-9+.#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Expand and clean material search text so "additive manufacturing PA12 powder",
 * "AM nylon 12", and "3D printing PETG filament" still match the material.
 */
export function materialSearchVariants(name) {
  const base = normaliseSearchText(name);
  if (!base) return [];

  let expanded = base;
  for (const [pattern, replacement] of SEARCH_SYNONYM_REPLACEMENTS) {
    expanded = expanded.replace(pattern, replacement);
  }

  const compact = expanded
    .split(' ')
    .filter(token => !SEARCH_NOISE_WORDS.has(token))
    .join(' ')
    .trim();

  const joinedCodes = expanded
    .replace(/\bpa\s*[- ]?\s*(6|11|12)\b/g, 'pa$1')
    .replace(/\btpu\s*[- ]?\s*(70a|75a|80a|83a|85a|90a|95a|98a|68d)\b/g, 'tpu $1')
    .replace(/\bpla\s*[- ]?\s*cf\b/g, 'pla-cf')
    .replace(/\bpetg\s*[- ]?\s*cf\b/g, 'petg-cf')
    .replace(/\bnylon\s*[- ]?\s*cf\b/g, 'nylon-cf')
    .replace(/\bnylon\s*[- ]?\s*gf\b/g, 'nylon-gf')
    .trim();

  return [...new Set([base, expanded, joinedCodes, compact].filter(Boolean))];
}

/**
 * Find the best library entry matching a free-form material name.
 * Strategy (in order):
 *   1. Exact match on displayName / alias across normalized variants
 *   2. Token match — longest library displayName/alias contained in the input
 *   3. Returns null if nothing usefully matches
 */
export function findMaterialMatch(name) {
  if (!name || typeof name !== 'string') return null;
  const variants = materialSearchVariants(name);
  if (!variants.length) return null;

  // 1. Exact displayName match
  for (const m of MATERIAL_LIBRARY) {
    const displayName = normaliseSearchText(m.displayName);
    if (variants.includes(displayName)) return m;
  }
  // 1b. Exact alias match
  for (const m of MATERIAL_LIBRARY) {
    if (m.aliases.some(a => variants.includes(normaliseSearchText(a)))) return m;
  }
  // 2. Substring match — pick the library entry with the LONGEST matching key
  let best = null, bestLen = 0;
  for (const m of MATERIAL_LIBRARY) {
    const candidates = [normaliseSearchText(m.displayName), ...m.aliases.map(a => normaliseSearchText(a))];
    for (const c of candidates) {
      // c must be at least 3 chars to avoid silly matches like "pp" inside "happy"
      if (c.length < 3) continue;
      // Word-boundary-ish: match c as a substring within any cleaned variant
      if (variants.some(v => v.includes(c)) && c.length > bestLen) {
        best = m;
        bestLen = c.length;
      }
    }
  }
  return best;
}

function clampRating(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(5, n > 5 ? Math.round(n / 20) : Math.round(n)));
}

function inferDetailRating(material) {
  if (material.detail != null) return clampRating(material.detail);
  const name = `${material.displayName || ''} ${(material.aliases || []).join(' ')}`.toLowerCase();
  if (material.category === 'Resin') return 5;
  if (material.category === 'SLS') return 4;
  if (/(silk|wood|flexible|tpu|tpe|carbon fiber|carbon fibre|glass fiber|glass fibre|cf|gf)/.test(name)) return 3;
  return 4;
}

function inferOutdoorRating(material) {
  if (material.outdoorUse != null) return clampRating(material.outdoorUse);
  const text = [
    material.displayName,
    material.category,
    ...(material.aliases || []),
    ...(material.ideal_for || []),
    ...(material.not_for || []),
  ].join(' ').toLowerCase();

  if (/\basa\b|uv-stable|weather|weather-resistant|outdoor enclosures|weather-exposed/.test(text)) return 5;
  if (/\bpetg\b|\bpp\b|polypropylene|\bsls\b|\bmjf\b|\bpa11\b|\bpa12\b|nylon/.test(text)) return 4;
  if (/outdoor uv exposure|uv-exposed|long-term outdoor|yellows|becomes brittle/.test(text)) return 2;
  if (material.heat >= 75) return 3;
  return 2;
}

function inferTags(material, ratings) {
  const tags = new Set(Array.isArray(material.tags) ? material.tags : []);
  if (material.strength >= 75) tags.add('Strong');
  if (material.flexibility >= 75) tags.add('Flexible');
  if (ratings.outdoorUse >= 4) tags.add('Outdoor');
  if (ratings.detail >= 4) tags.add('Smooth finish');
  if (material.strength >= 80 || material.heat >= 75 || material.category === 'SLS') tags.add('Engineering');
  if (['PLA', 'PLA+', 'PETG'].includes(material.displayName)) tags.add('Low cost');
  return [...tags];
}

function inferSpecs(material, ratings) {
  if (Array.isArray(material.specs) && material.specs.length) return material.specs;
  return [
    { label: 'Process', value: material.category || 'Configured by your store' },
    { label: 'Strength rating', value: `${ratings.strength}/5` },
    { label: 'Flexibility rating', value: `${ratings.flexibility}/5` },
    { label: 'Heat resistance rating', value: `${ratings.heatResistance}/5` },
    { label: 'Detail rating', value: `${ratings.detail}/5` },
    { label: 'Outdoor use rating', value: `${ratings.outdoorUse}/5` },
  ];
}

function inferDescription(material, ratings) {
  if (material.longDescription) return material.longDescription;
  const uses = (material.ideal_for || []).slice(0, 3).join(', ');
  const avoid = (material.not_for || []).slice(0, 2).join(', ');
  const parts = [
    `${material.displayName} is commonly used in ${material.category || '3D printing'} workflows.`,
    uses ? `It is often chosen for ${uses}.` : '',
    avoid ? `It is less suitable for ${avoid}.` : '',
    `Suggested ratings: strength ${ratings.strength}/5, flexibility ${ratings.flexibility}/5, heat resistance ${ratings.heatResistance}/5, detail ${ratings.detail}/5, outdoor use ${ratings.outdoorUse}/5.`,
  ];
  return parts.filter(Boolean).join(' ');
}

function inferShortDescription(material) {
  if (material.shortDescription || material.description_short) return material.shortDescription || material.description_short;
  const uses = (material.ideal_for || []).slice(0, 2).join(', ');
  return uses
    ? `Commonly used for ${uses}.`
    : `A ${material.category || '3D printing'} material for configurable quoting.`;
}

export function enrichMaterialSuggestion(material) {
  if (!material) return null;
  const ratings = {
    strength: clampRating(material.ratings?.strength ?? material.strength),
    flexibility: clampRating(material.ratings?.flexibility ?? material.flexibility),
    heatResistance: clampRating(material.ratings?.heatResistance ?? material.heat),
    detail: inferDetailRating(material),
    outdoorUse: inferOutdoorRating(material),
  };
  const tags = inferTags(material, ratings);
  const bestFor = Array.isArray(material.best_for) && material.best_for.length
    ? material.best_for
    : (material.ideal_for || []).slice(0, 3);

  return {
    ...material,
    ratings,
    detail: ratings.detail,
    outdoorUse: ratings.outdoorUse,
    tags,
    best_for: bestFor,
    specs: inferSpecs(material, ratings),
    shortDescription: inferShortDescription(material),
    longDescription: inferDescription(material, ratings),
    learn_more: material.learn_more || inferDescription(material, ratings),
  };
}
