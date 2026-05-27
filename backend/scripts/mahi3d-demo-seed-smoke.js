import {
  DEMO_SHOP_SLUG,
  DEMO_LEGACY_SHOP_SLUG,
  DEMO_CUSTOMER_EMAIL,
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_PASSWORD,
  DEMO_CUSTOMER_PASSWORD,
  buildDemoOrders,
  buildDemoShippingZones,
  assertDemoSeedAllowed,
} from './seed-mahi3d-demo.js';

let failures = 0;

function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`✕ ${message}`);
    return;
  }
  console.log(`✓ ${message}`);
}

expect(DEMO_SHOP_SLUG === 'trennen', 'canonical demo slug is trennen');
expect(DEMO_LEGACY_SHOP_SLUG === 'mahi3d', 'legacy Mahi3D slug remains an alias');
expect(DEMO_OWNER_EMAIL === 'owner@trennen-demo.test', 'demo owner email is Trennen-branded');
expect(DEMO_CUSTOMER_EMAIL === 'alex@trennen-demo.test', 'demo customer email is Trennen-branded');
expect(DEMO_OWNER_PASSWORD === 'TrennenAdmin!2026', 'demo owner password is Trennen-branded');
expect(DEMO_CUSTOMER_PASSWORD === 'TrennenCustomer!2026', 'demo customer password is Trennen-branded');

const zones = buildDemoShippingZones();
expect(zones.length === 3, 'demo has three shipping zones');
expect(zones.some(zone => zone.id === 'demo-pickup' && zone.price === 0), 'demo has local pickup');
expect(zones.some(zone => zone.id === 'demo-standard-tracked'), 'demo has standard tracked courier');
expect(zones.some(zone => zone.id === 'demo-express-tracked'), 'demo has express tracked courier');

const orders = buildDemoOrders({
  PLA: { id: 1, name: 'PLA' },
  PETG: { id: 2, name: 'PETG' },
  ASA: { id: 3, name: 'ASA' },
  TPU: { id: 4, name: 'TPU' },
  Nylon: { id: 5, name: 'Nylon' },
});

expect(orders.length === 5, 'demo has five customer orders');
expect(orders.every(order => order.payment_status === 'paid'), 'demo orders are paid checkouts');
expect(orders.some(order => order.fulfilment_status === 'complete'), 'demo includes delivered orders');
expect(orders.some(order => order.fulfilment_status === 'shipped'), 'demo includes a shipped order');
expect(orders.some(order => order.fulfilment_status === 'in_production'), 'demo includes an in-production order');
expect(orders.some(order => order.fulfilment_status === 'processing'), 'demo includes a processing order');
expect(orders.every(order => order.customer_email === DEMO_CUSTOMER_EMAIL), 'orders belong to the demo customer');
expect(orders.every(order => Number.isFinite(order.total) && order.total > 0), 'orders have positive totals');

let blocked = false;
try {
  assertDemoSeedAllowed({ env: { NODE_ENV: 'development' }, argv: [] });
} catch {
  blocked = true;
}
expect(blocked, 'seed refuses to run without explicit demo flag');

let productionBlocked = false;
try {
  assertDemoSeedAllowed({
    env: { NODE_ENV: 'production', ALLOW_TRENNEN_DEMO_SEED: '1' },
    argv: ['--yes'],
  });
} catch {
  productionBlocked = true;
}
expect(productionBlocked, 'seed refuses to run in production');

if (failures) process.exit(1);
console.log('Trennen demo seed smoke checks passed.');
