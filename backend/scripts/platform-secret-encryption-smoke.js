import { DatabaseSync } from 'node:sqlite';

process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY
  || 'launch-readiness-local-secret-key-32-bytes-minimum';

const db = new DatabaseSync('data/rfdewi.db');
const before = db.prepare('SELECT * FROM platform_settings WHERE id = 1').get() || null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const {
    getEffectivePlatformStripeConfig,
    updatePlatformStripeConfig,
  } = await import('../lib/platform-payments.js');

  const secret = 'sk_test_launch_readiness_secret_123456789';
  updatePlatformStripeConfig({
    publishableKey: 'pk_test_launch_readiness',
    secretKey: secret,
    clientId: 'ca_launch_readiness',
    platformFeePercent: 5,
  });

  const row = db.prepare('SELECT stripe_secret_key FROM platform_settings WHERE id = 1').get();
  assert(row?.stripe_secret_key, 'platform secret key was not stored');
  assert(row.stripe_secret_key !== secret, 'platform secret key is stored in plaintext');
  assert(String(row.stripe_secret_key).startsWith('enc:v1:'), 'platform secret key is not stored with encrypted marker');

  const effective = getEffectivePlatformStripeConfig();
  assert(effective.secretKey === secret, 'effective Stripe config did not decrypt the stored secret');

  db.prepare('UPDATE platform_settings SET stripe_secret_key = ? WHERE id = 1').run(secret);
  const migrated = getEffectivePlatformStripeConfig();
  assert(migrated.secretKey === secret, 'effective Stripe config did not read a legacy plaintext secret');
  const migratedRow = db.prepare('SELECT stripe_secret_key FROM platform_settings WHERE id = 1').get();
  assert(migratedRow.stripe_secret_key !== secret, 'legacy plaintext platform secret was not re-encrypted on read');
  assert(String(migratedRow.stripe_secret_key).startsWith('enc:v1:'), 'legacy platform secret was not migrated to encrypted form');

  console.log('Platform secret encryption smoke checks passed.');
} finally {
  if (before) {
    db.prepare(`
      UPDATE platform_settings
      SET stripe_publishable_key = ?,
          stripe_secret_key = ?,
          stripe_client_id = ?,
          platform_fee_percent = ?,
          updated_at = ?
      WHERE id = 1
    `).run(
      before.stripe_publishable_key,
      before.stripe_secret_key,
      before.stripe_client_id,
      before.platform_fee_percent,
      before.updated_at
    );
  } else {
    db.prepare('DELETE FROM platform_settings WHERE id = 1').run();
  }
  db.close();
}
