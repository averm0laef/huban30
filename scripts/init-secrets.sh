#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
secrets_dir=${AN30_SECRETS_DIR:-"$project_root/secrets"}

umask 077
mkdir -p "$secrets_dir"
# The directory stays owner-only, so no other host account can reach the files.
chmod 700 "$secrets_dir"

# Compose mounts each secret as a bind mount that keeps the host file's owner
# and mode. API, worker and migrate run as unprivileged container users, so a
# root-owned 0600 file is unreadable inside the container and the service dies
# with EACCES. The files are therefore read-only to everyone and protected by
# the 0700 directory above, which is what actually keeps them private on the
# host. Nothing but root can write them.
secret_mode=444

generate_secret() {
  target="$secrets_dir/$1"
  if [ ! -s "$target" ]; then
    openssl rand -base64 48 | tr -d '\n' > "$target"
  fi
  chmod "$secret_mode" "$target"
}

generate_secret postgres_password.txt
generate_secret app_database_password.txt
generate_secret redis_password.txt
generate_secret session_secret.txt
generate_secret data_encryption_key.txt
generate_secret sandbox_payment_webhook_secret.txt

# Optional integration credentials are intentionally empty until the owner
# enables the matching adapter and supplies the real value.
for optional_secret in smtp_password.txt telegram_bot_token.txt vk_access_token.txt \
  rossko_key1.txt rossko_key2.txt gemini_api_key.txt; do
  target="$secrets_dir/$optional_secret"
  if [ ! -e "$target" ]; then
    : > "$target"
  fi
  chmod "$secret_mode" "$target"
done

echo "Secrets ready in $secrets_dir (dir 700, files $secret_mode). Values were not printed."
