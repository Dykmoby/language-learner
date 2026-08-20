# Deploying on the Pi

Everything here is applied by hand, once. Build-order step 2 in [`../docs/design.md`](../docs/design.md).

## Order

1. `npm ci && npm run build`
2. `sudo ./install-service.sh` — installs `/etc/language-learner.env` from `../.env.example` and the systemd unit, then enables and starts it.
3. Seed the two accounts (see below).
4. Append `Caddyfile.snippet` to `/etc/caddy/Caddyfile` and reload Caddy.
5. Install the fail2ban filter and jail from `fail2ban/`.
6. Put the DuckDNS token in `/etc/duckdns.env` and enable `duckdns-update.timer`.

## Seeding accounts

Passwords come from the environment, never from `argv` — `argv` is visible in `ps`
to every user on the box.

```bash
DATABASE_PATH=/home/dykmoby/language-learner/data/language-learner.db \
  SEED_ADMIN_PASSWORD='…' SEED_STUDENT_PASSWORD='…' \
  node src/db/seed.ts
```

Re-running leaves existing accounts untouched and says so. `--force` overwrites —
that is how a password gets changed, since there is no web surface that creates
or edits an account.

## Traps this step actually hit

**The outbound proxy is as load-bearing as `HOME`.** Interactive shells on this box
get `HTTP_PROXY`/`HTTPS_PROXY` from the profile; systemd units do not. Without them
every Grader call fails with `Failed to authenticate. API Error: 403 Request not
allowed` — which names credentials while the credentials are perfectly fine. Both
are in `.env.example`, and the health check tells the two cases apart.

**Do not run `caddy validate` as root once the site block has a file log.** It
instantiates the log writer as `root`, leaving `/var/log/caddy/language-learner.access.log`
owned by `root:root` mode 0600 — after which the Caddy service, running as `caddy`,
cannot open its own log and refuses to start. Validate as the service user:

```bash
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
```

If it has already happened: `sudo rm` the log file and restart Caddy.

**The DuckDNS updater must bypass the proxy.** `ip=` empty asks DuckDNS to record
the source address of the request; through the proxy that is the proxy's address,
and the domain would point at the wrong host. `duckdns-update.sh` unsets the proxy
variables for exactly this reason.

## Checking it worked

```bash
curl -I https://language-learner.duckdns.org/login        # 200, valid cert
curl -I http://language-learner.duckdns.org/login         # 308 to https
sudo fail2ban-client status caddy-language-learner        # jail is reading the log
systemctl is-enabled caddy fail2ban language-learner      # all enabled at boot
```

Then sign in as the Admin and press the health-check button. A green result with a
wall time of roughly 4-7s is the proof that [ADR 0001](../docs/adr/0001-claude-agent-sdk-as-grading-engine.md)'s
credentials path works in the shape it actually ships.
