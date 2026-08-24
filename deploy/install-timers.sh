#!/usr/bin/env bash
# Installs the two operational timers — the nightly backup and the periodic
# Grader health check. Run with sudo from the repo root. Idempotent: re-running
# after editing a unit file reinstalls and restarts it.
#
# The service itself is installed by install-service.sh; this is build-order
# step 8 and can be run at any point after it.
set -euo pipefail

REPO="/home/dykmoby/language-learner"
ENV_FILE="/etc/language-learner.env"
UNITS=(
  language-learner-backup.service
  language-learner-backup.timer
  language-learner-health.service
  language-learner-health.timer
)

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
# Both units read it, and both are useless without DATABASE_PATH, UPLOAD_DIR and
# the proxy variables. Failing here beats a timer that runs nightly against the
# wrong database.
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE is missing — run install-service.sh first" >&2; exit 1; }

for unit in "${UNITS[@]}"; do
  install -m 0644 -o root -g root "$REPO/deploy/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now language-learner-backup.timer language-learner-health.timer

systemctl --no-pager list-timers language-learner-backup.timer language-learner-health.timer
