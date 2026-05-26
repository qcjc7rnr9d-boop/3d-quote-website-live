import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const server = read('backend/server.js');
const settings = read('backend/routes/settings.js');
const materials = read('backend/routes/materials.js');

for (const [label, source, uploadDir, field, limitPattern, singlePattern] of [
  ['logo uploads', settings, 'uploads/logos', 'logo', /limits:\s*\{\s*fileSize:\s*2\s*\*\s*1024\s*\*\s*1024/, /logoUpload\.single\('logo'\)/],
  ['material asset uploads', materials, 'uploads/material-assets', 'asset', /limits:\s*\{\s*fileSize:\s*5\s*\*\s*1024\s*\*\s*1024/, /upload\.single\('asset'\)/],
]) {
  assert.match(source, /multer\.memoryStorage\(\)/, `${label} should keep uploads in memory until validated`);
  assert.match(source, limitPattern, `${label} should have a bounded upload size`);
  for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.match(source, new RegExp(mime.replace('/', '\\/')), `${label} should allow ${mime}`);
  }
  assert.match(source, /verifiedImageExtension\(req\.file\)/, `${label} should verify image magic bytes before writing`);
  assert.match(source, new RegExp(`${uploadDir.replace('/', '\\/')}',\\s*String\\(req\\.shop\\.id\\)`), `${label} should write into a shop-scoped upload directory`);
  assert.match(source, singlePattern, `${label} should accept only the expected single file field ${field}`);
  assert.doesNotMatch(source, /writeFileSync\([^)]*originalname/, `${label} should not use client-provided originalname for storage`);
  assert.doesNotMatch(source, /res\.status\(201\)[\s\S]{0,160}originalname/, `${label} should not return client-provided originalname as the public path`);
}

assert.match(
  settings,
  /safePrefix = `\/uploads\/logos\/\$\{shopId\}\/`/,
  'settings saves should only accept logo URLs under the current shop upload directory',
);
assert.match(
  materials,
  /safePrefix = `\/uploads\/material-assets\/\$\{shopId\}\/`/,
  'material saves should only accept asset URLs under the current shop upload directory',
);
assert.ok(
  server.includes("app.use('/uploads'") && server.includes("/\\.(?:png|jpe?g|webp|gif)$/i.test(req.path)"),
  'public uploads should only serve image extensions',
);
assert.match(server, /dotfiles:\s*'deny'/, 'static file serving should deny dotfiles');
assert.match(server, /index:\s*false/, 'static file serving should not expose directory indexes');
assert.match(server, /X-Content-Type-Options'[\s\S]*nosniff/, 'public uploads should set nosniff');

console.log('Upload boundary smoke checks passed.');
