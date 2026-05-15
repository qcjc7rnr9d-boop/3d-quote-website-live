import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const helperPath = join(import.meta.dirname, '..', '..', 'assets', 'material-filtering.js');
const code = readFileSync(helperPath, 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: helperPath });

const api = sandbox.window.TrennenMaterialFilters;
if (!api?.sortMaterialsForFilter) {
  throw new Error('assets/material-filtering.js must expose window.TrennenMaterialFilters.sortMaterialsForFilter');
}

const materials = [
  { name: 'PETG', category: 'FDM', tags: ['Outdoor'], ratings: { outdoorUse: 80, heatResistance: 60, strength: 75 } },
  { name: 'Nylon PA6', category: 'FDM', tags: ['Outdoor', 'Engineering'], ratings: { outdoorUse: 80, heatResistance: 78, strength: 88 } },
  { name: 'ASA-GF', category: 'FDM', tags: ['Outdoor', 'Engineering'], ratings: { outdoorUse: 100, heatResistance: 83, strength: 80 } },
  { name: 'ASA', category: 'FDM', tags: ['Outdoor', 'Engineering'], ratings: { outdoorUse: 100, heatResistance: 80, strength: 72 } },
  { name: 'ASA-CF', category: 'FDM', tags: ['Outdoor', 'Engineering'], ratings: { outdoorUse: 100, heatResistance: 84, strength: 82 } },
  { name: 'PLA', category: 'FDM', tags: ['Low cost'], ratings: { outdoorUse: 40, heatResistance: 30, strength: 62 } },
];

const filtered = materials.filter(material => api.materialMatchesFilter(material, 'tag:outdoor'));
const ranked = api.sortMaterialsForFilter(filtered, 'tag:outdoor').map(material => material.name);

if (ranked[0] !== 'ASA') {
  throw new Error(`Outdoor filter should rank plain ASA first. Got: ${ranked.join(', ')}`);
}

const expectedFirst = ['ASA', 'ASA-CF', 'ASA-GF'];
for (const name of expectedFirst) {
  if (!ranked.slice(0, 3).includes(name)) {
    throw new Error(`Outdoor filter should rank ASA family first. Got: ${ranked.join(', ')}`);
  }
}

if (ranked.includes('PLA')) {
  throw new Error(`Outdoor filter should not include PLA. Got: ${ranked.join(', ')}`);
}

console.log(`Outdoor filter ranking smoke passed: ${ranked.join(', ')}`);
