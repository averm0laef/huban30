#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
secrets_dir=${AN30_SECRETS_DIR:-"$project_root/secrets"}

umask 077
mkdir -p "$secrets_dir"

generate_secret() {
  target="$secrets_dir/$1"
  if [ ! -s "$target" ]; then
    openssl rand -base64 48 | tr -d '\n' > "$target"
    chmod 600 "$target"
  fi
}

generate_secret postgres_password.txt
generate_secret app_database_password.txt
generate_secret redis_password.txt
generate_secret session_secret.txt
generate_secret data_encryption_key.txt
generate_secret sandbox_payment_webhook_secret.txt

# Optional integration credentials are intentionally empty until the owner
# enables the matching adapter and supplies the real value.
for optional_secret in smtp_password.txt telegram_bot_token.txt vk_access_token.txt; do
  target="$secrets_dir/$optional_secret"
  if [ ! -e "$target" ]; then
    : > "$target"
    chmod 600 "$target"
  fi
done

echo "Secrets created in $secrets_dir with mode 600. Values were not printed."
