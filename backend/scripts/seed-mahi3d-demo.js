import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config.js';
import { MATERIAL_LIBRARY, enrichMaterialSuggestion } from '../lib/material-library.js';
import { getDefaultMaterialImage } from '../lib/material-default-images.js';
import { DEMO_SHOP_SLUG, LEGACY_DEMO_SHOP_SLUG } from '../lib/shop-lookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const defaultDbPath = join(backendDir, 'data', 'rfdewi.db');
const backupDir = join(backendDir, 'data', 'demo-backups');

export { DEMO_SHOP_SLUG };
export const DEMO_LEGACY_SHOP_SLUG = LEGACY_DEMO_SHOP_SLUG;
export const DEMO_OWNER_EMAIL = 'owner@trennen-demo.test';
export const DEMO_OWNER_PASSWORD = 'TrennenAdmin!2026';
export const DEMO_CUSTOMER_EMAIL = 'alex@trennen-demo.test';
export const DEMO_CUSTOMER_PASSWORD = 'TrennenCustomer!2026';
export const DEMO_CUSTOMER_NAME = 'Alex Morgan';

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function toSqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function materialId(materials, key) {
  const material = materials[key];
  if (!material?.id) {
    throw new Error(`Missing active Trennen demo material: ${key}`);
  }
  return material.id;
}

function orderTotal(subtotal, tax, shipping) {
  return roundMoney(subtotal + tax + shipping);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value);
}

