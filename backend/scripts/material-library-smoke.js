import {
  MATERIAL_LIBRARY,
  enrichMaterialSuggestion,
  findMaterialMatch,
} from '../lib/material-library.js';

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`✕ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function expect(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

const fdmMaterials = MATERIAL_LIBRARY.filter(material => material.category === 'FDM');
expect(fdmMaterials.length >= 50, `FDM library has ${fdmMaterials.length} profiles`);

const requiredQueries = new Map([
  ['Silk PLA', 'pla_silk'],
  ['Tough PLA', 'tough_pla'],
  ['PETG-CF', 'petg_cf'],
  ['TPU 85A', 'tpu_85a'],
  ['85A TPU', 'tpu_85a'],
  ['soft 85A TPU', 'tpu_85a'],
  ['TPU 90A', 'tpu_90a'],
  ['TPU 83A', 'tpu_83a'],
  ['83A TPU', 'tpu_83a'],
  ['95A TPU', 'tpu_95a'],
  ['TPU 75A', 'tpu_75a'],
  ['PEBA', 'peba'],
  ['Super TPU', 'peba'],
  ['Pebax-like flexible', 'peba'],
  ['PEBA-CF', 'peba_cf'],
  ['TPU for AMS', 'tpu_ams'],
  ['Bambu TPU for AMS', 'tpu_ams'],
  ['AMS TPU', 'tpu_ams'],
  ['PA6-CF', 'pa6_cf'],
  ['CPE+', 'cpe_plus'],
  ['Breakaway Support', 'breakaway_support'],
]);

for (const [query, expectedKey] of requiredQueries) {
  const match = findMaterialMatch(query);
  expect(match?.key === expectedKey, `${query} resolves to ${expectedKey}`);
}

for (const material of fdmMaterials) {
  const enriched = enrichMaterialSuggestion(material);
  const missing = [];
  if (!material.key) missing.push('key');
  if (!material.displayName) missing.push('displayName');
  if (!Array.isArray(material.aliases) || material.aliases.length === 0) missing.push('aliases');
  if (!Array.isArray(enriched.tags) || enriched.tags.length === 0) missing.push('tags');
  if (!Array.isArray(enriched.best_for) || enriched.best_for.length === 0) missing.push('best_for');
  if (!Array.isArray(enriched.specs) || enriched.specs.length === 0) missing.push('specs');
  if (!enriched.learn_more) missing.push('learn_more');
  for (const key of ['strength', 'flexibility', 'heatResistance', 'detail', 'outdoorUse']) {
    if (!Number.isFinite(Number(enriched.ratings?.[key]))) missing.push(`ratings.${key}`);
  }
  if (missing.length) fail(`${material.key} missing ${missing.join(', ')}`);
}

if (!failures) {
  pass('All FDM profiles include editable suggestion data');
  console.log('Material library smoke checks passed.');
} else {
  process.exitCode = 1;
}
