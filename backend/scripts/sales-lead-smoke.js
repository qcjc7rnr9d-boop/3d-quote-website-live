import { randomUUID } from 'node:crypto';
import express from 'express';
import { db } from '../middleware/auth.js';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postLead(payload, expectedStatus = 201, targetBase = base) {
  const res = await fetch(`${targetBase}/api/sales/demo-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  assert(res.status === expectedStatus, `Expected ${expectedStatus}, got ${res.status}: ${text}`);
  return data;
}

const suffix = randomUUID().slice(0, 8);
const email = `operator-${suffix}@example.test`;

await postLead({
  name: '',
  email,
  company: 'LayerWorks',
  monthlyQuoteVolume: '26-100',
  message: 'We need to clean up our quote workflow.',
}, 400);

await postLead({
  name: 'Bot Field',
  email: `bot-${suffix}@example.test`,
  company: 'LayerWorks',
  monthlyQuoteVolume: '26-100',
  message: 'This should be silently accepted as spam.',
  website: 'https://spam.example',
}, 204);

const created = await postLead({
  name: 'Alex Operator',
  email,
  company: 'LayerWorks',
  monthlyQuoteVolume: '26-100',
  message: 'We quote dozens of FDM and resin jobs every month.',
});
assert(created.ok === true, 'Valid lead response should be ok');
assert(Number.isInteger(created.id), 'Valid lead response should include a numeric id');
assert(['queued', 'not_configured', 'failed'].includes(created.delivery?.status), 'Delivery status should be explicit');

const row = db.prepare('SELECT * FROM sales_demo_requests WHERE id = ?').get(created.id);
assert(row, 'Lead should be stored in sales_demo_requests');
assert(row.name === 'Alex Operator', 'Stored lead name mismatch');
assert(row.email === email.toLowerCase(), 'Stored lead email should be normalized');
assert(row.company === 'LayerWorks', 'Stored lead company mismatch');
assert(row.monthly_quote_volume === '26-100', 'Stored quote volume mismatch');
assert(/dozens of FDM/.test(row.message), 'Stored lead message mismatch');
assert(['queued', 'not_configured', 'failed'].includes(row.delivery_status), 'Stored delivery status should be explicit');

process.env.SALES_DEMO_RATE_LIMIT_MAX = '3';
const { default: salesRouter } = await import('../routes/sales.js');
const app = express();
app.use(express.json());
app.use('/api/sales', salesRouter);
const server = await new Promise(resolve => {
  const instance = app.listen(0, () => resolve(instance));
});

try {
  const limitedBase = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < 3; i += 1) {
    await postLead({
      name: `Limit Operator ${i}`,
      email: `limit-${suffix}-${i}@example.test`,
      company: 'LayerWorks',
      monthlyQuoteVolume: '26-100',
      message: 'Rate limit setup request.',
    }, 201, limitedBase);
  }
  const limited = await postLead({
    name: 'Limit Operator Final',
    email: `limit-${suffix}-final@example.test`,
    company: 'LayerWorks',
    monthlyQuoteVolume: '26-100',
    message: 'This request should be rate limited.',
  }, 429, limitedBase);
  assert(limited.ok === false, 'Rate-limited response should be explicit JSON');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log('Sales lead smoke checks passed.');
