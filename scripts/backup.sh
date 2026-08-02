#!/bin/bash
#
# Encrypted backup of the AN-30 PostgreSQL database and uploaded attachments.
#
# Produces two artefacts per run, both AES-256 encrypted with a passphrase that
# lives only in a root-only file:
#   an30-db-<stamp>.dump.zst.gpg       custom-format pg_dump, restorable per table
#   an30-uploads-<stamp>.tar.zst.gpg   the attachments volume
#
# The dump is verified with pg_restore --list before it is kept, so a corrupt
# archive is never allowed to silently replace a good one. Nothing here prints
# the passphrase or any database contents.
#
# Usage:
#   sudo AN30_SECRETS_DIR=/etc/an30/secrets ./scripts/backup.sh
#
# Environment:
#   AN30_ENV_FILE      compose env file            (default /etc/an30/staging.env)
#   AN30_SECRETS_DIR   compose secrets directory   (default /etc/an30/secrets)
#   AN30_BACKUP_DIR    destination                 (default /var/backups/an30)
#   AN30_APP_DIR       compose project directory   (default /opt/an30/app)
#   AN30_RETAIN_DAYS   how long to keep archives   (default 14)

set -euo pipefail

env_file=${AN30_ENV_FILE:-/etc/an30/staging.env}
secrets_dir=${AN30_SECRETS_DIR:-/etc/an30/secrets}
backup_dir=${AN30_BACKUP_DIR:-/var/backups/an30}
app_dir=${AN30_APP_DIR:-/opt/an30/app}
retain_days=${AN30_RETAIN_DAYS:-14}
passphrase_file="$secrets_dir/backup_passphrase.txt"

log() { printf '{"level":"info","service":"backup","event":"%s","message":"%s"}\n' "$1" "$2"; }
fail() { printf '{"level":"error","service":"backup","event":"%s","message":"%s"}\n' "$1" "$2" >&2; exit 1; }

[ -r "$env_file" ] || fail "config.missing" "Env file $env_file is not readable"
[ -d "$app_dir" ] || fail "config.missing" "Application directory $app_dir does not exist"

# The passphrase is generated once and then never rotated automatically: a new
# passphrase would make every existing archive unrestorable.
umask 077
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
if [ ! -s "$passphrase_file" ]; then
  openssl rand -base64 48 | tr -d '\n' > "$passphrase_file"
  chmod 400 "$passphrase_file"
  log "passphrase.created" "Backup passphrase generated; store a copy offline or restores become impossible"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
compose=(docker compose --env-file "$env_file")
cd "$app_dir"

encrypt_to() {
  # Reads plaintext on stdin, writes an encrypted artefact atomically.
  local target=$1
  gpg --batch --quiet --yes --symmetric --cipher-algo AES256 \
      --passphrase-file "$passphrase_file" --pinentry-mode loopback \
      --output "$target.tmp"
  mv "$target.tmp" "$target"
  chmod 400 "$target"
}

# ---- database -------------------------------------------------------------
db_plain="$backup_dir/.an30-db-$stamp.dump"
db_target="$backup_dir/an30-db-$stamp.dump.zst.gpg"

log "database.started" "Dumping PostgreSQL"
# The dump is written and verified inside the container: pg_restore lives only
# there, and its --list on a custom-format archive needs a seekable file, which
# a pipe from the host is not. A truncated dump must never be promoted over
# yesterday's good one, so a failed check aborts before anything is encrypted.
if ! AN30_SECRETS_DIR="$secrets_dir" "${compose[@]}" exec -T postgres sh -c '
      set -e
      PGPASSWORD=$(cat /run/secrets/postgres_password)
      export PGPASSWORD
      pg_dump -Fc -U an30 -d an30 > /tmp/an30-backup.dump
      pg_restore --list /tmp/an30-backup.dump > /dev/null
      cat /tmp/an30-backup.dump
      rm -f /tmp/an30-backup.dump
    ' > "$db_plain" 2>/dev/null; then
  rm -f "$db_plain"
  AN30_SECRETS_DIR="$secrets_dir" "${compose[@]}" exec -T postgres rm -f /tmp/an30-backup.dump 2>/dev/null || true
  fail "database.corrupt" "pg_dump output failed verification and was discarded"
fi
db_bytes=$(wc -c < "$db_plain")
[ "$db_bytes" -gt 1024 ] || { rm -f "$db_plain"; fail "database.too_small" "Dump is only $db_bytes bytes"; }

zstd -q -19 -c "$db_plain" | encrypt_to "$db_target"
rm -f "$db_plain"
log "database.completed" "Database archive written ($db_bytes bytes before compression)"

# ---- uploaded attachments -------------------------------------------------
uploads_target="$backup_dir/an30-uploads-$stamp.tar.zst.gpg"
uploads_volume="${AN30_COMPOSE_PROJECT:-an30}_uploads_data"
log "uploads.started" "Archiving attachment volume $uploads_volume"
# Read-only mount through the already present alpine-based image, so the backup
# needs no extra download and cannot modify what it is copying.
docker run --rm -v "$uploads_volume:/data/uploads:ro" postgres:18-alpine \
  tar -cf - -C /data/uploads . 2>/dev/null \
  | zstd -q -19 -c | encrypt_to "$uploads_target"
log "uploads.completed" "Attachment archive written"

# ---- retention ------------------------------------------------------------
removed=$(find "$backup_dir" -maxdepth 1 -name 'an30-*.gpg' -mtime "+$retain_days" -print -delete | wc -l)
log "retention.applied" "Removed $removed archive(s) older than $retain_days days"

log "completed" "Backup finished: $(basename "$db_target"), $(basename "$uploads_target")"
