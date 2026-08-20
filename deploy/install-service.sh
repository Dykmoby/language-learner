#!/usr/bin/env bash
# Installs the systemd unit and its environment file. Run with sudo from the repo root.
set -euo pipefail

REPO="/home/dykmoby/language-learner"
UNIT="language-learner.service"
ENV_FILE="/etc/language-learner.env"

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0640 -o root -g root "$REPO/.env.example" "$ENV_FILE"
  echo "created $ENV_FILE from .env.example — review it"
else
  echo "$ENV_FILE already exists, left untouched"
fi

install -m 0644 -o root -g root "$REPO/deploy/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable --now "$UNIT"
systemctl --no-pager status "$UNIT" | head -20
