#!/bin/bash
# Release one commit to the closed production on the Beget VPS (docs/OPERATIONS.md, «Публичная витрина на Beget»).
#
#   On the developer's machine, from the repository root, with the commit pushed and CI green:
#     git archive --format=tar.gz -o /tmp/an30-<sha>.tar.gz <sha>
#     scp -i ~/.ssh/an30_deploy /tmp/an30-<sha>.tar.gz scripts/deploy/production-release.sh root@45.153.190.25:/tmp/
#     ssh -i ~/.ssh/an30_deploy root@45.153.190.25 'nohup bash /tmp/production-release.sh <sha> > /tmp/an30-release-<sha>.log 2>&1 &'
#
# What it does, in order, stopping at the first failure: an encrypted backup of the database and uploads, the new
# tree in /opt/an30/releases/<sha> beside the old ones, a config check, build and start of the compose project
# an30-production with /etc/an30/production.env (the site password and every key stay in that file), the state.
# The previous release stays on disk: rolling back is the same command with the previous sha.
set -euo pipefail
sha=${1:?usage: production-release.sh <commit sha>}
archive=/tmp/an30-$sha.tar.gz
release=/opt/an30/releases/$sha
env_file=/etc/an30/production.env
export AN30_SECRETS_DIR=/etc/an30/production-secrets COMPOSE_PROJECT_NAME=an30-production

[ -s "$archive" ] || { echo "no archive $archive"; exit 1; }
grep -q '^SITE_PASSWORD_ENABLED=true' "$env_file" || echo "WARNING: the site password is off in $env_file"

echo "== new tree $release: $(date -u +%FT%TZ)"
mkdir -p "$release"
tar xzf "$archive" -C "$release"

echo "== backup before the release"
# The running release's folder (none when production is stopped: the backup then reads the new tree's compose.yaml).
current=$({ docker compose ls --all --filter name=an30-production --format json || true; } | { grep -o '"ConfigFiles":"[^"]*' || true; } | head -1 | sed 's/.*:"//; s/,.*//; s#/compose.yaml##')
AN30_ENV_FILE=$env_file AN30_APP_DIR=${current:-$release} AN30_COMPOSE_PROJECT=an30-production bash "$release/scripts/backup.sh"

cd "$release"
dc() { docker compose -p an30-production --env-file "$env_file" "$@"; }
echo "== config"
dc config -q
echo "== build and start: $(date -u +%FT%TZ)"
dc up -d --build 2>&1 | tail -40
echo "== state: $(date -u +%FT%TZ)"
dc ps -a --format "table {{.Service}}\t{{.Status}}"
dc run --rm migrate node dist/migrate.js status 2>&1 | tail -3
echo "== DONE $sha"
