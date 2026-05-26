#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_APP_DIR="$(cd "$DEFAULT_BACKEND_DIR/.." && pwd)"

APP_DIR="${APP_DIR:-$DEFAULT_APP_DIR}"
BACKEND_DIR="${BACKEND_DIR:-$APP_DIR/backend}"
BACKUP_DIR="${BACKUP_DIR:-}"
ROLLBACK_ROOT="${ROLLBACK_ROOT:-$HOME/3d-quote-restore-rollbacks}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ROLLBACK_DIR="$ROLLBACK_ROOT/pre-restore-$STAMP"

DB_PATH="${DB_PATH:-$BACKEND_DIR/data/rfdewi.db}"
ENV_PATH="${ENV_PATH:-$BACKEND_DIR/.env}"
UPLOADS_DIR="${UPLOADS_DIR:-$APP_DIR/uploads}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/3d-quote-website}"
PM2_DUMP="${PM2_DUMP:-$HOME/.pm2/dump.pm2}"
PM2_APP_NAME="${PM2_APP_NAME:-3d-quote-website}"

warn() {
  printf '%s\n' "$*" >&2
}

die() {
  warn "$*"
  exit 1
}

copy_to_path() {
  local source="$1"
  local destination="$2"
  local mode="${3:-}"

  mkdir -p "$(dirname "$destination")"
  if cp "$source" "$destination" 2>/dev/null; then
    [ -z "$mode" ] || chmod "$mode" "$destination"
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo cp "$source" "$destination"
    [ -z "$mode" ] || sudo chmod "$mode" "$destination"
    return 0
  fi

  return 1
}

assert_safe_restore_targets() {
  case "$UPLOADS_DIR" in
    ""|"/"|"/tmp"|"/var"|"/var/tmp"|"/private"|"/private/tmp"|"$HOME"|"$APP_DIR"|"$BACKEND_DIR")
      die "UPLOADS_DIR is unsafe for destructive restore: $UPLOADS_DIR"
      ;;
  esac

  if [ "$(basename "$UPLOADS_DIR")" != "uploads" ]; then
    die "UPLOADS_DIR must point at an uploads directory before restore: $UPLOADS_DIR"
  fi
}

snapshot_if_exists() {
  local source="$1"
  local destination="$2"
  local label="$3"

  if [ -e "$source" ]; then
    mkdir -p "$(dirname "$destination")"
    if [ -d "$source" ]; then
      tar -czf "$destination" -C "$(dirname "$source")" "$(basename "$source")"
    else
      cp "$source" "$destination"
    fi
  else
    warn "$label not found at $source; rollback snapshot skipped for this file."
  fi
}

[ -n "$BACKUP_DIR" ] || die "BACKUP_DIR is required."
[ "${RESTORE_CONFIRM:-}" = "restore-runtime-state" ] || die "Set RESTORE_CONFIRM=restore-runtime-state to restore runtime state."
[ -d "$BACKUP_DIR" ] || die "Backup directory does not exist: $BACKUP_DIR"
[ -f "$BACKUP_DIR/manifest.json" ] || die "Backup manifest not found: $BACKUP_DIR/manifest.json"
[ -f "$BACKUP_DIR/rfdewi.db" ] || die "Backup database not found: $BACKUP_DIR/rfdewi.db"
[ -f "$BACKUP_DIR/backend.env" ] || die "Backup environment file not found: $BACKUP_DIR/backend.env"
assert_safe_restore_targets

node - "$BACKUP_DIR" <<'NODE'
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const [backupDir] = process.argv.slice(2);
const manifestPath = join(backupDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (!Array.isArray(manifest.files)) {
  throw new Error('Backup manifest is missing a files array.');
}

for (const file of manifest.files) {
  const filePath = join(backupDir, file.name);
  if (!existsSync(filePath)) {
    throw new Error(`Backup file listed in manifest is missing: ${file.name}`);
  }
  const stat = statSync(filePath);
  if (stat.size !== file.bytes) {
    throw new Error(`Backup file size mismatch for ${file.name}: expected ${file.bytes}, got ${stat.size}`);
  }
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (hash !== file.sha256) {
    throw new Error(`Backup file hash mismatch for ${file.name}`);
  }
}
NODE

mkdir -p "$ROLLBACK_DIR"
snapshot_if_exists "$DB_PATH" "$ROLLBACK_DIR/rfdewi.db" "Current SQLite database"
snapshot_if_exists "$ENV_PATH" "$ROLLBACK_DIR/backend.env" "Current backend environment file"
snapshot_if_exists "$UPLOADS_DIR" "$ROLLBACK_DIR/uploads.tar.gz" "Current uploads directory"
snapshot_if_exists "$NGINX_SITE" "$ROLLBACK_DIR/nginx-3d-quote-website.conf" "Current Nginx site config"
snapshot_if_exists "$PM2_DUMP" "$ROLLBACK_DIR/pm2-dump.pm2" "Current PM2 dump"

if command -v pm2 >/dev/null 2>&1; then
  pm2 stop "$PM2_APP_NAME"
else
  warn "pm2 command not found; restore will continue without process stop/restart."
fi

copy_to_path "$BACKUP_DIR/rfdewi.db" "$DB_PATH"
copy_to_path "$BACKUP_DIR/backend.env" "$ENV_PATH" 600

if [ -f "$BACKUP_DIR/uploads.tar.gz" ]; then
  tmp_upload_restore="$(mktemp -d)"
  tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C "$tmp_upload_restore"
  extracted_uploads="$(find "$tmp_upload_restore" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$extracted_uploads" ] || die "Uploads archive did not contain a directory."
  rm -rf "$UPLOADS_DIR"
  mkdir -p "$UPLOADS_DIR"
  cp -a "$extracted_uploads/." "$UPLOADS_DIR/"
  rm -rf "$tmp_upload_restore"
else
  warn "Backup has no uploads.tar.gz; uploads directory not restored."
fi

if [ -f "$BACKUP_DIR/nginx-3d-quote-website.conf" ]; then
  copy_to_path "$BACKUP_DIR/nginx-3d-quote-website.conf" "$NGINX_SITE" || warn "Nginx config restore failed; restore continuing."
else
  warn "Backup has no Nginx config; Nginx restore skipped."
fi

if [ -f "$BACKUP_DIR/pm2-dump.pm2" ]; then
  copy_to_path "$BACKUP_DIR/pm2-dump.pm2" "$PM2_DUMP" || warn "PM2 dump restore failed; restore continuing."
else
  warn "Backup has no PM2 dump; PM2 dump restore skipped."
fi

if [ "${RUN_MIGRATE:-0}" = "1" ]; then
  (cd "$BACKEND_DIR" && npm run migrate)
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
  pm2 save >/dev/null 2>&1 || warn "pm2 save failed after restore."
fi

echo "Restored runtime state from $BACKUP_DIR"
echo "Pre-restore rollback snapshot: $ROLLBACK_DIR"
