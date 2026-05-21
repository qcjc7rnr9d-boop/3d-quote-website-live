import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/rfdewi.db');
db.exec('PRAGMA foreign_keys = ON');

const PILOT_SLUG = 'trennen-pilot';
const DEFAULT_OWNER_EMAIL = 'support@trennen.co.nz';
const DEFAULT_CUSTOMER_EMAIL = 'daniellucas2907@gmail.com';
const LOCAL_OWNER_PASSWORD = 'TrennenPilot!2026';
const LOCAL_CUSTOMER_PASSWORD = 'CustomerPilot!2026';

function requiredProductionSecret(name) {
  const value = String(process.env[name] || '').trim();
  if (process.env.NODE_ENV === 'production' && !value) {
    throw new Error(`${name} is required when seeding the pilot shop in production.`);
  }
  return value;
}

function json(value) {
  return JSON.stringify(value);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function publicToken() {
  return randomBytes(24).toString('base64url');
}

function materialColumns() {
  return new Set(db.prepare('PRAGMA table_info(materials)').all().map(row => row.name));
}

function runDynamicInsert(table, data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO ${table} (${cols.join(', ')})
    VALUES (${placeholders})
  `).run(...cols.map(col => data[col]));
}

function runDynamicUpdate(table, data, where, whereValues) {
  const cols = Object.keys(data);
  db.prepare(`
    UPDATE ${table}
    SET ${cols.map(col => `${col} = ?`).join(', ')}
    WHERE ${where}
  `).run(...cols.map(col => data[col]), ...whereValues);
}

function upsertMaterial(shopId, material, columns) {
  const existing = db.prepare('SELECT id FROM materials WHERE shop_id = ? AND name = ?')
    .get(shopId, material.name);
  const base = {
    shop_id: shopId,
    name: material.name,
    category: material.category,
    description_short: material.description_short,
    description_long: material.description_long,
    colours: json(material.colours),
    finishes: json(material.finishes),
    image_url: material.image_url || null,
    image_alt: material.image_alt || null,
    price_unit: 'per cm³',
    recommended: material.recommended ? 1 : 0,
    tags: json(material.tags),
    best_for: json(material.best_for),
    specs: json(material.specs),
    pricing_model: 'per_cm3',
    base_price: material.base_price,
    min_charge: material.min_charge,
    volume_tiers: json(material.volume_tiers),
    properties: json(material.properties),
    active: 1,
    stock_status: 'in_stock',
    sort_order: material.sort_order,
  };
  for (const optional of [
    'production_days_min', 'production_days_max',
    'min_x_mm', 'min_y_mm', 'min_z_mm',
    'max_x_mm', 'max_y_mm', 'max_z_mm',
  ]) {
    if (columns.has(optional)) base[optional] = material[optional] ?? null;
  }

  if (existing) {
    const { shop_id, ...updates } = base;
    runDynamicUpdate('materials', updates, 'id = ? AND shop_id = ?', [existing.id, shopId]);
    return existing.id;
  }
  const result = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('materials');
  runDynamicInsert('materials', base);
  const inserted = db.prepare('SELECT id FROM materials WHERE shop_id = ? AND name = ?')
    .get(shopId, material.name);
  return inserted?.id || result?.seq + 1;
}

const commonColours = [
  { id: 'white', name: 'White', hex: '#f8f8f4', enabled: true },
  { id: 'black', name: 'Black', hex: '#171717', enabled: true },
  { id: 'natural', name: 'Natural', hex: '#e8ddc8', enabled: true },
];

const finishOptions = [
  { id: 'draft-028', name: 'Draft', layerHeight: '0.28mm', description: 'Fast practical prototype finish.', priceMultiplier: 0.9, enabled: true },
  { id: 'standard-020', name: 'Standard', layerHeight: '0.20mm', description: 'Balanced detail and speed.', priceMultiplier: 1, enabled: true },
  { id: 'fine-012', name: 'Fine', layerHeight: '0.12mm', description: 'Sharper visible detail.', priceMultiplier: 1.35, enabled: true },
];

const MATERIALS = [
  {
    name: 'PLA Prototype',
    category: 'FDM',
    description_short: 'Reliable everyday plastic for prototypes, fixtures, and display parts.',
    description_long: 'PLA is the simplest starting point for most quote requests. It prints cleanly, keeps costs down, and suits indoor parts that do not need high heat resistance.',
    base_price: 0.28,
    min_charge: 12,
    recommended: true,
    tags: ['prototype', 'display', 'low-cost'],
    best_for: ['Concept models', 'Visual samples', 'Light-duty brackets'],
    specs: ['Good detail', 'Low warp', 'Indoor use'],
    colours: commonColours,
    finishes: finishOptions,
    volume_tiers: [{ from: 0, price: 0.28 }, { from: 80, price: 0.24 }, { from: 200, price: 0.21 }],
    properties: { strength: 3, flexibility: 1, heat: 2, idealFor: 'Fast prototypes and presentation models', notFor: 'Hot cars or outdoor weathering' },
    production_days_min: 2,
    production_days_max: 4,
    min_x_mm: 5, min_y_mm: 5, min_z_mm: 1,
    max_x_mm: 250, max_y_mm: 250, max_z_mm: 250,
    sort_order: 10,
  },
  {
    name: 'PETG Functional',
    category: 'FDM',
    description_short: 'Tougher functional plastic for practical parts and light outdoor use.',
    description_long: 'PETG is a strong pilot default for usable parts. It has more impact resistance than PLA and handles moisture better.',
    base_price: 0.36,
    min_charge: 16,
    recommended: false,
    tags: ['functional', 'durable', 'moisture-resistant'],
    best_for: ['Jigs', 'Enclosures', 'Usable mechanical parts'],
    specs: ['Tough', 'Slightly flexible', 'Good chemical resistance'],
    colours: commonColours,
    finishes: finishOptions,
    volume_tiers: [{ from: 0, price: 0.36 }, { from: 80, price: 0.32 }, { from: 200, price: 0.29 }],
    properties: { strength: 4, flexibility: 2, heat: 3, idealFor: 'Functional prototypes and durable parts', notFor: 'Tiny cosmetic detail' },
    production_days_min: 3,
    production_days_max: 5,
    min_x_mm: 5, min_y_mm: 5, min_z_mm: 1,
    max_x_mm: 250, max_y_mm: 250, max_z_mm: 250,
    sort_order: 20,
  },
  {
    name: 'ASA Outdoor',
    category: 'FDM',
    description_short: 'Weather-resistant plastic for outdoor brackets, housings, and fixtures.',
    description_long: 'ASA is suitable when UV and weather exposure matter. It costs more than PLA or PETG but is better aligned with outdoor use.',
    base_price: 0.48,
    min_charge: 22,
    recommended: false,
    tags: ['outdoor', 'uv-resistant', 'heat-resistant'],
    best_for: ['Outdoor covers', 'Automotive trim', 'Weathered fixtures'],
    specs: ['UV stable', 'Higher heat resistance', 'Durable'],
    colours: commonColours.filter(c => c.id !== 'natural'),
    finishes: finishOptions.filter(f => f.id !== 'draft-028'),
    volume_tiers: [{ from: 0, price: 0.48 }, { from: 80, price: 0.43 }, { from: 200, price: 0.39 }],
    properties: { strength: 4, flexibility: 2, heat: 4, idealFor: 'Outdoor and higher-temperature parts', notFor: 'Ultra-fast low-cost prototypes' },
    production_days_min: 4,
    production_days_max: 7,
    min_x_mm: 8, min_y_mm: 8, min_z_mm: 1,
    max_x_mm: 220, max_y_mm: 220, max_z_mm: 220,
    sort_order: 30,
  },
];

const SHIPPING = [
  { id: 'trennen-standard', courier: 'Trennen Courier', service: 'Standard tracked', price: 8.5, days_min: 2, days_max: 4, recommended: true, active: true },
  { id: 'trennen-express', courier: 'Trennen Courier', service: 'Express tracked', price: 14.9, days_min: 1, days_max: 2, recommended: false, active: true },
  { id: 'trennen-pickup', courier: 'Trennen', service: 'Local pickup', price: 0, days_min: 0, days_max: 1, recommended: false, active: true },
];

async function main() {
  if (process.env.ALLOW_TRENNEN_PILOT_SEED !== '1') {
    throw new Error('Refusing to seed pilot data unless ALLOW_TRENNEN_PILOT_SEED=1 is set.');
  }

  const ownerEmail = String(process.env.PILOT_OWNER_EMAIL || DEFAULT_OWNER_EMAIL).trim().toLowerCase();
  const customerEmail = String(process.env.PILOT_CUSTOMER_EMAIL || DEFAULT_CUSTOMER_EMAIL).trim().toLowerCase();
  const ownerPassword = requiredProductionSecret('PILOT_OWNER_PASSWORD') || LOCAL_OWNER_PASSWORD;
  const customerPassword = requiredProductionSecret('PILOT_CUSTOMER_PASSWORD') || LOCAL_CUSTOMER_PASSWORD;
  const stripeAccountId = String(process.env.PILOT_STRIPE_ACCOUNT_ID || '').trim();
  const connectReady = !!stripeAccountId && boolEnv('PILOT_STRIPE_READY', true);
  const ownerHash = await bcrypt.hash(ownerPassword, 10);
  const customerHash = await bcrypt.hash(customerPassword, 10);

  db.prepare(`
    INSERT INTO shops (
      name, slug, email, password_hash, is_temp_password, plan,
      billing_status, billing_checkout_status,
      stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted,
      updated_at
    )
    VALUES (?, ?, ?, ?, 0, 'community', 'active', 'free_plan', ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      password_hash = excluded.password_hash,
      is_temp_password = 0,
      plan = 'community',
      billing_status = 'active',
      billing_checkout_status = 'free_plan',
      stripe_account_id = COALESCE(NULLIF(excluded.stripe_account_id, ''), shops.stripe_account_id),
      stripe_charges_enabled = CASE WHEN NULLIF(excluded.stripe_account_id, '') IS NOT NULL THEN excluded.stripe_charges_enabled ELSE shops.stripe_charges_enabled END,
      stripe_payouts_enabled = CASE WHEN NULLIF(excluded.stripe_account_id, '') IS NOT NULL THEN excluded.stripe_payouts_enabled ELSE shops.stripe_payouts_enabled END,
      stripe_details_submitted = CASE WHEN NULLIF(excluded.stripe_account_id, '') IS NOT NULL THEN excluded.stripe_details_submitted ELSE shops.stripe_details_submitted END,
      updated_at = datetime('now')
  `).run(
    'Trennen Pilot',
    PILOT_SLUG,
    ownerEmail,
    ownerHash,
    stripeAccountId || null,
    connectReady ? 1 : 0,
    connectReady ? 1 : 0,
    connectReady ? 1 : 0,
  );

  const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(PILOT_SLUG);
  db.prepare('INSERT OR IGNORE INTO platform_settings (id, platform_fee_percent) VALUES (1, 5)').run();
  db.prepare("UPDATE platform_settings SET platform_fee_percent = 5, updated_at = datetime('now') WHERE id = 1").run();

  db.prepare(`
    INSERT INTO pricing_config (
      shop_id, currency, tax_rate, tax_inclusive, min_order_value,
      free_shipping_above, quote_rounding, quote_valid_hours, max_model_quantity,
      show_breakdown, surcharges, pricing_mode, mat_include_support,
      time_rate_per_hour, time_rate_per_gram, time_include_support, infill_tiers,
      updated_at
    )
    VALUES (?, 'NZD', 0.15, 0, 15, 150, 0.10, 72, 20, 1, '[]', 'material', 1, 0, 0, 0, ?, datetime('now'))
    ON CONFLICT(shop_id) DO UPDATE SET
      currency = 'NZD',
      tax_rate = 0.15,
      tax_inclusive = 0,
      min_order_value = 15,
      free_shipping_above = 150,
      quote_rounding = 0.10,
      quote_valid_hours = 72,
      max_model_quantity = 20,
      show_breakdown = 1,
      surcharges = '[]',
      pricing_mode = 'material',
      mat_include_support = 1,
      time_rate_per_hour = 0,
      time_rate_per_gram = 0,
      time_include_support = 0,
      infill_tiers = excluded.infill_tiers,
      updated_at = datetime('now')
  `).run(shop.id, json([
    { id: 'infill-15', label: '15% Light', percent: 15, multiplier: 0.95, active: true },
    { id: 'infill-25', label: '25% Standard', percent: 25, multiplier: 1, active: true },
    { id: 'infill-50', label: '50% Strong', percent: 50, multiplier: 1.25, active: true },
  ]));

  db.prepare(`
    INSERT INTO store_settings (
      shop_id, tagline, about, phone, address, support_email_mode, support_email,
      gst_number, invoice_footer, invoice_logo, notifications, email_templates,
      shipping_zones, material_page_settings, embed_allowed_origins, payment_fee_mode,
      email_use_platform_fallback, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'custom', ?, ?, ?, 1, ?, '{}', ?, ?, ?, 'merchant_absorbs', 1, datetime('now'))
    ON CONFLICT(shop_id) DO UPDATE SET
      tagline = excluded.tagline,
      about = excluded.about,
      phone = excluded.phone,
      address = excluded.address,
      support_email_mode = 'custom',
      support_email = excluded.support_email,
      gst_number = excluded.gst_number,
      invoice_footer = excluded.invoice_footer,
      invoice_logo = 1,
      notifications = excluded.notifications,
      shipping_zones = excluded.shipping_zones,
      material_page_settings = excluded.material_page_settings,
      embed_allowed_origins = excluded.embed_allowed_origins,
      payment_fee_mode = 'merchant_absorbs',
      email_use_platform_fallback = 1,
      updated_at = datetime('now')
  `).run(
    shop.id,
    '3D printing pilot storefront for Trennen',
    'A controlled pilot shop used to rehearse quoting, checkout, email, admin, and customer portal flows before client launch.',
    '+64 21 000 0000',
    'Auckland, New Zealand',
    ownerEmail,
    '',
    'Quotes are valid for 72 hours. GST and the Trennen platform fee are included in the customer-facing checkout total.',
    json({
      new_order: true,
      payment_failed: true,
      low_stock: false,
      new_customer: true,
    }),
    json(SHIPPING),
    json({
      heading: 'Choose your material',
      subtitle: 'Pilot materials are configured with realistic NZD pricing for rehearsal.',
      helperTitle: 'Need help?',
      helperText: 'Start with PLA Prototype unless the part needs extra toughness or outdoor use.',
      continueLabel: 'Continue to Options',
      emptyState: 'No pilot materials are active right now.',
    }),
    json(['https://app.trennen.co.nz']),
  );

  const columns = materialColumns();
  const materialIds = MATERIALS.map(material => upsertMaterial(shop.id, material, columns));

  db.prepare(`
    INSERT INTO customers (shop_id, email, name, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_id, email) DO UPDATE SET
      name = excluded.name,
      notes = excluded.notes
  `).run(shop.id, customerEmail, 'Daniel Pilot Customer', 'Controlled pilot rehearsal customer.');

  db.prepare(`
    INSERT INTO customer_accounts (shop_id, email, name, password_hash)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_id, email) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash
  `).run(shop.id, customerEmail, 'Daniel Pilot Customer', customerHash);

  const existingOrder = db.prepare(`
    SELECT id FROM orders
    WHERE shop_id = ? AND customer_email = ? AND file_name = 'trennen-pilot-baseline.stl'
  `).get(shop.id, customerEmail);
  if (!existingOrder) {
    const subtotal = 42.5;
    const tax = 6.38;
    const shipping = 8.5;
    const total = Math.round((subtotal + tax + shipping) * 100) / 100;
    const order = db.prepare(`
      INSERT INTO orders (
        shop_id, customer_email, customer_name, file_name, material_id,
        colour, finish, quantity, subtotal, tax, shipping, total,
        payment_status, fulfilment_status, public_token,
        checkout_platform_fee_cents, customer_total_cents, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'paid', 'in_production', ?, 302, 6040, ?)
    `).run(
      shop.id,
      customerEmail,
      'Daniel Pilot Customer',
      'trennen-pilot-baseline.stl',
      materialIds[0],
      'White',
      'Standard',
      subtotal,
      tax,
      shipping,
      total,
      publicToken(),
      'Seeded rehearsal order for portal/admin smoke checks.',
    );
    db.prepare(`
      INSERT INTO order_items (
        order_id, material_id, material_name, colour, finish, finish_detail,
        infill, quantity, subtotal, tax, shipping, total, quote_snapshot
      )
      VALUES (?, ?, ?, 'White', 'Standard', '0.20mm', '25% Standard', 1, ?, ?, ?, ?, ?)
    `).run(
      order.lastInsertRowid,
      materialIds[0],
      MATERIALS[0].name,
      subtotal,
      tax,
      shipping,
      total,
      json({ seeded: true, shopSlug: PILOT_SLUG }),
    );
  }

  console.log(`Trennen pilot shop ready: ${PILOT_SLUG}`);
  console.log(`Owner login: ${ownerEmail}${process.env.NODE_ENV === 'production' ? ' / <PILOT_OWNER_PASSWORD>' : ` / ${LOCAL_OWNER_PASSWORD}`}`);
  console.log(`Customer login: ${customerEmail}${process.env.NODE_ENV === 'production' ? ' / <PILOT_CUSTOMER_PASSWORD>' : ` / ${LOCAL_CUSTOMER_PASSWORD}`}`);
  console.log(`Materials: ${MATERIALS.length}; shipping methods: ${SHIPPING.length}; Stripe account: ${stripeAccountId ? 'attached' : 'not attached'}`);
}

try {
  await main();
} finally {
  db.close();
}
