import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../..');
const sourceBackend = join(repoRoot, 'backend');
const tempRoot = mkdtempSync(join(tmpdir(), 'rfdewi-migration-catalog-'));
const tempBackend = join(tempRoot, 'backend');
let server = null;

function copyBackend() {
  cpSync(sourceBackend, tempBackend, {
    recursive: true,
    filter(src) {
      const rel = relative(sourceBackend, src);
      if (!rel) return true;
      const first = rel.split(sep)[0];
      return !['data', 'node_modules'].includes(first);
    },
  });

  const sourceNodeModules = join(sourceBackend, 'node_modules');
  if (!existsSync(sourceNodeModules)) {
    throw new Error('backend/node_modules is missing. Run npm install before migration catalog smoke.');
  }
  symlinkSync(sourceNodeModules, join(tempBackend, 'node_modules'), 'dir');
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: tempBackend,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SESSION_SECRET: 'migration-catalog-session-secret',
      JWT_SECRET: 'migration-catalog-jwt-secret',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'migration-catalog-encryption-key',
      ...env,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function createDemoShop() {
  const db = new DatabaseSync(join(tempBackend, 'data/rfdewi.db'));
  try {
    db.prepare(`
      INSERT OR IGNORE INTO shops (name, slug, email, password_hash, plan)
      VALUES ('Mahi3D', 'mahi3d', 'owner@mahi3d-demo.test', 'migration-smoke-password-hash', 'starter')
    `).run();
  } finally {
    db.close();
  }
}

async function waitForServer(baseUrl) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = new Error(`/api/health returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error('Server did not start');
}

try {
  copyBackend();
  run('node', ['db/migrate.js']);
  createDemoShop();
  run('node', ['scripts/seed-mahi3d-demo.js'], { ALLOW_MAHI3D_DEMO_SEED: '1' });

  const port = 3620 + Math.floor(Math.random() * 1000);
  const logs = [];
  server = spawn('node', ['server.js'], {
    cwd: tempBackend,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      SESSION_SECRET: 'migration-catalog-session-secret',
      JWT_SECRET: 'migration-catalog-jwt-secret',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'migration-catalog-encryption-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => logs.push(chunk.toString()));
  server.stderr.on('data', chunk => logs.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);

  const res = await fetch(`${baseUrl}/api/customer/catalog?shop=mahi3d`);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`/api/customer/catalog?shop=mahi3d returned ${res.status}: ${body}\n${logs.join('')}`);
  }
  const catalog = JSON.parse(body);
  if (!Array.isArray(catalog.materials) || catalog.materials.length < 1) {
    throw new Error('Catalog did not return demo materials.');
  }
  if (!catalog.settings || typeof catalog.settings !== 'object') {
    throw new Error('Catalog did not return material page settings.');
  }
  const first = catalog.materials[0];
  for (const key of ['production_days_min', 'max_x_mm', 'colours', 'finishes']) {
    if (!(key in first)) throw new Error(`Catalog material is missing ${key}.`);
  }

  console.log(`Migration catalog smoke checks passed from ${basename(tempRoot)}.`);
} finally {
  if (server && !server.killed) server.kill();
  try {
    const nodeModules = join(tempBackend, 'node_modules');
    if (existsSync(nodeModules)) readlinkSync(nodeModules);
  } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
}
