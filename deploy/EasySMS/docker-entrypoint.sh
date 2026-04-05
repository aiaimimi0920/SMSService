#!/bin/sh
set -eu

config_path="${EASY_SMS_CONFIG_PATH:-/etc/easy-sms/config.yaml}"
state_dir="${EASY_SMS_STATE_DIR:-/var/lib/easy-sms}"
reset_store="${EASY_SMS_RESET_STORE_ON_BOOT:-false}"
template_path="/opt/easy-sms/config.template.yaml"

mkdir -p "$(dirname "$config_path")" "$state_dir"

if [ ! -f "$config_path" ] && [ -f "$template_path" ]; then
  cp "$template_path" "$config_path"
fi

if [ "$reset_store" = "true" ]; then
  find "$state_dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

exec "$@"
