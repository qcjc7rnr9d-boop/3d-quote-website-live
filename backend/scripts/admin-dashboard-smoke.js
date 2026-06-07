import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dashboardHtml = readFileSync('../admin/dashboard.html', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

assert(packageJson.scripts?.['admin-dashboard:smoke'], 'package.json must expose admin-dashboard:smoke');
assert(dashboardHtml.includes('/api/dashboard/stats'), 'Admin dashboard must load dashboard stats');
assert(dashboardHtml.includes('/api/orders?limit=5'), 'Admin dashboard must load recent orders');

assert(dashboardHtml.includes('function firstFinite('), 'Dashboard must tolerate camelCase and snake_case stat aliases');
assert(dashboardHtml.includes('function displayCount('), 'Dashboard must render valid zero counts as 0');
assert(dashboardHtml.includes('function displayMoney('), 'Dashboard must render valid zero money as NZ$0.00');
assert(!dashboardHtml.includes("s.total_orders ?? '—'"), 'Dashboard must not show dashes for valid zero total_orders');
assert(!dashboardHtml.includes("s.active_materials ?? '—'"), 'Dashboard must not show dashes for valid zero active_materials');
assert(!dashboardHtml.includes("s.customers ?? '—'"), 'Dashboard must not show dashes for valid zero customers');

assert(!dashboardHtml.includes('const orders = await r.json();'), 'Dashboard must not treat /api/orders response as a raw array');
assert(
  /const\s+data\s*=\s*await\s+r\.json\(\)[\s\S]{0,400}const\s+orders\s*=\s*Array\.isArray\(data\.orders\)/.test(dashboardHtml),
  'Dashboard must read orders from the /api/orders { orders } envelope'
);

assert(dashboardHtml.includes('Orders will appear here once customers checkout.'), 'Recent Orders empty state must use launch copy');
assert(dashboardHtml.includes('No recent store activity.'), 'Recent Activity must have a clean empty state');
assert(
  /catch\s*\(err\)\s*{[\s\S]{0,500}loadActivity\(\[\]\)/.test(dashboardHtml),
  'Dashboard must clear activity loading state on order load failure'
);
assert(!dashboardHtml.includes('statusBadge(o.status ||'), 'Dashboard must not use stale order.status for fulfilment');
assert(dashboardHtml.includes('statusBadge(o.fulfilment_status ||'), 'Dashboard must render fulfilment_status in recent orders');

console.log('Admin dashboard smoke checks passed.');
