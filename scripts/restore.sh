#!/bin/bash
#
# Restores an AN-30 backup produced by scripts/backup.sh.
#
# By default it restores into a throwaway database and reports what it found,
# which is how the restore drill is run without touching live data. Restoring
# over the real database requires an explicit, deliberate flag.
#
# Usage:
#   sudo AN30_SECRETS_DIR=/etc/an30/secrets ./scripts/restore.sh --verify  <archive.dump.zst.gpg>
#   sudo AN30_SECRETS_DIR=/etc/an30/secrets ./scripts/restore.sh --into-production <archive.dump.zst.gpg>
#
# --verify           restore into a temporary database, count rows, drop it
# --into-production  overwrite the live database, only after typing the confirmation

set -euo pipefail

env_file=${AN30_ENV_FILE:-/etc/an30/staging.env}
secrets_dir=${AN30_SECRETS_DIR:-/etc/an30/secrets}
app_dir=${AN30_APP_DIR:-/opt/an30/app}
passphrase_file="$secrets_dir/backup_passphrase.txt"

log() { printf '{"level":"info","service":"restore","event":"%s","message":"%s"}\n' "$1" "$2"; }
fail() { printf '{"level":"error","service":"restore","event":"%s","message":"%s"}\n' "$1" "$2" >&2; exit 1; }

# See scripts/backup.sh: gpg needs a writable home, which a hardened systemd
# unit or a locked-down shell may not provide at the default location.
GNUPGHOME=$(mktemp -d)
export GNUPGHOME
chmod 700 "$GNUPGHOME"
trap 'rm -rf "$GNUPGHOME"' EXIT INT TERM

mode=${1:-}
archive=${2:-}
[ -n "$mode" ] && [ -n "$archive" ] || fail "usage" "Usage: restore.sh --verify|--into-production <archive>"
[ -r "$archive" ] || fail "archive.missing" "Archive $archive is not readable"
[ -r "$passphrase_file" ] || fail "passphrase.missing" "Backup passphrase $passphrase_file is not readable"

cd "$app_dir"
compose=(docker compose --env-file "$env_file")
export AN30_SECRETS_DIR="$secrets_dir"

decrypt() {
  gpg --batch --quiet --decrypt --passphrase-file "$passphrase_file" --pinentry-mode loopback "$archive" | zstd -q -d -c
}

psql_super() {
  "${compose[@]}" exec -T postgres sh -c "PGPASSWORD=\$(cat /run/secrets/postgres_password) psql -U an30 -d postgres -tAc \"$1\""
}

case "$mode" in
  --verify)
    scratch="an30_restore_check_$(date -u +%s)"
    log "verify.started" "Restoring into throwaway database $scratch"
    psql_super "CREATE DATABASE $scratch OWNER an30;" > /dev/null

    # The restore is expected to emit ownership notices; only a hard failure matters.
    if ! decrypt | "${compose[@]}" exec -T postgres sh -c \
        "PGPASSWORD=\$(cat /run/secrets/postgres_password) pg_restore -U an30 -d $scratch --no-owner --no-privileges" 2>/dev/null; then
      psql_super "DROP DATABASE IF EXISTS $scratch;" > /dev/null
      fail "verify.failed" "pg_restore could not rebuild the archive"
    fi

    tables=$("${compose[@]}" exec -T postgres sh -c \
      "PGPASSWORD=\$(cat /run/secrets/postgres_password) psql -U an30 -d $scratch -tAc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='app'\"" | tr -d '[:space:]')
    orders=$("${compose[@]}" exec -T postgres sh -c \
      "PGPASSWORD=\$(cat /run/secrets/postgres_password) psql -U an30 -d $scratch -tAc \"SELECT count(*) FROM app.orders\"" | tr -d '[:space:]')
    products=$("${compose[@]}" exec -T postgres sh -c \
      "PGPASSWORD=\$(cat /run/secrets/postgres_password) psql -U an30 -d $scratch -tAc \"SELECT count(*) FROM app.products\"" | tr -d '[:space:]')

    psql_super "DROP DATABASE IF EXISTS $scratch;" > /dev/null

    [ "${tables:-0}" -ge 40 ] || fail "verify.schema" "Restored schema has only ${tables:-0} tables in app"
    log "verify.completed" "Archive is restorable: $tables tables, $products products, $orders orders"
    ;;

  --into-production)
    printf 'This overwrites the live database with %s.\nType RESTORE to continue: ' "$(basename "$archive")"
    read -r answer
    [ "$answer" = "RESTORE" ] || fail "aborted" "Confirmation not given"

    log "production.started" "Stopping application containers"
    "${compose[@]}" stop api worker web > /dev/null

    log "production.restoring" "Rebuilding the database from the archive"
    if ! decrypt | "${compose[@]}" exec -T postgres sh -c \
        "PGPASSWORD=\$(cat /run/secrets/postgres_password) pg_restore -U an30 -d an30 --clean --if-exists --no-owner --no-privileges" 2>/dev/null; then
      fail "production.failed" "Restore failed; application left stopped for inspection"
    fi

    log "production.starting" "Starting application containers"
    "${compose[@]}" up -d > /dev/null
    log "production.completed" "Restore finished; verify /health/ready before announcing recovery"
    ;;

  *)
    fail "usage" "Unknown mode $mode"
    ;;
esac
