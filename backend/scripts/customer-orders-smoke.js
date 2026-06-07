import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const customerRoutes = readFileSync('routes/customer-portal.js', 'utf8');
const customerDashboard = readFileSync('../customer/dashboard.html', 'utf8');
const customerLogin = readFileSync('../customer/login.html', 'utf8');

assert(packageJson.scripts?.['customer:orders-smoke'], 'package.json must expose customer:orders-smoke');
assert(customerRoutes.includes('/api/customer/orders'), 'Customer portal routes must expose customer orders');
assert(customerRoutes.includes('LOWER(customer_email) = LOWER(?)'), 'Customer order routes must scope by customer email');
assert(customerRoutes.includes('shop_id = ?'), 'Customer order routes must scope by shop');
assert(customerRoutes.includes('payment_status_label'), 'Customer order API must return payment status labels');
assert(customerRoutes.includes('fulfilment_status_label'), 'Customer order API must return fulfilment status labels');

assert(customerDashboard.includes('renderRecentOrders'), 'Customer dashboard must render overview recent orders');
assert(customerDashboard.includes('renderOrders'), 'Customer dashboard must render order detail cards');
assert(customerDashboard.includes('order-detail-card'), 'Customer dashboard must expose order details');
assert(customerDashboard.includes('fmtMoney(order.total)'), 'Customer order totals must be formatted consistently');
assert(customerDashboard.includes('payment_status'), 'Customer dashboard must consume payment status data');
assert(customerDashboard.includes('fulfilment_status'), 'Customer dashboard must consume fulfilment status data');
assert(!customerDashboard.includes('Mahi3D'), 'Customer dashboard must not show stale Mahi3D branding');

assert(
  /if\s*\(r\.ok\)\s*{[\s\S]{0,160}window\.location\.href\s*=\s*dashboardTarget\(slug\)/.test(customerLogin),
  'Customer login must redirect to the dashboard after a successful login'
);
assert(
  !/if\s*\(r\.ok\)\s*{[\s\S]{0,160}Check your email to verify your account before signing in/.test(customerLogin),
  'Customer login must not treat a successful login as an email verification warning'
);

console.log('Customer orders smoke checks passed.');
