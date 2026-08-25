#!/usr/bin/env bash
# Restarts the service onto the build that has just landed in .next. Triggered by
# language-learner-restart.path; there is no reason to run it by hand.
#
# `next start` reads .next's manifests once, at boot, and serves them from memory
# for the life of the process. A build that lands under a running server leaves
# the two disagreeing: the HTML goes on naming chunk hashes from the old build
# while the only files on disk are the new ones. It surfaces as a page with no
# CSS — a 500 on a stylesheet whose name nothing on disk has ever had — which
# reads as a styling bug rather than as the stale process it is.
set -euo pipefail

NEXT_DIR=/home/dykmoby/language-learner/.next
UNIT=language-learner.service
SETTLE_SECONDS=3
TIMEOUT_SECONDS=180

# BUILD_ID is what the path unit watches, because `next build` writes it exactly
# once — but it is not the last thing written. routes-manifest.json,
# prerender-manifest.json, _ssgManifest.js and the prerendered error pages all
# land after it, and those are read at boot. Restarting the instant BUILD_ID
# changed would hand the new process a half-written manifest, so wait for the
# directory to stop changing first.
#
# .next/cache is pruned: turbopack writes it throughout a build and it is not
# read at boot, so waiting on it would only delay the restart.
#
# The reference file rather than `find -newermt '-3 seconds'`: -newer is POSIX
# and works whatever find is on PATH, and the relative form is a GNU extension.
deadline=$(( SECONDS + TIMEOUT_SECONDS ))
ref=$(mktemp)
trap 'rm -f "$ref"' EXIT

while (( SECONDS < deadline )); do
  touch -d "$SETTLE_SECONDS seconds ago" "$ref"
  # The BUILD_ID test is not redundant: `next build` clears .next before it
  # rewrites it, and a find over a directory that is not there yet also prints
  # nothing. Without it, "missing" would be mistaken for "settled".
  if [[ -f $NEXT_DIR/BUILD_ID ]] &&
     [[ -z $(find "$NEXT_DIR" -mindepth 1 -path "$NEXT_DIR/cache" -prune -o -newer "$ref" -print -quit 2>/dev/null) ]]; then
    # try-restart, not restart: a service that was deliberately stopped stays
    # stopped. Someone building the repo is not asking for it to start serving.
    exec systemctl try-restart "$UNIT"
  fi
  sleep 1
done

echo "$NEXT_DIR was still changing after ${TIMEOUT_SECONDS}s — left $UNIT alone" >&2
exit 1
