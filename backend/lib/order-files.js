import { MAX_MODEL_QUANTITY_SAFETY, normaliseModelDisplayMetadata } from './pricing-engine.js';

export function ensureOrderFilesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      material_id INTEGER,
      material_name TEXT,
      colour TEXT,
      finish TEXT,
      finish_detail TEXT,
      infill TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      shipping REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      quote_snapshot TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS order_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      order_item_id INTEGER,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      file_ext TEXT,
      volume_cm3 REAL,
      quantity INTEGER NOT NULL DEFAULT 1,
      dimensions TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_files_order
      ON order_files(order_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_order_items_order
      ON order_items(order_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_order_files_item
      ON order_files(order_item_id, sort_order);
  `);
  const fileColumns = db.prepare('PRAGMA table_info(order_files)').all().map(row => row.name);
  if (!fileColumns.includes('order_item_id')) {
    db.exec('ALTER TABLE order_files ADD COLUMN order_item_id INTEGER;');
  }
  if (!fileColumns.includes('quantity')) {
    db.exec('ALTER TABLE order_files ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;');
  }
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function normaliseOrderFiles(input = {}) {
  const raw = Array.isArray(input.models) && input.models.length
    ? input.models
    : (input.fileName ? [{
        name: input.fileName,
        size: input.fileSize ?? input.size ?? null,
        ext: input.fileExt ?? String(input.fileName).split('.').pop(),
        volumeCm3: input.volumeCm3 ?? null,
        dimensions: input.dimensions ?? null,
      }] : []);

  return raw.map((file, index) => {
    const meta = normaliseModelDisplayMetadata(file, index, { strict: false });
    return {
      name: meta.name,
      size: meta.size,
      ext: meta.ext,
      volumeCm3: Number.isFinite(Number(file.volumeCm3)) ? Number(file.volumeCm3) : null,
      quantity: Math.max(1, Math.min(MAX_MODEL_QUANTITY_SAFETY, Math.floor(Number(file.quantity) || 1))),
      dimensions: meta.dimensions,
    };
  }).filter(file => file.name);
}

export function saveOrderFiles(db, orderId, files = [], options = {}) {
  ensureOrderFilesTable(db);
  const stmt = db.prepare(`
    INSERT INTO order_files (order_id, order_item_id, file_name, file_size, file_ext, volume_cm3, quantity, dimensions, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [index, file] of normaliseOrderFiles({ models: files }).entries()) {
    stmt.run(orderId, options.orderItemId || null, file.name, file.size, file.ext || null, file.volumeCm3, file.quantity, JSON.stringify(file.dimensions || {}), index);
  }
}

export function orderFilesFor(db, orderId, orderItemId = null) {
  ensureOrderFilesTable(db);
  const rows = orderItemId
    ? db.prepare(`
      SELECT id, order_item_id, file_name, file_size, file_ext, volume_cm3, quantity, dimensions
      FROM order_files
      WHERE order_id = ? AND order_item_id = ?
      ORDER BY sort_order, id
    `).all(orderId, orderItemId)
    : db.prepare(`
    SELECT id, order_item_id, file_name, file_size, file_ext, volume_cm3, quantity, dimensions
    FROM order_files
    WHERE order_id = ?
    ORDER BY sort_order, id
  `).all(orderId);
  return rows.map(row => ({
    id: row.id,
    orderItemId: row.order_item_id || null,
    name: row.file_name,
    size: row.file_size,
    ext: row.file_ext,
    volumeCm3: row.volume_cm3,
    quantity: row.quantity || 1,
    dimensions: safeJson(row.dimensions, {}),
  }));
}

function normaliseOrderItemForSave(item = {}, index = 0) {
  const quote = item.quoteSnapshot || {};
  const selected = quote.selected || {};
  const lineItems = quote.lineItems || {};
  const finishDetail = [
    item.finishLayerHeight || selected.finish?.layerHeight || '',
    item.finishDescription || selected.finish?.description || '',
  ].filter(Boolean).join(' · ');
  return {
    materialId: item.materialId ?? selected.material?.id ?? null,
    materialName: item.materialName ?? selected.material?.name ?? '',
    colour: item.colorName ?? item.colour ?? selected.colour?.name ?? null,
    finish: item.finishLabel ?? item.finish ?? selected.finish?.name ?? null,
    finishDetail,
    infill: item.infillLabel ?? selected.infill?.label ?? null,
    quantity: Number(item.quantity ?? selected.quantity) || 1,
    subtotal: Number(item.itemsNzd ?? lineItems.itemSubtotal) || 0,
    tax: Number(item.taxNzd ?? lineItems.tax) || 0,
    shipping: Number(item.shippingNzd ?? lineItems.shipping) || 0,
    total: Number(item.totalNzd ?? lineItems.total) || 0,
    quoteSnapshot: quote,
    files: item.models || item.file?.models || selected.models || [],
    sortOrder: index,
  };
}

export function saveOrderItems(db, orderId, items = []) {
  ensureOrderFilesTable(db);
  const stmt = db.prepare(`
    INSERT INTO order_items
      (order_id, material_id, material_name, colour, finish, finish_detail, infill,
       quantity, subtotal, tax, shipping, total, quote_snapshot, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const [index, raw] of items.entries()) {
    const item = normaliseOrderItemForSave(raw, index);
    const result = stmt.run(
      orderId,
      item.materialId,
      item.materialName || null,
      item.colour,
      item.finish,
      item.finishDetail || null,
      item.infill,
      item.quantity,
      item.subtotal,
      item.tax,
      item.shipping,
      item.total,
      JSON.stringify(item.quoteSnapshot || {}),
      item.sortOrder,
    );
    ids.push(result.lastInsertRowid);
    saveOrderFiles(db, orderId, item.files, { orderItemId: result.lastInsertRowid });
  }
  return ids;
}

export function orderItemsFor(db, orderId) {
  ensureOrderFilesTable(db);
  return db.prepare(`
    SELECT *
    FROM order_items
    WHERE order_id = ?
    ORDER BY sort_order, id
  `).all(orderId).map(row => ({
    id: row.id,
    materialId: row.material_id,
    materialName: row.material_name,
    material: row.material_name,
    colour: row.colour,
    finish: row.finish,
    finishDetail: row.finish_detail,
    infill: row.infill,
    quantity: row.quantity,
    subtotal: row.subtotal,
    tax: row.tax,
    shipping: row.shipping,
    total: row.total,
    quoteSnapshot: safeJson(row.quote_snapshot, {}),
    files: orderFilesFor(db, orderId, row.id),
  }));
}

export function attachOrderFiles(db, order) {
  if (!order) return order;
  const items = orderItemsFor(db, order.id);
  return { ...order, items, files: orderFilesFor(db, order.id) };
}

export function attachOrderFilesList(db, orders = []) {
  return orders.map(order => attachOrderFiles(db, order));
}
