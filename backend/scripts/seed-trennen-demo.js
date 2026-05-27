import { pathToFileURL } from 'url';
import { resolve } from 'path';
import {
  assertDemoSeedAllowed,
  seedTrennenDemo,
} from './seed-mahi3d-demo.js';

export * from './seed-mahi3d-demo.js';

async function main() {
  assertDemoSeedAllowed();
  const result = await seedTrennenDemo();
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
