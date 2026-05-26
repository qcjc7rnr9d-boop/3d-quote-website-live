import { db } from '../middleware/auth.js';
import Stripe from 'stripe';
import { PLATFORM_FEE_PERCENT } from '../config.js';
import { getBillingPriceSetupStatus } from './billing.js';
import { decryptSecret, encryptSecret, hasSecretEncryptionKey, isEncryptedSecret } from './secret-vault.js';

export const PLATFORM_SETTINGS_ID = 1;

function readPlatformSettingsRow() {
  return db.prepare('SELECT * FROM platform_settings WHERE id = ?').get(PLATFORM_SETTINGS_ID) || null;
}

function encryptLegacyStoredSecret(row) {
  if (!row?.stripe_secret_key || isEncryptedSecret(row.stripe_secret_key) || !hasSecretEncryptionKey()) return row;
  const encrypted = encryptSecret(row.stripe_secret_key);
  db.prepare(`
    UPDATE platform_settings
    SET stripe_secret_key = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(encrypted, PLATFORM_SETTINGS_ID);
  return { ...row, stripe_secret_key: encrypted };
}

export function ensurePlatformSettingsRow() {
  db.prepare('INSERT OR IGNORE INTO platform_settings (id) VALUES (?)').run(PLATFORM_SETTINGS_ID);
  return readPlatformSettingsRow();
}

export function getPlatformSettingsRow() {
  return encryptLegacyStoredSecret(readPlatformSettingsRow() || ensurePlatformSettingsRow());
}

export function getEffectivePlatformStripeConfig() {
  const row = getPlatformSettingsRow() || {};
  const publishableKey = row.stripe_publishable_key || process.env.STRIPE_PUBLISHABLE_KEY || '';
  const secretKey = row.stripe_secret_key ? decryptSecret(row.stripe_secret_key) : (process.env.STRIPE_SECRET_KEY || '');
  const clientId = row.stripe_client_id || process.env.STRIPE_CLIENT_ID || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const feePercent = Number(row.platform_fee_percent);
  const estimatedCardFeeBasisPoints = Number(row.estimated_card_fee_basis_points ?? process.env.ESTIMATED_CARD_FEE_BASIS_POINTS);
  const estimatedCardFeeFixedCents = Number(row.estimated_card_fee_fixed_cents ?? process.env.ESTIMATED_CARD_FEE_FIXED_CENTS);

  return {
    publishableKey,
    secretKey,
    clientId,
    webhookSecret,
    feePercent: Number.isFinite(feePercent) && feePercent >= 0 ? feePercent : PLATFORM_FEE_PERCENT,
    estimatedCardFeeBasisPoints: Number.isFinite(estimatedCardFeeBasisPoints) && estimatedCardFeeBasisPoints >= 0 ? estimatedCardFeeBasisPoints : 290,
    estimatedCardFeeFixedCents: Number.isFinite(estimatedCardFeeFixedCents) && estimatedCardFeeFixedCents >= 0 ? estimatedCardFeeFixedCents : 30,
    fromDb: !!(row.stripe_publishable_key || row.stripe_secret_key || row.stripe_client_id || row.platform_fee_percent != null),
  };
}

export function getPlatformStripeClient() {
  const { secretKey } = getEffectivePlatformStripeConfig();
  return secretKey ? new Stripe(secretKey) : null;
}

export function maskSecretLikeKey(key, prefixes) {
  if (!key) return null;
  const prefix = prefixes.find(p => key.startsWith(p)) || (key.slice(0, 3) + '_');
  return `${prefix}${'*'.repeat(8)}${key.slice(-4)}`;
}

export function getMaskedPlatformStripeConfig() {
  const effective = getEffectivePlatformStripeConfig();
  const billingPrices = getBillingPriceSetupStatus();
  return {
    has_publishable_key: !!effective.publishableKey,
    has_secret_key: !!effective.secretKey,
    has_client_id: !!effective.clientId,
    can_accept_cards: !!(effective.publishableKey && effective.secretKey),
    can_connect_accounts: !!effective.secretKey,
    publishable_key_masked: maskSecretLikeKey(effective.publishableKey, ['pk_live_', 'pk_test_']),
    secret_key_masked: maskSecretLikeKey(effective.secretKey, ['sk_live_', 'sk_test_']),
    client_id_masked: maskSecretLikeKey(effective.clientId, ['ca_']),
    platform_fee_percent: effective.feePercent,
    estimated_card_fee_basis_points: effective.estimatedCardFeeBasisPoints,
    estimated_card_fee_fixed_cents: effective.estimatedCardFeeFixedCents,
    webhook_configured: !!effective.webhookSecret,
    billing_mode: 'free_pilot',
    billing_prices_configured: billingPrices,
    can_create_billing_sessions: false,
    from_db: effective.fromDb,
  };
}

export function updatePlatformStripeConfig({ publishableKey, secretKey, clientId, platformFeePercent, estimatedCardFeeBasisPoints, estimatedCardFeeFixedCents }) {
  ensurePlatformSettingsRow();
  const current = getPlatformSettingsRow();

  const nextPublishable = publishableKey !== undefined ? publishableKey || null : current?.stripe_publishable_key || null;
  const nextSecret = secretKey !== undefined
    ? (secretKey ? encryptSecret(secretKey) : null)
    : (current?.stripe_secret_key || null);
  const nextClientId = clientId !== undefined ? clientId || null : current?.stripe_client_id || null;
  const nextFee = platformFeePercent !== undefined && platformFeePercent !== null && platformFeePercent !== ''
    ? Number(platformFeePercent)
    : (current?.platform_fee_percent ?? PLATFORM_FEE_PERCENT);
  const nextEstimatedBps = estimatedCardFeeBasisPoints !== undefined && estimatedCardFeeBasisPoints !== null && estimatedCardFeeBasisPoints !== ''
    ? Number(estimatedCardFeeBasisPoints)
    : (current?.estimated_card_fee_basis_points ?? 290);
  const nextEstimatedFixed = estimatedCardFeeFixedCents !== undefined && estimatedCardFeeFixedCents !== null && estimatedCardFeeFixedCents !== ''
    ? Number(estimatedCardFeeFixedCents)
    : (current?.estimated_card_fee_fixed_cents ?? 30);

  db.prepare(`
    UPDATE platform_settings
    SET stripe_publishable_key = ?,
        stripe_secret_key = ?,
        stripe_client_id = ?,
        platform_fee_percent = ?,
        estimated_card_fee_basis_points = ?,
        estimated_card_fee_fixed_cents = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(nextPublishable, nextSecret, nextClientId, nextFee, nextEstimatedBps, nextEstimatedFixed, PLATFORM_SETTINGS_ID);

  return getMaskedPlatformStripeConfig();
}

export function platformStripeSecretStoredEncrypted() {
  const row = getPlatformSettingsRow() || {};
  return !row.stripe_secret_key || isEncryptedSecret(row.stripe_secret_key);
}

export function updateShopStripeReadiness(shopId, account) {
  db.prepare(`
    UPDATE shops
    SET stripe_charges_enabled = ?,
        stripe_payouts_enabled = ?,
        stripe_details_submitted = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    account?.charges_enabled ? 1 : 0,
    account?.payouts_enabled ? 1 : 0,
    account?.details_submitted ? 1 : 0,
    shopId
  );
}
