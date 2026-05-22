#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-/opt/trennen/3d-quote-website/backend/data/rfdewi.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/trennen/backups/sqlite}"
KEEP_DAYS="${KEEP_DAYS:-14}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/rfdewi-$timestamp.db"

sqlite3 "$DB_PATH" ".backup '$backup_file'"
gzip -f "$backup_file"

find "$BACKUP_DIR" -type f -name 'rfdewi-*.db.gz' -mtime +"$KEEP_DAYS" -delete

echo "Created $backup_file.gz"
