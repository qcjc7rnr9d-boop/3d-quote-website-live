import { MIN_PASSWORD_LENGTH } from '../config.js';
import { MATERIAL_LIBRARY, enrichMaterialSuggestion } from './material-library.js';
import {
  defaultPlanById,
  normalisePlanId,
} from './billing-plans.js';
import {
  ensureBillingReady,
  getBillingUsageSummary,
} from './billing-service.js';
import { ensureEmbedSettingsColumns } from './embed.js';
import { ensureEmailDeliverySchema } from './email-delivery.js';
import { isSafeEmailAddress, normaliseEmailAddress } from './email-validation.js';

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'backend',
  'catalog',
  'checkout',
  'confirmation',
  'customer',
  'embed',
  'index',
  'materials',
  'onboarding',
  'options',
  'platform',
  'pricing',
  'privacy',
  'quote',
  'research',
  'stripe',
  'stripe-callback',
  'terms',
  'uploads',
]);

const VOLUME_OPTIONS = new Set(['1-25', '26-100', '101-300', '300+']);
const STARTER_MATERIAL_KEYS = ['pla', 'petg', 'abs', 'asa', 'tpu_95a', 'nylon'];

function text(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function normaliseEmail(value) {
  return normaliseEmailAddress(value);
}

export function validEmail(value) {
  return isSafeEmailAddress(value);
}

export function normaliseSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function slugValidationError(slug) {
  if (!slug) return 'Choose a shop URL slug.';
  if (slug.length < 3) return 'Use at least 3 letters or numbers.';
  if (slug.length > 48) return 'Use 48 characters or fewer.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return 'Use lowercase letters, numbers, and hyphens only.';
  if (RESERVED_SLUGS.has(slug)) return 'That shop URL is reserved.';
  return null;
}

export function slugAvailable(db, slug) {
  const normalized = normaliseSlug(slug);
  if (slugValidationError(normalized)) return false;
  return !db.prepare('SELECT 1 FROM shops WHERE slug = ?').get(normalized);
}

export function suggestSlug(db, value) {
  const base = normaliseSlug(value) || 'shop';
  const root = slugValidationError(base) ? `shop-${base}` : base;
  const trimmedRoot = root.slice(0, 42).replace(/-+$/g, '') || 'shop';
  if (slugAvailable(db, trimmedRoot)) return trimmedRoot;
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${trimmedRoot}-${i}`;
    if (slugAvailable(db, candidate)) return candidate;
  }
  return `${trimmedRoot}-${Date.now().toString(36).slice(-4)}`;
}

export function validatePasswordStrength(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

export function normaliseSignupInput(body = {}) {
  const shopName = text(body.shopName || body.shop_name || body.company, 120);
  const ownerName = text(body.ownerName || body.owner_name || body.name, 120);
  const email = normaliseEmail(body.email);
  const slug = normaliseSlug(body.slug || shopName);
  const plan = normalisePlanId(body.plan || 'starter');
  const monthlyQuoteVolume = text(body.monthlyQuoteVolume || body.monthly_quote_volume || body.volume, 40);
  const paymentPath = text(body.paymentPath || body.payment_path || 'bank_transfer_first', 80);
  const password = String(body.password || '');
  const website = text(body.website, 300);
  return {
    shopName,
    ownerName,
    email,
    slug,
    plan,
    monthlyQuoteVolume,
    paymentPath,
    password,
    website,
  };
}

export function validateSignup(db, input) {
  const errors = {};
  if (!input.ownerName) errors.ownerName = 'Enter your name.';
  if (!input.shopName) errors.shopName = 'Enter your shop name.';
  if (!input.email) errors.email = 'Enter your work email.';
  else if (!validEmail(input.email)) errors.email = 'Enter a valid work email.';
  const slugError = slugValidationError(input.slug);
  if (slugError) errors.slug = slugError;
  else if (!slugAvailable(db, input.slug)) errors.slug = 'That shop URL is already taken.';
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) errors.password = passwordError;
  if (!VOLUME_OPTIONS.has(input.monthlyQuoteVolume)) errors.monthlyQuoteVolume = 'Select a monthly quote range.';
  if (db.prepare('SELECT 1 FROM shops WHERE email = ?').get(input.email)) {
    errors.email = 'An account with that email already exists.';
  }
  return errors;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sqlDate(date = new Date()) {
  return date.toISOString();
}

function currentMonthEnd(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

function initialBillingForPlan(planId, now = new Date()) {
  const plan = defaultPlanById(planId);
  if (plan.id === 'community') {
    return {
      status: 'active',
      trialStart: null,
      trialEnd: null,
      periodStart: now,
      periodEnd: currentMonthEnd(now),
    };
  }
  if (Number(plan.trial_days || 0) > 0) {
    const trialEnd = addDays(now, Number(plan.trial_days || 0));
    return {
      status: 'trialing',
      trialStart: now,
      trialEnd,
      periodStart: now,
      periodEnd: trialEnd,
    };
  }
  return {
    status: 'pending_subscription',
    trialStart: null,
    trialEnd: null,
    periodStart: now,
    periodEnd: currentMonthEnd(now),
  };
}

function starterShippingZones() {
  return [
    {
      id: 'local-pickup',
      courier: 'Pickup',
      service: 'Local pickup',
      price: 0,
      recommended: false,
      active: true,
    },
    {
      id: 'standard-courier',
      courier: 'Courier',
      service: 'Standard tracked',
      price: 8.5,
      days_min: 2,
      days_max: 4,
      recommended: true,
      active: true,
    },
  ];
}

function stableId(prefix, value, index = 0) {
  const slug = String(value || `${prefix}-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${prefix}_${slug || index + 1}`;
}

function coloursForMaterial(material) {
  const textValue = `${material.key} ${material.displayName} ${material.category}`.toLowerCase();
  let colours = [
    ['Black', '#111827'],
    ['White', '#f8fafc'],
    ['Grey', '#9ca3af'],
    ['Blue', '#2563eb'],
  ];
  if (/tpu|flexible/.test(textValue)) {
    colours = [
      ['Black', '#111827'],
      ['White', '#f8fafc'],
      ['Grey', '#9ca3af'],
    ];
  } else if (/nylon|pa/.test(textValue)) {
    colours = [
      ['White / Natural', '#f5f1e8'],
      ['Black', '#111827'],
      ['Grey', '#9ca3af'],
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

function finishesForMaterial(material) {
  const flexible = /tpu|flexible/.test(`${material.key} ${material.displayName}`.toLowerCase());
  const rows = flexible
    ? [
      ['Draft', '0.28 mm', 'Faster flexible-part setup', 0.95],
      ['Standard', '0.20 mm', 'Balanced flexible-part setup', 1],
      ['Fine', '0.16 mm', 'Cleaner flexible surfaces', 1.16],
    ]
    : [
      ['Draft', '0.28 mm', 'Fast quote preview', 0.9],
      ['Standard', '0.20 mm', 'Balanced speed and surface finish', 1],
      ['Fine', '0.12 mm', 'Better detail with a smoother surface', 1.18],
    ];
  return rows.map(([name, layerHeight, description, priceMultiplier], index) => ({
    id: stableId('finish', name, index),
    name,
    layerHeight,
    description,
    priceMultiplier,
    previewType: index === 0 ? 'standard' : 'fine',
    previewImageUrl: null,
    enabled: true,
    default: index === 1,
    sortOrder: index,
  }));
}

function starterPricing(material) {
  const textValue = `${material.key} ${material.displayName}`.toLowerCase();
  if (/tpu|flexible/.test(textValue)) return { base_price: 0.36, min_charge: 8 };
  if (/nylon|pa/.test(textValue)) return { base_price: 0.28, min_charge: 6 };
  if (/abs|asa|petg/.test(textValue)) return { base_price: 0.28, min_charge: 6 };
  return { base_price: 0.2, min_charge: 4.5 };
}

function starterMaterialRecord(material, index) {
  const enriched = enrichMaterialSuggestion(material);
  const pricing = starterPricing(enriched);
  const ratings = {
    strength: Number(enriched.ratings?.strength ?? enriched.strength ?? 60),
    flexibility: Number(enriched.ratings?.flexibility ?? enriched.flexibility ?? 40),
    heatResistance: Number(enriched.ratings?.heatResistance ?? enriched.heat ?? 40),
    detail: Number(enriched.detail ?? 3) * 20,
    outdoorUse: Number(enriched.outdoorUse ?? 3) * 20,
  };
  return {
    name: enriched.displayName,
    description_short: enriched.shortDescription,
    description_long: enriched.longDescription,
    category: enriched.category || 'FDM',
    colours: JSON.stringify(coloursForMaterial(enriched)),
    finishes: JSON.stringify(finishesForMaterial(enriched)),
    image_url: null,
    image_alt: `Example ${enriched.displayName} printed part`,
    price_unit: 'per cm3',
    recommended: ['pla', 'petg', 'asa'].includes(enriched.key) ? 1 : 0,
    tags: JSON.stringify([...new Set([enriched.category, ...(enriched.tags || [])].filter(Boolean))]),
    best_for: JSON.stringify(enriched.best_for || enriched.ideal_for || []),
    specs: JSON.stringify(enriched.specs || []),
    pricing_model: 'per_cm3',
    base_price: pricing.base_price,
    min_charge: pricing.min_charge,
    volume_tiers: JSON.stringify([]),
    properties: JSON.stringify({
      libraryKey: enriched.key,
      librarySource: 'curated-material-library',
      ratings,
      strength: ratings.strength,
      flexibility: ratings.flexibility,
      heat: ratings.heatResistance,
      detail: ratings.detail,
      outdoorUse: ratings.outdoorUse,
      idealFor: enriched.ideal_for || enriched.best_for || [],
      notFor: enriched.not_for || [],
      dataNote: 'Starter defaults. Review against your exact material brand before publishing.',
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

function insertStarterMaterial(db, shopId, record) {
  const columns = new Set(db.prepare('PRAGMA table_info(materials)').all().map(row => row.name));
  const values = { shop_id: shopId, ...record };
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  const names = entries.map(([key]) => key);
  const placeholders = names.map(() => '?').join(', ');
  db.prepare(`
    INSERT INTO materials (${names.join(', ')})
    VALUES (${placeholders})
  `).run(...entries.map(([, value]) => value));
}

function seedStarterMaterials(db, shopId) {
  const byKey = new Map(MATERIAL_LIBRARY.map(material => [material.key, material]));
  STARTER_MATERIAL_KEYS
    .map(key => byKey.get(key))
    .filter(Boolean)
    .forEach((material, index) => {
      insertStarterMaterial(db, shopId, starterMaterialRecord(material, index));
    });
}

export function createSelfServeShop(db, input, passwordHash) {
  ensureBillingReady(db);
  ensureEmbedSettingsColumns(db);
  ensureEmailDeliverySchema(db);
  const now = new Date();
  const billing = initialBillingForPlan(input.plan, now);

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO shops (
        name, slug, email, password_hash, is_temp_password, plan,
        billing_status, billing_current_period_end, billing_updated_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      input.shopName,
      input.slug,
      input.email,
      passwordHash,
      input.plan,
      billing.status,
      sqlDate(billing.periodEnd),
    );
    const shopId = Number(result.lastInsertRowid);

    db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
    db.prepare(`
      INSERT INTO store_settings (
        shop_id, tagline, about, support_email_mode, support_email,
        notifications, email_templates, shipping_zones, material_page_settings,
        embed_allowed_origins, payment_fee_mode, updated_at
      )
      VALUES (?, ?, ?, 'hidden', NULL, '{}', '{}', ?, ?, '[]', 'bank_transfer_only', datetime('now'))
    `).run(
      shopId,
      'Instant quotes for practical 3D printed parts.',
      `New Trennen shop for ${input.shopName}.`,
      JSON.stringify(starterShippingZones()),
      JSON.stringify({
        starter: true,
        note: 'Starter material catalogue created during self-serve signup.',
      }),
    );
    seedStarterMaterials(db, shopId);
    db.prepare(`
      INSERT INTO merchant_subscriptions (
        shop_id, plan_id, status, trial_start, trial_end,
        current_period_start, current_period_end, stripe_subscription_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      shopId,
      input.plan,
      billing.status,
      billing.trialStart ? sqlDate(billing.trialStart) : null,
      billing.trialEnd ? sqlDate(billing.trialEnd) : null,
      sqlDate(billing.periodStart),
      sqlDate(billing.periodEnd),
    );
    db.exec('COMMIT');

    getBillingUsageSummary(db, shopId);
    return db.prepare(`
      SELECT id, name, slug, email, plan, is_temp_password,
             billing_status, billing_current_period_end,
             created_at, updated_at
      FROM shops
      WHERE id = ?
    `).get(shopId);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}
