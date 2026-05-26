#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$BACKEND_DIR/.." && pwd)"

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/3d-quote-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
WARNINGS_FILE="$BACKUP_DIR/.warnings"

DB_PATH="${DB_PATH:-$BACKEND_DIR/data/rfdewi.db}"
ENV_PATH="${ENV_PATH:-$BACKEND_DIR/.env}"
UPLOADS_DIR="${UPLOADS_DIR:-$APP_DIR/uploads}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/3d-quote-website}"

mkdir -p "$BACKUP_ROOT"
if [ -e "$BACKUP_DIR" ]; then
  suffix=1
  while [ -e "${BACKUP_DIR}-$suffix" ]; do
    suffix=$((suffix + 1))
  done
  BACKUP_DIR="${BACKUP_DIR}-$suffix"
  WARNINGS_FILE="$BACKUP_DIR/.warnings"
fi
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
: > "$WARNINGS_FILE"

warn() {
  printf '%s\n' "$*" | tee -a "$WARNINGS_FILE" >&2
}

copy_if_readable() {
  local source="$1"
  local destination="$2"
  local label="$3"

  if [ ! -e "$source" ]; then
    warn "$label not found at $source; skipped."
    return 0
  fi

  if [ -r "$source" ]; then
    cp "$source" "$destination"
    return 0
  fi

  if command -v sudo >/dev/null 2>&1 && sudo -n test -r "$source" 2>/dev/null; then
    sudo cp "$source" "$destination"
    sudo chown "$(id -u):$(id -g)" "$destination" 2>/dev/null || true
    return 0
  fi

  warn "$label exists but is not readable at $source; skipped."
}

if [ -f "$DB_PATH" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/rfdewi.db'"
  else
    warn "sqlite3 command not found; falling back to a plain database copy."
    cp "$DB_PATH" "$BACKUP_DIR/rfdewi.db"
  fi
  chmod 600 "$BACKUP_DIR/rfdewi.db"
else
  warn "SQLite database not found at $DB_PATH; skipped."
fi

copy_if_readable "$ENV_PATH" "$BACKUP_DIR/backend.env" "Backend environment file"
if [ -f "$BACKUP_DIR/backend.env" ]; then
  chmod 600 "$BACKUP_DIR/backend.env"
fi

if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  chmod 600 "$BACKUP_DIR/uploads.tar.gz"
else
  warn "Uploads directory not found at $UPLOADS_DIR; skipped."
fi

copy_if_readable "$NGINX_SITE" "$BACKUP_DIR/nginx-3d-quote-website.conf" "Nginx site config"

if command -v pm2 >/dev/null 2>&1; then
  pm2 save >/dev/null 2>&1 || warn "pm2 save failed; continuing without refreshing PM2 dump."
  copy_if_readable "$HOME/.pm2/dump.pm2" "$BACKUP_DIR/pm2-dump.pm2" "PM2 dump"
else
  warn "pm2 command not found; PM2 dump skipped."
fi

node - "$BACKUP_DIR" "$APP_DIR" "$WARNINGS_FILE" <<'NODE'
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [backupDir, appDir, warningsPath] = process.argv.slice(2);
const warnings = existsSync(warningsPath)
  ? readFileSync(warningsPath, 'utf8').split('\n').filter(Boolean)
  : [];

const files = readdirSync(backupDir)
  .filter(name => name !== 'manifest.json' && name !== '.warnings')
  .map(name => {
    const path = join(backupDir, name);
    const stat = statSync(path);
    return {
      name,
      bytes: stat.size,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
  createdAt: new Date().toISOString(),
  sourceAppDir: appDir,
  backupDir,
  files,
  warnings,
}, null, 2));
NODE

rm -f "$WARNINGS_FILE"

echo "Backup written to $BACKUP_DIR"
echo "Manifest: $BACKUP_DIR/manifest.json"
