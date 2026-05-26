import { ensureLegalComplianceSchema } from './legal-policy.js';

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function sqlDatetime(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function accountById(db, customerAccountId, shopId = null) {
  const row = shopId
    ? db.prepare('SELECT * FROM customer_accounts WHERE id = ? AND shop_id = ?').get(customerAccountId, shopId)
    : db.prepare('SELECT * FROM customer_accounts WHERE id = ?').get(customerAccountId);
  if (!row) {
    const err = new Error('Customer account not found');
    err.status = 404;
    throw err;
  }
  return row;
}

function matchingOrders(db, account) {
  return db.prepare(`
    SELECT id, customer_email, customer_name, file_name, material_id, colour, finish,
           quantity, subtotal, tax, shipping, total, payment_status, fulfilment_status,
           stripe_payment_id, public_token, restricted_items_certification_version,
           restricted_items_certified_at, tracking_number, tracking_url, customer_message,
           created_at
    FROM orders
    WHERE shop_id = ? AND LOWER(customer_email) = LOWER(?)
    ORDER BY created_at DESC, id DESC
  `).all(account.shop_id, account.email);
}

function savedQuotes(db, account) {
  return db.prepare(`
    SELECT id, quote_request, quote_snapshot, file_meta, selection, total_cents,
           currency, status, expires_at, created_at, updated_at
    FROM customer_saved_quotes
    WHERE shop_id = ? AND customer_account_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(account.shop_id, account.id).map(row => ({
    ...row,
    quote_request: safeJson(row.quote_request, {}),
    quote_snapshot: safeJson(row.quote_snapshot, {}),
    file_meta: safeJson(row.file_meta, {}),
    selection: safeJson(row.selection, {}),
  }));
}

function orderFiles(db, orderIds) {
  if (!orderIds.length) return [];
  const placeholders = orderIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT order_id, order_item_id, file_name, file_size, file_ext,
           volume_cm3, quantity, dimensions, sort_order, created_at
    FROM order_files
    WHERE order_id IN (${placeholders})
    ORDER BY order_id, sort_order, id
  `).all(...orderIds).map(row => ({
    ...row,
    dimensions: safeJson(row.dimensions, {}),
  }));
}

export function exportCustomerPrivacyData(db, { customerAccountId, shopId = null } = {}) {
  ensureLegalComplianceSchema(db);
  const account = accountById(db, customerAccountId, shopId);
  const shop = db.prepare('SELECT id, name, slug, email FROM shops WHERE id = ?').get(account.shop_id) || null;
  const orders = matchingOrders(db, account);
  const files = orderFiles(db, orders.map(order => order.id));
  const filesByOrder = new Map();
  for (const file of files) {
    const list = filesByOrder.get(file.order_id) || [];
    list.push(file);
    filesByOrder.set(file.order_id, list);
  }

  return {
    exported_at: sqlDatetime(),
    shop,
    customer: {
      id: account.id,
      shop_id: account.shop_id,
      email: account.email,
      name: account.name,
      created_at: account.created_at,
    },
    saved_quotes: savedQuotes(db, account),
    orders: orders.map(order => ({
      ...order,
      files: filesByOrder.get(order.id) || [],
    })),
    retention_notice: 'Orders, payment identifiers, restricted-item certifications, fulfilment, accounting, security, and dispute records may be retained where lawfully required even if the customer account is deleted.',
  };
}

function deleteCustomerAppSessions(db, accountId) {
  const rows = db.prepare('SELECT sid, sess FROM app_sessions').all();
  const deleted = [];
  const del = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const row of rows) {
    const session = safeJson(row.sess, null);
    if (Number(session?.customerId) === Number(accountId)) {
      del.run(row.sid);
      deleted.push(row.sid);
    }
  }
  return deleted.length;
}

export function deleteCustomerPrivacyData(db, {
  customerAccountId,
  shopId = null,
  reason = null,
  requestedBy = 'customer',
  metadata = {},
} = {}) {
  ensureLegalComplianceSchema(db);
  const account = accountById(db, customerAccountId, shopId);
  const orders = matchingOrders(db, account);
  const now = sqlDatetime();

  let result;
  db.exec('BEGIN');
  try {
    const deletedSavedQuotes = db.prepare(`
      DELETE FROM customer_saved_quotes
      WHERE shop_id = ? AND customer_account_id = ?
    `).run(account.shop_id, account.id).changes;
    const deletedResetTokens = db.prepare(`
      DELETE FROM customer_reset_tokens
      WHERE shop_id = ? AND customer_account_id = ?
    `).run(account.shop_id, account.id).changes;
    const deletedCustomerRows = db.prepare(`
      DELETE FROM customers
      WHERE shop_id = ? AND LOWER(email) = LOWER(?)
    `).run(account.shop_id, account.email).changes;
    const deletedSessions = deleteCustomerAppSessions(db, account.id);
    db.prepare(`
      DELETE FROM customer_accounts
      WHERE id = ? AND shop_id = ?
    `).run(account.id, account.shop_id);
    db.prepare(`
      INSERT INTO privacy_requests (
        shop_id, customer_account_id, requester_email, request_type,
        requested_by, status, reason, retained_order_count, metadata_json, completed_at
      )
      VALUES (?, NULL, ?, 'delete_account', ?, 'completed', ?, ?, ?, ?)
    `).run(
      account.shop_id,
      account.email,
      requestedBy || 'customer',
      reason || null,
      orders.length,
      JSON.stringify({
        ...metadata,
        deleted_saved_quotes: deletedSavedQuotes,
        deleted_reset_tokens: deletedResetTokens,
        deleted_customer_rows: deletedCustomerRows,
        deleted_sessions: deletedSessions,
      }),
      now
    );
    result = {
      deletedSavedQuotes,
      deletedResetTokens,
      deletedCustomerRows,
      deletedSessions,
    };
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
  return {
    ok: true,
    customer_email: account.email,
    retained_orders: orders.length,
    ...result,
  };
}
