#!/usr/bin/env bash
# Fail loudly when any required Apple signing/notarization secret is empty.
# Never print secret values.
set -euo pipefail
missing=()
for name in MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_API_KEY_P8_BASE64; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} )); then
  printf 'Missing macOS signing secret(s): %s\n' "${missing[*]}" >&2
  exit 1
fi
