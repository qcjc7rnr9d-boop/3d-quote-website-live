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

export const MATERIAL_LIBRARY = [
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
    key: 'nylon', displayName: 'Nylon (PA6 / PA12)', category: 'FDM',
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
    aliases: ['dental resin', 'biocompatible resin', 'model resin', 'orthodontic resin'],
    strength: 55, flexibility: 18, heat: 50,
    production_days_min: 1, production_days_max: 2,
    ideal_for: [
      'Dental & orthodontic models',
      'Splints, guides & surgical jigs',
      'Biocompatible medical prototypes',
    ],
    not_for: [
      'Anything outside medical/dental scope',
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

/**
 * Find the best library entry matching a free-form material name.
 * Strategy (in order):
 *   1. Exact match on displayName / alias (case-insensitive, trimmed)
 *   2. Token match — longest library displayName/alias contained in the input
 *   3. Returns null if nothing usefully matches
 */
export function findMaterialMatch(name) {
  if (!name || typeof name !== 'string') return null;
  const norm = name.toLowerCase().trim();
  if (!norm) return null;

  // 1. Exact displayName match
  for (const m of MATERIAL_LIBRARY) {
    if (m.displayName.toLowerCase() === norm) return m;
  }
  // 1b. Exact alias match
  for (const m of MATERIAL_LIBRARY) {
    if (m.aliases.some(a => a.toLowerCase() === norm)) return m;
  }
  // 2. Substring match — pick the library entry with the LONGEST matching key
  let best = null, bestLen = 0;
  for (const m of MATERIAL_LIBRARY) {
    const candidates = [m.displayName.toLowerCase(), ...m.aliases.map(a => a.toLowerCase())];
    for (const c of candidates) {
      // c must be at least 3 chars to avoid silly matches like "pp" inside "happy"
      if (c.length < 3) continue;
      // Word-boundary-ish: match c as a substring within norm
      if (norm.includes(c) && c.length > bestLen) {
        best = m; bestLen = c.length;
      }
    }
  }
  return best;
}
