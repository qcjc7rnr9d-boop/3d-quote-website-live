import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/rfdewi.db');

try {
  const pricingCols = db.prepare('PRAGMA table_info(pricing_config)').all().map(c => c.name);
  if (!pricingCols.includes('max_model_quantity')) {
    db.exec('ALTER TABLE pricing_config ADD COLUMN max_model_quantity INTEGER;');
    console.log('+ added pricing_config.max_model_quantity');
  } else {
    console.log('✓ pricing_config.max_model_quantity already exists');
  }
  const fileCols = db.prepare('PRAGMA table_info(order_files)').all().map(c => c.name);
  if (!fileCols.includes('quantity')) {
    db.exec('ALTER TABLE order_files ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;');
    console.log('+ added order_files.quantity');
  } else {
    console.log('✓ order_files.quantity already exists');
  }
  console.log('Migration v21 complete - per-model quantity limits ready.');
} finally {
  db.close();
}
