import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const backend = resolve(root, 'backend');
const tempRoot = mkdtempSync(join(tmpdir(), 'rfdewi-backup-smoke-'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

try {
  const fixtureDir = join(tempRoot, 'fixture');
  const backupRoot = join(tempRoot, 'backups');
  const uploadsDir = join(fixtureDir, 'uploads');
  const tempBin = join(tempRoot, 'bin');
  const dbPath = join(fixtureDir, 'rfdewi.db');
  const envPath = join(fixtureDir, 'backend.env');
  const nginxPath = join(fixtureDir, 'nginx.conf');

  mkdirSync(join(uploadsDir, 'models'), { recursive: true });
  mkdirSync(tempBin, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE smoke_backup (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
  db.prepare('INSERT INTO smoke_backup (label) VALUES (?)').run('backup smoke row');
  db.close();

  writeFileSync(envPath, [
    'NODE_ENV=production',
    'BASE_URL=https://app.trennen.co.nz',
    'SESSION_SECRET=backup-smoke-session-secret',
    '',
  ].join('\n'));
  chmodSync(envPath, 0o600);
  writeFileSync(join(uploadsDir, 'models', 'example.stl'), 'solid smoke\nendsolid smoke\n');
  writeFileSync(nginxPath, 'server { listen 80; server_name example.test; }\n');

  // Prevent the smoke from touching any real PM2 daemon while still exercising warning capture.
  const pm2Shim = join(tempBin, 'pm2');
  writeFileSync(pm2Shim, '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(pm2Shim, 0o755);
  const dateShim = join(tempBin, 'date');
  writeFileSync(dateShim, '#!/usr/bin/env bash\nprintf "%s\\n" "20260526-120000"\n');
  chmodSync(dateShim, 0o755);

  execFileSync('bash', ['scripts/backup-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      BACKUP_ROOT: backupRoot,
      DB_PATH: dbPath,
      ENV_PATH: envPath,
      UPLOADS_DIR: uploadsDir,
      NGINX_SITE: nginxPath,
      PATH: `${tempBin}:${process.env.PATH || ''}`,
      HOME: join(tempRoot, 'home'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const backupDirs = readdirSync(backupRoot).sort();
  assert.equal(backupDirs.length, 1, 'backup script should create one timestamped bundle');
  const backupDir = join(backupRoot, backupDirs[0]);
  const backupDirMode = statSync(backupDir).mode & 0o777;
  assert.equal(backupDirMode, 0o700, 'backup bundle directory should be private to the owner');

  for (const expected of ['rfdewi.db', 'backend.env', 'uploads.tar.gz', 'nginx-3d-quote-website.conf', 'manifest.json']) {
    assert.ok(existsSync(join(backupDir, expected)), `backup bundle should include ${expected}`);
  }
  for (const sensitive of ['rfdewi.db', 'backend.env', 'uploads.tar.gz']) {
    const mode = statSync(join(backupDir, sensitive)).mode & 0o777;
    assert.equal(mode, 0o600, `${sensitive} should not be group/world-readable`);
  }

  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sourceAppDir, root, 'manifest should record the source app directory');
  assert.equal(manifest.backupDir, backupDir, 'manifest should record the backup bundle directory');
  assert.ok(Array.isArray(manifest.files), 'manifest should list backup files');
  assert.ok(Array.isArray(manifest.warnings), 'manifest should preserve non-fatal backup warnings');

  for (const file of manifest.files) {
    const path = join(backupDir, file.name);
    assert.equal(statSync(path).size, file.bytes, `manifest size should match ${file.name}`);
    assert.equal(sha256(path), file.sha256, `manifest hash should match ${file.name}`);
  }

  const restoredDb = new DatabaseSync(join(backupDir, 'rfdewi.db'));
  const row = restoredDb.prepare('SELECT label FROM smoke_backup WHERE id = 1').get();
  restoredDb.close();
  assert.equal(row?.label, 'backup smoke row', 'backed-up SQLite database should be readable and restorable');

  const envMode = statSync(join(backupDir, 'backend.env')).mode & 0o777;
  assert.equal(envMode, 0o600, 'backed-up environment file should be owner-readable only');

  const tarList = execFileSync('tar', ['-tzf', join(backupDir, 'uploads.tar.gz')], { encoding: 'utf8' });
  assert.match(tarList, new RegExp(`${basename(uploadsDir)}/models/example\\.stl`), 'uploads archive should contain uploaded files');

  execFileSync('bash', ['scripts/backup-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      BACKUP_ROOT: backupRoot,
      DB_PATH: dbPath,
      ENV_PATH: envPath,
      UPLOADS_DIR: uploadsDir,
      NGINX_SITE: nginxPath,
      PATH: `${tempBin}:${process.env.PATH || ''}`,
      HOME: join(tempRoot, 'home'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const backupDirsAfterSecondRun = readdirSync(backupRoot).sort();
  assert.equal(backupDirsAfterSecondRun.length, 2, 'same-second backups should create separate bundles instead of reusing a directory');

  console.log('Runtime backup smoke checks passed.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
