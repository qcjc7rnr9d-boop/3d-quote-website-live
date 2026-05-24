import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { MATERIAL_LIBRARY } from '../lib/material-library.js';
import { DEMO_SHOP_SLUG } from './seed-mahi3d-demo.js';

const FDM_LIBRARY = MATERIAL_LIBRARY.filter(material => material.category === 'FDM');

const db = new DatabaseSync(join(import.meta.dirname, '..', 'data', 'rfdewi.db'));

let failures = 0;

function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`✕ ${message}`);
    return;
  }
  console.log(`✓ ${message}`);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

try {
  const shop = db.prepare('SELECT id FROM shops WHERE slug = ?').get(DEMO_SHOP_SLUG);
  expect(Boolean(shop), 'Mahi3D shop exists');

  if (shop) {
    const rows = db.prepare(`
      SELECT id, name, category, active, properties, colours, finishes, tags, best_for, specs
      FROM materials
      WHERE shop_id = ?
      ORDER BY sort_order, id
    `).all(shop.id);

    const activeRows = rows.filter(row => row.active === 1);
    const byLibraryKey = new Map();
    for (const row of activeRows) {
      const properties = parseJson(row.properties, {});
      if (properties.libraryKey) byLibraryKey.set(properties.libraryKey, row);
    }

    expect(activeRows.length === FDM_LIBRARY.length, `Mahi3D has ${FDM_LIBRARY.length} enabled FDM library materials`);
    expect(activeRows.every(row => row.category === 'FDM'), 'each enabled demo material is FDM');
    expect(byLibraryKey.size === FDM_LIBRARY.length, 'each enabled demo FDM material has a stable library key');

    for (const material of FDM_LIBRARY) {
      const row = byLibraryKey.get(material.key);
      expect(Boolean(row), `Mahi3D demo includes ${material.displayName}`);
      if (!row) continue;
      expect(Array.isArray(parseJson(row.colours, [])) && parseJson(row.colours, []).length > 0, `${row.name} has colours`);
      const finishes = parseJson(row.finishes, []);
      expect(Array.isArray(finishes) && finishes.length >= 8, `${row.name} has at least 8 demo finish presets`);
      expect(finishes.filter(finish => finish?.enabled !== false).length >= 8, `${row.name} has 8 enabled finish presets`);
      expect(Array.isArray(parseJson(row.tags, [])) && parseJson(row.tags, []).length > 0, `${row.name} has filter tags`);
      expect(Array.isArray(parseJson(row.best_for, [])) && parseJson(row.best_for, []).length > 0, `${row.name} has best-for labels`);
      expect(Array.isArray(parseJson(row.specs, [])) && parseJson(row.specs, []).length > 0, `${row.name} has specs`);
    }

    for (const key of ['tpu_83a', 'tpu_80a', 'tpu_75a', 'peba', 'peba_cf', 'petg_v0', 'recycled_pla']) {
      expect(byLibraryKey.has(key), `showcase material ${key} is published`);
    }
    for (const key of ['resin_standard', 'sls_pa12']) {
      expect(!byLibraryKey.has(key), `non-FDM material ${key} is not published`);
    }
  }
} finally {
  db.close();
}

if (failures) process.exit(1);
console.log('Mahi3D demo material range smoke checks passed.');