function stableId(prefix, value, index = 0) {
  const slug = String(value || `${prefix}-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${prefix}_${slug || index + 1}`;
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function buildDemoColours(material) {
  const text = `${material.key} ${material.displayName} ${material.category} ${(material.tags || []).join(' ')}`.toLowerCase();
  let colours;

  if (material.category === 'Resin') {
    colours = [
      ['Grey', '#9ca3af'],
      ['White', '#f8fafc'],
      ['Clear / Translucent', '#dbeafe'],
      ['Black', '#111827'],
    ];
  } else if (material.category === 'SLS') {
    colours = [
      ['White / Natural', '#f5f1e8'],
      ['Black', '#111827'],
      ['Grey', '#9ca3af'],
    ];
  } else if (hasAny(text, [/support/, /pva/, /bvoh/, /hips/])) {
    colours = [
      ['Natural', '#f3ead7'],
      ['White', '#f8fafc'],
      ['Black', '#111827'],
    ];
  } else if (hasAny(text, [/wood/])) {
    colours = [
      ['Natural Wood', '#b98b58'],
      ['Dark Wood', '#6f4e37'],
    ];
  } else if (hasAny(text, [/marble|stone/])) {
    colours = [
      ['Marble White', '#f3f4f6'],
      ['Stone Grey', '#9ca3af'],
      ['Black', '#111827'],
    ];
  } else if (hasAny(text, [/metal|tungsten|magnetite|conductive/])) {
    colours = [
      ['Graphite', '#374151'],
      ['Black', '#111827'],
      ['Bronze', '#8a5a2b'],
    ];
  } else if (hasAny(text, [/nylon|pa6|pa11|pa12|paht|ppa/])) {
    colours = [
      ['White / Natural', '#f5f1e8'],
      ['Black', '#111827'],
      ['Grey', '#9ca3af'],
    ];
  } else if (hasAny(text, [/tpu|tpe|tpc|peba|flexible/])) {
    colours = [
      ['Black', '#111827'],
      ['White', '#f8fafc'],
      ['Grey', '#9ca3af'],
      ['Blue', '#2563eb'],
      ['Red', '#dc2626'],
    ];
  } else {
    colours = [
      ['Black', '#111827'],
      ['White', '#f8fafc'],
      ['Grey', '#9ca3af'],
      ['Blue', '#2563eb'],
      ['Red', '#dc2626'],
      ['Green', '#15803d'],
    ];
  }

  return colours.map(([name, hex], index) => ({
    id: stableId('colour', name, index),
    name,
    hex,
    textureUrl: null,
    enabled: true,
    sortOrder: index,
  }));
}

function buildDemoFinishes(material) {
  const text = `${material.key} ${material.displayName} ${material.category} ${(material.tags || []).join(' ')}`.toLowerCase();
  const isResin = material.category === 'Resin';
  const isSls = material.category === 'SLS';
  const isFlexible = hasAny(text, [/tpu|tpe|tpc|peba|flexible/]);
  const isSupport = hasAny(text, [/support|pva|bvoh|hips/]);

  const presets = isResin
    ? [
      ['Draft', '0.10 mm', 'Fast resin quote preview with visible layer stepping', 0.92, 'standard'],
      ['Standard', '0.05 mm', 'Balanced detail for resin quote previews', 1, 'fine'],
      ['Balanced', '0.04 mm', 'Cleaner detail for general resin parts', 1.08, 'fine'],
      ['Fine', '0.03 mm', 'Finer layers for small visual features', 1.18, 'fine'],
      ['Extra fine', '0.025 mm', 'Higher-detail resin showcase preset', 1.28, 'fine'],
      ['Smooth', '0.02 mm', 'Smoother visible layer finish for display parts', 1.4, 'fine'],
      ['High detail', '0.015 mm', 'Detailed demo preset for intricate features', 1.58, 'fine'],
      ['Presentation', '0.01 mm', 'Highest-detail demo preset for presentation models', 1.8, 'fine'],
    ]
    : isSls
      ? [
        ['Draft', '0.15 mm', 'Coarser powder-process demo setting', 0.95, 'standard'],
        ['Standard', '0.10 mm', 'Balanced powder-process surface setting', 1, 'standard'],
        ['Balanced', '0.10 mm', 'General-use powder-process quote preset', 1.06, 'standard'],
        ['Fine', '0.08 mm', 'Finer powder-process quote preset where supported', 1.15, 'fine'],
        ['Smoothed', '0.10 mm', 'Optional smoother post-process style', 1.2, 'fine'],
        ['Dyed finish', '0.10 mm', 'Demo dyed-finish quote preset', 1.28, 'fine'],
        ['Sealed finish', '0.10 mm', 'Demo sealed-surface quote preset', 1.36, 'fine'],
        ['Presentation', '0.08 mm', 'Higher-effort demo finish for presentation parts', 1.5, 'fine'],
      ]
      : isSupport
        ? [
          ['Draft', '0.28 mm', 'Quick support-material quote preview', 0.95, 'standard'],
          ['Standard', '0.20 mm', 'Support-material setup for quote previews', 1, 'standard'],
          ['Balanced', '0.18 mm', 'Balanced support-material demo preset', 1.06, 'standard'],
          ['Fine', '0.16 mm', 'Cleaner support interfaces where useful', 1.12, 'fine'],
          ['Interface fine', '0.14 mm', 'Finer support-contact quote preset', 1.18, 'fine'],
          ['Dense interface', '0.12 mm', 'Denser support-contact demo preset', 1.26, 'fine'],
          ['High support', '0.10 mm', 'Higher-detail support-material quote preset', 1.38, 'fine'],
          ['Presentation', '0.08 mm', 'Demo stress-test preset for support workflows', 1.5, 'fine'],
        ]
        : isFlexible
          ? [
            ['Draft', '0.28 mm', 'Faster flexible-part setup with more visible layers', 0.95, 'standard'],
            ['Standard', '0.20 mm', 'Balanced flexible-part setup', 1, 'standard'],
            ['Balanced', '0.18 mm', 'Cleaner flexible-part quote preset', 1.08, 'standard'],
            ['Fine', '0.16 mm', 'Smaller layers for cleaner flexible surfaces', 1.16, 'fine'],
            ['Extra fine', '0.14 mm', 'Higher-detail flexible-part demo preset', 1.26, 'fine'],
            ['Smooth', '0.12 mm', 'Smoother flexible surface where supported', 1.38, 'fine'],
            ['High detail', '0.10 mm', 'Fine flexible-part detail preset', 1.5, 'fine'],
            ['Presentation', '0.08 mm', 'Highest-detail flexible demo preset', 1.68, 'fine'],
          ]
          : [
            ['Draft', '0.28 mm', 'Faster, lower-cost quote preview', 0.9, 'standard'],
            ['Standard', '0.20 mm', 'Balanced speed and surface finish', 1, 'standard'],
            ['Balanced', '0.16 mm', 'Cleaner surface with moderate cost', 1.1, 'standard'],
            ['Fine', '0.12 mm', 'Better detail with a smoother surface', 1.18, 'fine'],
            ['Extra fine', '0.10 mm', 'Sharper details for smaller features', 1.28, 'fine'],
            ['Smooth', '0.08 mm', 'Smoother visible layer finish', 1.42, 'fine'],
            ['High detail', '0.06 mm', 'Detailed demo preset for intricate parts', 1.6, 'fine'],
            ['Presentation', '0.04 mm', 'Highest-detail demo preset for display models', 1.85, 'fine'],
          ];

  return presets.map(([name, layerHeight, description, priceMultiplier, previewType], index) => ({
    id: stableId('finish', name, index),
    name,
    layerHeight,
    description,
    priceMultiplier,
    previewType,
    previewImageUrl: null,
    enabled: true,
    default: index === 0,
    sortOrder: index,
  }));
}

function buildDemoPricing(material) {
  const text = `${material.key} ${material.displayName} ${material.category} ${(material.tags || []).join(' ')}`.toLowerCase();
  if (material.category === 'SLS') return { base_price: 0.65, min_charge: 20 };
  if (material.category === 'Resin') return { base_price: 0.42, min_charge: 10 };
  if (hasAny(text, [/peek|pekk|pei|ultem|pps|ppsu|psu|pvdf/])) return { base_price: 1.35, min_charge: 25 };
  if (hasAny(text, [/tungsten|magnetite/])) return { base_price: 0.85, min_charge: 18 };
  if (hasAny(text, [/ppa|paht|pa6_cf|pa6_gf|pa11_cf|pa12_cf|pc_cf|pps_cf/])) return { base_price: 0.68, min_charge: 14 };
  if (hasAny(text, [/carbon|glass|cf|gf/])) return { base_price: 0.48, min_charge: 10 };
  if (hasAny(text, [/tpu|tpe|tpc|peba|flexible/])) return { base_price: 0.36, min_charge: 8 };
  if (hasAny(text, [/nylon|pa6|pa11|pa12|copa|pc|abs|asa|pp|pom|pmma|pctg|cpe|pet/])) return { base_price: 0.28, min_charge: 6 };
  if (hasAny(text, [/support|pva|bvoh|hips/])) return { base_price: 0.24, min_charge: 6 };
  if (hasAny(text, [/silk|wood|metal|marble|stone|glow|conductive|pvb/])) return { base_price: 0.26, min_charge: 6 };
  return { base_price: 0.2, min_charge: 4.5 };
}

function buildDemoMaterialRecord(material, index, existing = null) {
  const enriched = enrichMaterialSuggestion(material);
  const defaultImage = getDefaultMaterialImage(enriched.key);
  const hasCustomImage = Boolean(existing?.image_url && existing.image_url !== defaultImage?.image_url);
  const pricing = buildDemoPricing(enriched);
  const ratingsPercent = {
    strength: Number(material.strength ?? enriched.strength ?? 60),
    flexibility: Number(material.flexibility ?? enriched.flexibility ?? 60),
    heatResistance: Number(material.heat ?? enriched.heat ?? 60),
    detail: Number(enriched.detail ?? 3) * 20,
    outdoorUse: Number(enriched.outdoorUse ?? 3) * 20,
  };
  const specs = [
    ...(Array.isArray(enriched.specs) ? enriched.specs : []),
    {
      label: 'Demo data note',
      value: 'Practical quoting defaults. Review against the exact material brand before publishing.',
    },
  ];

  return {
    name: enriched.displayName,
    description_short: enriched.shortDescription,
    description_long: enriched.longDescription,
    category: enriched.category || 'FDM',
    colours: json(buildDemoColours(enriched)),
    finishes: json(buildDemoFinishes(enriched)),
    image_url: existing?.image_url || defaultImage?.image_url || null,
    image_alt: hasCustomImage
      ? (existing?.image_alt || `Example ${enriched.displayName} printed part`)
      : (defaultImage?.image_alt || existing?.image_alt || `Example ${enriched.displayName} printed part`),
    price_unit: 'per cm³',
    recommended: ['pla', 'petg', 'asa', 'tpu', 'tpu_95a', 'tpu_ams', 'pa12', 'nylon'].includes(enriched.key) ? 1 : 0,
    tags: json([...new Set([enriched.category, ...(enriched.tags || [])].filter(Boolean))]),
    best_for: json(enriched.best_for || enriched.ideal_for || []),
    specs: json(specs),
    pricing_model: 'per_cm3',
    base_price: pricing.base_price,
    min_charge: pricing.min_charge,
    volume_tiers: json([]),
    properties: json({
      libraryKey: enriched.key,
      librarySource: 'curated-material-library',
      ratings: ratingsPercent,
      strength: ratingsPercent.strength,
      flexibility: ratingsPercent.flexibility,
      heat: ratingsPercent.heatResistance,
      detail: ratingsPercent.detail,
      outdoorUse: ratingsPercent.outdoorUse,
      idealFor: enriched.ideal_for || enriched.best_for || [],
      notFor: enriched.not_for || [],
      learnMore: enriched.learn_more,
      dataNote: 'Practical demo defaults, not certified datasheet values.',
    }),
    active: 1,
    stock_status: 'in_stock',
    sort_order: index * 10,
    production_days_min: enriched.production_days_min || null,
    production_days_max: enriched.production_days_max || null,
    min_x_mm: null,
    min_y_mm: null,
    min_z_mm: null,
    max_x_mm: null,
    max_y_mm: null,
    max_z_mm: null,
  };
}

export function assertDemoSeedAllowed({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data while NODE_ENV=production.');
  }
  const allowed = env.ALLOW_TRENNEN_DEMO_SEED === '1'
    || env.ALLOW_MAHI3D_DEMO_SEED === '1'
    || argv.includes('--yes');
  if (!allowed) {
    throw new Error('Set ALLOW_TRENNEN_DEMO_SEED=1 or pass --yes to seed local demo data.');
  }
}

export function buildDemoShippingZones() {
  return [
    {
      id: 'demo-pickup',
      courier: 'Trennen',
      service: 'Local pickup',
      price: 0,
      recommended: false,
      active: true,
    },
    {
      id: 'demo-standard-tracked',
      courier: 'Demo Courier',
      service: 'Standard tracked',
      price: 8.5,
      recommended: true,
      active: true,
    },
    {
      id: 'demo-express-tracked',
      courier: 'Demo Courier',
      service: 'Express tracked',
      price: 14.9,
      recommended: false,
      active: true,
    },
  ];
}

export function buildDemoOrders(materials, { now = new Date() } = {}) {
  void now;
  const orders = [
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Drone Camera Mount.stl',
      material_id: materialId(materials, 'PETG'),
      colour: 'Black',
      finish: 'Smooth — 0.12 mm layer height',
      quantity: 1,
      subtotal: 62.4,
      tax: 9.36,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_trennen_drone_mount',
      fulfilment_status: 'complete',
      payment_status: 'paid',
      tracking_number: 'TRN-DEMO-1001',
      tracking_url: 'https://example.com/tracking/TRN-DEMO-1001',
      customer_message: 'Your mount has been completed and is ready in the demo tracking view.',
      notes: 'Demo order. Dimensions: 118.4 × 65.2 × 42.0 mm. Volume: 34.6 cm³. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(27)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Desk Cable Clips.obj',
      material_id: materialId(materials, 'PLA'),
      colour: 'White',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 12,
      subtotal: 38.4,
      tax: 5.76,
      shipping: 0,
      stripe_payment_id: 'pi_demo_trennen_cable_clips',
      fulfilment_status: 'complete',
      payment_status: 'paid',
      tracking_number: 'TRN-DEMO-1002',
      tracking_url: 'https://example.com/tracking/TRN-DEMO-1002',
      customer_message: 'Your cable clips have been completed for the demo customer portal.',
      notes: 'Demo order. Batch of 12 small clips. Dimensions: 32.0 × 18.0 × 9.5 mm each. Shipping: Local pickup.',
      created_at: toSqlDatetime(daysAgo(19)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Outdoor Sensor Housing.stl',
      material_id: materialId(materials, 'ASA'),
      colour: 'Grey',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 2,
      subtotal: 145,
      tax: 21.75,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_trennen_sensor_housing',
      fulfilment_status: 'shipped',
      payment_status: 'paid',
      tracking_number: 'TRN-DEMO-1003',
      tracking_url: 'https://example.com/tracking/TRN-DEMO-1003',
      customer_message: 'Your demo tracking details are attached to this order.',
      notes: 'Demo order. Two-part enclosure. Dimensions: 142.0 × 88.0 × 54.5 mm. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(9)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Flexible Grip Sleeve.stl',
      material_id: materialId(materials, 'TPU'),
      colour: 'Black',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 4,
      subtotal: 72,
      tax: 10.8,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_trennen_grip_sleeve',
      fulfilment_status: 'in_production',
      payment_status: 'paid',
      tracking_number: null,
      tracking_url: null,
      customer_message: null,
      notes: 'Demo order. Flexible grip sleeves. Dimensions: 76.0 × 34.0 × 21.0 mm each. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(4)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Nylon Gear Prototype.stl',
      material_id: materialId(materials, 'Nylon'),
      colour: 'White / Natural',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 1,
      subtotal: 126.6,
      tax: 18.99,
      shipping: 14.9,
      stripe_payment_id: 'pi_demo_trennen_nylon_gear',
      fulfilment_status: 'processing',
      payment_status: 'paid',
      tracking_number: null,
      tracking_url: null,
      customer_message: null,
      notes: 'Demo order. Mechanical gear prototype. Dimensions: 86.0 × 86.0 × 18.5 mm. Shipping: Express tracked.',
      created_at: toSqlDatetime(daysAgo(1)),
    },
  ];

  return orders.map(order => ({
    ...order,
    total: orderTotal(order.subtotal, order.tax, order.shipping),
  }));
}

function getRows(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function backupExistingDemoData(db, shop) {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `trennen-demo-backup-${stamp}.json`);
  const backup = {
    created_at: new Date().toISOString(),
    shop: db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id),
    store_settings: db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shop.id) || null,
    materials: getRows(db, 'SELECT * FROM materials WHERE shop_id = ? ORDER BY sort_order, id', shop.id),
    customer_accounts: getRows(db, 'SELECT * FROM customer_accounts WHERE shop_id = ? ORDER BY id', shop.id),
    customers: getRows(db, 'SELECT * FROM customers WHERE shop_id = ? ORDER BY id', shop.id),
    orders: getRows(db, 'SELECT * FROM orders WHERE shop_id = ? ORDER BY id', shop.id),
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  return backupPath;
}

function materialTableColumns(db) {
  return new Set(db.prepare('PRAGMA table_info(materials)').all().map(col => col.name));
}

function insertMaterialRecord(db, shopId, record, columns) {
  const values = { shop_id: shopId, ...record };
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  const names = entries.map(([key]) => key);
  const placeholders = names.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO materials (${names.join(', ')})
    VALUES (${placeholders})
  `).run(...entries.map(([, value]) => value));
}

function updateMaterialRecord(db, existingId, record, columns) {
  const entries = Object.entries(record)
    .filter(([key]) => columns.has(key))
    .filter(([key]) => key !== 'shop_id' && key !== 'created_at');
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db.prepare(`
    UPDATE materials
    SET ${assignments}
    WHERE id = ?
  `).run(...entries.map(([, value]) => value), existingId);
}

function materialLibraryKeyFromRow(row) {
  const properties = parseJson(row.properties, {});
  return properties?.libraryKey || properties?.library_key || null;
}

export function syncDemoMaterials(db, shopId) {
  const columns = materialTableColumns(db);
  const existingRows = db.prepare(`
    SELECT *
    FROM materials
    WHERE shop_id = ?
    ORDER BY sort_order, id
  `).all(shopId);

  const byKey = new Map();
  const byName = new Map();
  for (const row of existingRows) {
    const key = materialLibraryKeyFromRow(row);
    if (key && !byKey.has(key)) byKey.set(key, row);
    byName.set(String(row.name || '').trim().toLowerCase(), row);
  }

  const touched = new Set();
  MATERIAL_LIBRARY.forEach((material, index) => {
    const nameKey = String(material.displayName || '').trim().toLowerCase();
    const existing = byKey.get(material.key) || byName.get(nameKey) || null;
    const record = buildDemoMaterialRecord(material, index, existing);
    if (existing) {
      updateMaterialRecord(db, existing.id, record, columns);
      touched.add(existing.id);
    } else {
      insertMaterialRecord(db, shopId, record, columns);
    }
  });

  for (const row of existingRows) {
    if (touched.has(row.id)) continue;
    db.prepare('UPDATE materials SET active = 0, sort_order = ? WHERE id = ?')
      .run(100000 + Number(row.id), row.id);
  }

  return MATERIAL_LIBRARY.length;
}

function loadRequiredMaterials(db, shopId) {
  const rows = db.prepare(`
    SELECT id, name, properties
    FROM materials
    WHERE shop_id = ? AND active = 1
    ORDER BY sort_order, id
  `).all(shopId);

  const byKey = new Map();
  for (const row of rows) {
    const key = materialLibraryKeyFromRow(row);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  const find = (label) => rows.find(row => row.name.toLowerCase() === label.toLowerCase())
    || rows.find(row => row.name.toLowerCase().includes(label.toLowerCase()));
  const findKey = (...keys) => keys.map(key => byKey.get(key)).find(Boolean);

  const materials = {
    PLA: findKey('pla') || find('PLA'),
    PETG: findKey('petg') || find('PETG'),
    ASA: findKey('asa') || find('ASA'),
    TPU: findKey('tpu') || find('TPU'),
    Nylon: findKey('nylon') || find('Nylon'),
  };

  for (const key of Object.keys(materials)) materialId(materials, key);
  return materials;
}

function resetShopDemoData(db, shopId) {
  db.prepare('DELETE FROM orders WHERE shop_id = ?').run(shopId);
  db.prepare('DELETE FROM customers WHERE shop_id = ?').run(shopId);
  db.prepare('DELETE FROM customer_accounts WHERE shop_id = ?').run(shopId);
}

function upsertStoreSettings(db, shopId) {
  db.prepare(`
    INSERT INTO store_settings (
      shop_id, tagline, about, phone, address, shipping_zones,
      support_email_mode, support_email, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(shop_id) DO UPDATE SET
      tagline = excluded.tagline,
      about = excluded.about,
      phone = excluded.phone,
      address = excluded.address,
      shipping_zones = excluded.shipping_zones,
      support_email_mode = excluded.support_email_mode,
      support_email = excluded.support_email,
      updated_at = datetime('now')
  `).run(
    shopId,
    'Instant quotes for practical 3D printed parts.',
    'Trennen is configured as a demo store for showing the quoting, checkout, order tracking, and customer portal flow.',
    '+64 9 887 0000',
    '12 Workshop Lane, Auckland 1010',
    JSON.stringify(buildDemoShippingZones()),
    'custom',
    'support@trennen.co.nz'
  );
}

function insertDemoCustomer(db, shopId, passwordHash) {
  db.prepare(`
    INSERT INTO customer_accounts (
      shop_id, email, name, password_hash, email_verified, email_verified_at, created_at
    )
    VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
  `).run(shopId, DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_NAME, passwordHash);

  db.prepare(`
    INSERT INTO customers (shop_id, email, name, notes, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(
    shopId,
    DEMO_CUSTOMER_EMAIL,
    DEMO_CUSTOMER_NAME,
    'Demo customer account for live client walkthroughs.'
  );
}

function insertDemoOrders(db, shopId, materials) {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('public_token')) {
    db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token
      ON orders(public_token)
      WHERE public_token IS NOT NULL
  `);
  const insert = db.prepare(`
    INSERT INTO orders (
      shop_id, customer_email, customer_name, file_name, material_id,
      colour, finish, quantity, subtotal, tax, shipping, total,
      stripe_payment_id, fulfilment_status, payment_status, notes,
      created_at, tracking_number, tracking_url, customer_message, public_token
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const orders = buildDemoOrders(materials);
  for (const order of orders) {
    insert.run(
      shopId,
      order.customer_email,
      order.customer_name,
      order.file_name,
      order.material_id,
      order.colour,
      order.finish,
      order.quantity,
      order.subtotal,
      order.tax,
      order.shipping,
      order.total,
      order.stripe_payment_id,
      order.fulfilment_status,
      order.payment_status,
      order.notes,
      order.created_at,
      order.tracking_number,
      order.tracking_url,
      order.customer_message,
      randomBytes(24).toString('base64url')
    );
  }
}

function findDemoShop(db) {
  const canonical = db.prepare('SELECT * FROM shops WHERE slug = ?').get(DEMO_SHOP_SLUG);
  if (canonical) return canonical;
  return db.prepare('SELECT * FROM shops WHERE slug = ?').get(LEGACY_DEMO_SHOP_SLUG) || null;
}

export async function seedMahi3dDemo({ dbPath = defaultDbPath } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    const shop = findDemoShop(db);
    if (!shop) throw new Error(`Shop "${DEMO_SHOP_SLUG}" was not found.`);

    const ownerHash = await bcrypt.hash(DEMO_OWNER_PASSWORD, BCRYPT_ROUNDS);
    const customerHash = await bcrypt.hash(DEMO_CUSTOMER_PASSWORD, BCRYPT_ROUNDS);
    const backupPath = backupExistingDemoData(db, shop);
    let materialCount = 0;

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE shops SET
          name = ?,
          slug = ?,
          email = ?,
          password_hash = ?,
          is_temp_password = 0,
          plan = 'starter',
          stripe_account_id = NULL,
          stripe_secret_key = NULL,
          stripe_client_id = NULL,
          stripe_publishable_key = NULL,
          stripe_charges_enabled = 0,
          stripe_payouts_enabled = 0,
          stripe_details_submitted = 0,
          billing_status = 'active',
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run('Trennen', DEMO_SHOP_SLUG, DEMO_OWNER_EMAIL, ownerHash, shop.id);

      materialCount = syncDemoMaterials(db, shop.id);
      const materials = loadRequiredMaterials(db, shop.id);
      resetShopDemoData(db, shop.id);
      upsertStoreSettings(db, shop.id);
      insertDemoCustomer(db, shop.id, customerHash);
      insertDemoOrders(db, shop.id, materials);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const metrics = db.prepare(`
      SELECT
        COUNT(*) as order_count,
        SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END) as paid_total,
        SUM(CASE WHEN fulfilment_status = 'complete' THEN 1 ELSE 0 END) as delivered_count,
        SUM(CASE WHEN fulfilment_status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) as active_count
      FROM orders
      WHERE shop_id = ?
    `).get(shop.id);

    return {
      ok: true,
      backupPath,
      shopSlug: DEMO_SHOP_SLUG,
      ownerEmail: DEMO_OWNER_EMAIL,
      ownerPassword: DEMO_OWNER_PASSWORD,
      customerEmail: DEMO_CUSTOMER_EMAIL,
      customerPassword: DEMO_CUSTOMER_PASSWORD,
      materialCount,
      orderCount: metrics.order_count || 0,
      deliveredCount: metrics.delivered_count || 0,
      activeCount: metrics.active_count || 0,
      paidTotal: roundMoney(metrics.paid_total || 0),
    };
  } finally {
    db.close();
  }
}

export const seedTrennenDemo = seedMahi3dDemo;

async function main() {
  assertDemoSeedAllowed();
  const result = await seedMahi3dDemo();
  console.log('Trennen demo seed complete.');
  console.log(`Backup: ${result.backupPath}`);
  console.log(`Shop admin: ${result.ownerEmail} / ${result.ownerPassword}`);
  console.log(`Customer: ${result.customerEmail} / ${result.customerPassword}`);
  console.log(`Materials: ${result.materialCount}`);
  console.log(`Orders: ${result.orderCount} (${result.deliveredCount} delivered, ${result.activeCount} active)`);
  console.log(`Paid total: $${result.paidTotal.toFixed(2)} NZD`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
