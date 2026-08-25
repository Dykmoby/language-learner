#!/usr/bin/env bash
# Installs the systemd unit and its environment file. Run with sudo from the repo root.
set -euo pipefail

REPO="/home/dykmoby/language-learner"
UNIT="language-learner.service"
ENV_FILE="/etc/language-learner.env"

# The rebuild watcher goes in with the service rather than beside it, in its own
# script. Its whole job is to stop a running server from serving a build that is
# no longer on disk, and a box where somebody skipped the optional extra step is
# precisely the box that hits it.
WATCH_UNITS=(language-learner-restart.path language-learner-restart.service)
HELPER_SRC="$REPO/deploy/restart-after-build.sh"
HELPER_DST="/usr/local/bin/language-learner-restart-after-build.sh"

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0640 -o root -g root "$REPO/.env.example" "$ENV_FILE"
  echo "created $ENV_FILE from .env.example — review it"
else
  echo "$ENV_FILE already exists, left untouched"
fi

install -m 0644 -o root -g root "$REPO/deploy/$UNIT" "/etc/systemd/system/$UNIT"

# Root-owned and out of the repo: language-learner-restart.service runs this as
# root, and the repo is writable by dykmoby.
install -m 0755 -o root -g root "$HELPER_SRC" "$HELPER_DST"
for unit in "${WATCH_UNITS[@]}"; do
  install -m 0644 -o root -g root "$REPO/deploy/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now "$UNIT"

# enable, then restart rather than `enable --now`: --now does nothing to a unit
# that is already running, so re-running this after editing the watcher would
# leave the old one armed. Restarting a .path unit only re-arms the watch; it
# does not trigger the restart it is watching for.
systemctl enable language-learner-restart.path
systemctl restart language-learner-restart.path

systemctl --no-pager status "$UNIT" | head -20
