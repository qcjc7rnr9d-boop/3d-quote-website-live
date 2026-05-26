import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '../..');
const backend = resolve(root, 'backend');
const tempRoot = mkdtempSync(join(tmpdir(), 'rfdewi-restore-smoke-'));

function writeDb(path, label) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE smoke_restore (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
  db.prepare('INSERT INTO smoke_restore (label) VALUES (?)').run(label);
  db.close();
}

function readDbLabel(path) {
  const db = new DatabaseSync(path);
  const row = db.prepare('SELECT label FROM smoke_restore WHERE id = 1').get();
  db.close();
  return row?.label;
}

function runBackup({ sourceApp, backupRoot, sourceDb, sourceEnv, sourceUploads, sourceNginx, homeDir, binDir }) {
  execFileSync('bash', ['scripts/backup-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      BACKUP_ROOT: backupRoot,
      DB_PATH: sourceDb,
      ENV_PATH: sourceEnv,
      UPLOADS_DIR: sourceUploads,
      NGINX_SITE: sourceNginx,
      HOME: homeDir,
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const dirs = readdirSync(backupRoot).sort();
  assert.equal(dirs.length, 1, 'backup script should create one bundle for restore smoke');
  return join(backupRoot, dirs[0]);
}

try {
  const sourceApp = join(tempRoot, 'source-app');
  const targetApp = join(tempRoot, 'target-app');
  const backupRoot = join(tempRoot, 'backups');
  const rollbackRoot = join(tempRoot, 'rollbacks');
  const sourceUploads = join(sourceApp, 'uploads');
  const targetUploads = join(targetApp, 'uploads');
  const sourceDb = join(sourceApp, 'backend', 'data', 'rfdewi.db');
  const targetDb = join(targetApp, 'backend', 'data', 'rfdewi.db');
  const sourceEnv = join(sourceApp, 'backend', '.env');
  const targetEnv = join(targetApp, 'backend', '.env');
  const sourceNginx = join(tempRoot, 'source-nginx.conf');
  const targetNginx = join(tempRoot, 'target-nginx.conf');
  const dangerousUploads = join(tempRoot, 'dangerous-target-not-uploads');
  const homeDir = join(tempRoot, 'home');
  const binDir = join(tempRoot, 'bin');
  const pm2Log = join(tempRoot, 'pm2.log');

  mkdirSync(join(sourceUploads, 'models'), { recursive: true });
  mkdirSync(join(targetUploads, 'models'), { recursive: true });
  mkdirSync(join(sourceEnv, '..'), { recursive: true });
  mkdirSync(join(targetEnv, '..'), { recursive: true });
  mkdirSync(join(homeDir, '.pm2'), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeDb(sourceDb, 'restored row');
  writeDb(targetDb, 'pre-restore row');
  writeFileSync(sourceEnv, 'NODE_ENV=production\nSESSION_SECRET=restored-secret\n');
  chmodSync(sourceEnv, 0o600);
  writeFileSync(targetEnv, 'NODE_ENV=development\nSESSION_SECRET=old-secret\n');
  chmodSync(targetEnv, 0o600);
  writeFileSync(join(sourceUploads, 'models', 'restored.stl'), 'solid restored\nendsolid restored\n');
  writeFileSync(join(targetUploads, 'models', 'stale.stl'), 'solid stale\nendsolid stale\n');
  writeFileSync(sourceNginx, 'server { server_name restored.example; }\n');
  writeFileSync(targetNginx, 'server { server_name stale.example; }\n');
  writeFileSync(join(homeDir, '.pm2', 'dump.pm2'), '{"apps":[{"name":"smoke"}]}\n');

  const pm2Shim = join(binDir, 'pm2');
  writeFileSync(pm2Shim, [
    '#!/usr/bin/env bash',
    `printf '%s\\n' "$*" >> ${JSON.stringify(pm2Log)}`,
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(pm2Shim, 0o755);

  const backupDir = runBackup({
    sourceApp,
    backupRoot,
    sourceDb,
    sourceEnv,
    sourceUploads,
    sourceNginx,
    homeDir,
    binDir,
  });

  const missingConfirm = spawnSync('bash', ['scripts/restore-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      BACKUP_DIR: backupDir,
      DB_PATH: targetDb,
      ENV_PATH: targetEnv,
      UPLOADS_DIR: targetUploads,
      ROLLBACK_ROOT: join(tempRoot, 'missing-confirm-rollbacks'),
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    encoding: 'utf8',
  });
  assert.notEqual(missingConfirm.status, 0, 'restore should require explicit confirmation');
  assert.match(missingConfirm.stderr, /RESTORE_CONFIRM=restore-runtime-state/, 'missing confirmation should explain the required safety flag');
  assert.equal(readDbLabel(targetDb), 'pre-restore row', 'missing confirmation should happen before target DB overwrite');

  mkdirSync(dangerousUploads, { recursive: true });
  writeFileSync(join(dangerousUploads, 'do-not-delete.txt'), 'restore safety marker\n');
  const unsafeUploads = spawnSync('bash', ['scripts/restore-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      RESTORE_CONFIRM: 'restore-runtime-state',
      BACKUP_DIR: backupDir,
      DB_PATH: targetDb,
      ENV_PATH: targetEnv,
      UPLOADS_DIR: dangerousUploads,
      ROLLBACK_ROOT: join(tempRoot, 'unsafe-upload-rollbacks'),
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    encoding: 'utf8',
  });
  assert.notEqual(unsafeUploads.status, 0, 'restore should reject an uploads target that is not an uploads directory');
  assert.match(unsafeUploads.stderr, /UPLOADS_DIR/, 'unsafe uploads rejection should explain the unsafe path');
  assert.ok(existsSync(join(dangerousUploads, 'do-not-delete.txt')), 'unsafe uploads rejection should happen before deleting the target directory');
  assert.equal(readDbLabel(targetDb), 'pre-restore row', 'unsafe uploads rejection should happen before target DB overwrite');

  execFileSync('bash', ['scripts/restore-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      RESTORE_CONFIRM: 'restore-runtime-state',
      BACKUP_DIR: backupDir,
      DB_PATH: targetDb,
      ENV_PATH: targetEnv,
      UPLOADS_DIR: targetUploads,
      NGINX_SITE: targetNginx,
      PM2_DUMP: join(homeDir, '.pm2', 'dump.pm2'),
      PM2_APP_NAME: 'restore-smoke-app',
      ROLLBACK_ROOT: rollbackRoot,
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.equal(readDbLabel(targetDb), 'restored row', 'restore should replace the target SQLite database');
  assert.match(readFileSync(targetEnv, 'utf8'), /restored-secret/, 'restore should replace the target env file');
  assert.ok(existsSync(join(targetUploads, 'models', 'restored.stl')), 'restore should unpack uploaded files');
  assert.ok(!existsSync(join(targetUploads, 'models', 'stale.stl')), 'restore should remove stale uploaded files');
  assert.match(readFileSync(targetNginx, 'utf8'), /restored\.example/, 'restore should replace the Nginx config when configured');
  assert.match(readFileSync(pm2Log, 'utf8'), /stop restore-smoke-app/, 'restore should stop PM2 before replacing state');
  assert.match(readFileSync(pm2Log, 'utf8'), /restart restore-smoke-app --update-env/, 'restore should restart PM2 after replacing state');

  const rollbackDirs = readdirSync(rollbackRoot).sort();
  assert.equal(rollbackDirs.length, 1, 'restore should create one rollback snapshot of current state before overwrite');
  assert.equal(readDbLabel(join(rollbackRoot, rollbackDirs[0], 'rfdewi.db')), 'pre-restore row', 'rollback DB should preserve pre-restore state');

  const tamperedBackup = join(backupRoot, rollbackDirs[0] ? 'tampered' : 'tampered');
  mkdirSync(tamperedBackup, { recursive: true });
  execFileSync('cp', ['-R', `${backupDir}/.`, tamperedBackup]);
  writeFileSync(join(tamperedBackup, 'backend.env'), 'NODE_ENV=production\nSESSION_SECRET=tampered\n');

  const rejectTargetDb = join(tempRoot, 'reject-target', 'backend', 'data', 'rfdewi.db');
  const rejectTargetEnv = join(tempRoot, 'reject-target', 'backend', '.env');
  const rejectUploads = join(tempRoot, 'reject-target', 'uploads');
  mkdirSync(join(rejectUploads, 'models'), { recursive: true });
  writeDb(rejectTargetDb, 'untouched row');
  writeFileSync(rejectTargetEnv, 'SESSION_SECRET=untouched\n');

  const tampered = spawnSync('bash', ['scripts/restore-runtime-state.sh'], {
    cwd: backend,
    env: {
      ...process.env,
      RESTORE_CONFIRM: 'restore-runtime-state',
      BACKUP_DIR: tamperedBackup,
      DB_PATH: rejectTargetDb,
      ENV_PATH: rejectTargetEnv,
      UPLOADS_DIR: rejectUploads,
      ROLLBACK_ROOT: join(tempRoot, 'reject-rollbacks'),
      PATH: `${binDir}:${process.env.PATH || ''}`,
    },
    encoding: 'utf8',
  });
  assert.notEqual(tampered.status, 0, 'restore should reject a backup whose manifest hash no longer matches');
  assert.equal(readDbLabel(rejectTargetDb), 'untouched row', 'hash rejection should happen before target DB overwrite');

  console.log('Runtime restore smoke checks passed.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
