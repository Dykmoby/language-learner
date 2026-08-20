#!/usr/bin/env bash
# Keeps the DuckDNS record pointing at this box, so the address does not go stale
# when the home IP changes.
set -euo pipefail

ENV_FILE=/etc/duckdns.env
[[ -r $ENV_FILE ]] || { echo "missing or unreadable $ENV_FILE" >&2; exit 1; }
# shellcheck source=/dev/null
source "$ENV_FILE"
: "${DUCKDNS_DOMAINS:?set DUCKDNS_DOMAINS in $ENV_FILE}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN in $ENV_FILE}"

# Deliberately NOT through the box's outbound proxy. Sending ip= empty asks
# DuckDNS to record the source address of this request — through the proxy that
# would be the proxy's address, and the domain would point at the wrong host.
response=$(env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY \
  curl -fsS --max-time 30 \
  "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAINS}&token=${DUCKDNS_TOKEN}&ip=")

if [[ $response != "OK" ]]; then
  # The token never appears here; DuckDNS answers only OK or KO.
  echo "duckdns update refused: ${response}" >&2
  exit 1
fi
echo "duckdns: OK (${DUCKDNS_DOMAINS})"
