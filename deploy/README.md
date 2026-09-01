# Deploying on the Pi

Everything here is applied by hand, once. Build-order step 2 in [`../docs/design.md`](../docs/design.md).

## Order

1. `npm ci && npm run build`
2. `sudo ./install-service.sh` — installs `/etc/language-learner.env` from `../.env.example`, the systemd unit and the rebuild watcher below, then enables and starts them.
3. Seed the two accounts (see below).
4. Append `Caddyfile.snippet` to `/etc/caddy/Caddyfile` and reload Caddy.
5. Install the fail2ban filter and jail from `fail2ban/`.
6. Put the DuckDNS token in `/etc/duckdns.env` and enable `duckdns-update.timer`.
7. `sudo ./install-timers.sh` — the nightly backup and the periodic health check
   (build-order step 8; see below).

## Rebuilding: the restart is not optional, so it is not manual

`next start` reads `.next` once, at boot, and serves those manifests from memory
for the life of the process. A `npm run build` under a running server therefore
does not take effect — worse, it takes *half* effect. The server goes on emitting
HTML that names the previous build's chunk hashes while the only files on disk
are the new ones. Chunks whose content did not change keep their hash and keep
working, so the page loads and its JavaScript runs; the stylesheet, which did
change, 500s. What that looks like is the application with no CSS at all, which
is not what a stale process looks like when you are guessing.

`install-service.sh` installs a watcher, so the restart is a consequence of
building rather than a step someone has to remember:

- **`language-learner-restart.path`** watches `.next/BUILD_ID` — the one file
  `next build` writes exactly once per build.
- **`language-learner-restart.service`** runs
  `/usr/local/bin/language-learner-restart-after-build.sh`, which waits for
  `.next` to go quiet before touching anything. `BUILD_ID` is *not* the last file
  written: the manifests `next start` reads at boot land after it, and restarting
  the moment it changed would hand the new process a half-written one. Then
  `systemctl try-restart` — `try-`, so a service that was deliberately stopped
  stays stopped rather than being started by somebody's build.

The deploy loop is therefore `git pull && npm ci && npm run build`, with nothing
after it **unless the schema moved**. Migrations are not applied by the service —
`src/db/migrate.ts` is a CLI of its own, deliberately, so that creating the schema
and starting the application stay separate acts. So a release that adds a
migration needs one command before the build, and the failure it prevents is not
subtle: the column the new code selects does not exist, and every screen that
reads the table 500s.

```bash
git pull
DATABASE_PATH=/home/dykmoby/language-learner/data/language-learner.db \
  node src/db/migrate.ts
npm ci && npm run build
```

Running it when nothing moved is a no-op, so the safe habit is to run it every
time rather than to decide each time whether it is needed.

Watch the restart land:

```bash
journalctl -u language-learner-restart.service -u language-learner -f
```

By hand, if the watcher is disabled or the build was copied in rather than made
here:

```bash
sudo systemctl restart language-learner
```

## Seeding accounts

Passwords come from the environment, never from `argv` — `argv` is visible in `ps`
to every user on the box.

```bash
DATABASE_PATH=/home/dykmoby/language-learner/data/language-learner.db \
  SEED_ADMIN_PASSWORD='…' SEED_STUDENT_PASSWORD='…' \
  node src/db/seed.ts
```

Re-running leaves existing accounts untouched and says so. `--force` overwrites —
that is how a forgotten password is reset, and how the Admin's own password is
changed from the box.

This script is still the only thing that grants the Admin role, and there is
still no registration route. What it is no longer the only way to do is make a
Student: an Admin creates further accounts from `/admin/students`, each with a
generated Temporary Password the new Student must replace before they can reach
anything. Those accounts are always Students — nothing in the interface can make
an Admin, or delete one.

## Seeding content

Until authoring lands (build-order step 4), Courses and Lessons come from a
fixture checked into the repo — `src/content/english-a1.ts`.

```bash
DATABASE_PATH=/home/dykmoby/language-learner/data/language-learner.db \
  node src/content/seed-content.ts
```

Separate from the account seed, and re-runnable: it matches a Course by its
Language and title, a Lesson by its position and an Exercise by its position in
the Exercise Set, and updates them in place. Editing the fixture and re-running
is how a typo gets fixed; no Submission is lost doing it. It also enrols every
existing Student in the seeded Course, because nothing else does yet — so run the
account seed first.

## The operational timers

Build-order step 8. Two units, installed together:

```bash
sudo ./install-timers.sh
```

- **`language-learner-backup.timer`** — 03:00 nightly, `Persistent=true` so a
  night the Pi spent unplugged is taken on the way up rather than skipped.
- **`language-learner-health.timer`** — 15 minutes after boot, then every 6
  hours. Deliberately infrequent: every run is a real, paid Grader call. It runs
  through `/etc/language-learner.env`, which is the point — [ADR 0001](../docs/adr/0001-claude-agent-sdk-as-grading-engine.md)'s
  credentials path only works in the shape it ships, and a check that ran with a
  different `HOME`, or without the proxy, would prove the wrong thing green.

Run the migrations first. Both units write to the database, and the health check
writes to a table that only exists after step 8's migration — one that has since
gained a column (`likely_rate_limit`) the Admin dashboard reads, so a deploy that
skips this leaves the dashboard unable to render:

```bash
DATABASE_PATH=/home/dykmoby/language-learner/data/language-learner.db \
  node src/db/migrate.ts
```

Change an interval with a drop-in rather than by editing the unit, so an upgrade
does not quietly revert it:

```bash
sudo systemctl edit language-learner-health.timer   # [Timer] OnUnitActiveSec=12h
```

### Checking they worked

```bash
systemctl list-timers language-learner-\*          # both listed, with a next run
sudo systemctl start language-learner-backup.service  # run one now, synchronously
journalctl -u language-learner-backup.service -n 20 --no-pager
ls ~/backups                                        # a dated set appeared
```

The health check is worth triggering once by hand too — it is the same call the
Admin's button makes, and after it the dashboard banner should be green without
anybody pressing anything:

```bash
sudo systemctl start language-learner-health.service
journalctl -u language-learner-health.service -n 5 --no-pager
```

A failing health check leaves the unit **successful** on purpose: the run
recorded what it found, and a Grader outage is not a fault for systemd to retry
against a paid API. The failure is in the journal and, in Russian, on the Admin
dashboard.

## Backups: what is in a set, and how to restore one

Each set is one directory named for the instant it was taken, in UTC —
`~/backups/2026-08-22T030000Z/`:

```
language-learner.db     an online .backup(), taken while the service was serving
uploads/                a copy of UPLOAD_DIR — the Theory images
```

The database copy is taken through better-sqlite3's `.backup()` API rather than
by copying the file. This is not fussiness: the database runs in WAL mode and the
service writes to it continuously, so at any moment a large part of the recent
state is in `language-learner.db-wal` and not in the file itself. On this Pi the
`.db` was 116 KB and the un-checkpointed WAL beside it 197 KB — a `cp` of the
`.db` alone would have restored a database missing every session and Submission
since the last checkpoint, and it would have restored *cleanly*, which is worse.

Sets older than `BACKUP_RETENTION_DAYS` (14) are pruned after each run. Nothing
else in the folder is ever touched — the weekly copy below can live beside them.

### The weekly copy off the Pi — manual, per design.md

A backup on the same SD card as the thing it is backing up is not a backup. Once
a week, from another machine:

```bash
rsync -a dykmoby@language-learner.duckdns.org:backups/ ~/language-learner-backups/
```

### Restoring

The restore is a copy back, because the set is deliberately plain files. Stop the
service first: restoring underneath a running process is how a WAL from the old
database meets a file from the new one.

```bash
SET=~/backups/2026-08-22T030000Z

sudo systemctl stop language-learner

# Keep what is being replaced. A restore that turns out to be the wrong set is
# recoverable; one that overwrote the only copy is not.
mv ~/language-learner/data ~/language-learner/data.before-restore

mkdir -p ~/language-learner/data
cp "$SET/language-learner.db" ~/language-learner/data/language-learner.db
cp -r "$SET/uploads" ~/language-learner/data/uploads

# There must be no -wal or -shm beside the restored file. The backup is a whole,
# consistent database on its own, and a stale WAL from the previous one would be
# replayed over the top of it.
ls ~/language-learner/data

# Migrations, in case the set predates a schema change.
DATABASE_PATH=~/language-learner/data/language-learner.db node src/db/migrate.ts

sudo systemctl start language-learner
```

Verify before trusting it — this exact drill has been run against a real set
taken from the live database. There is no `sqlite3` CLI on this box, so the
check goes through the driver the application itself uses:

```bash
node -e 'const D=require("better-sqlite3");const d=new D(process.env.HOME+"/language-learner/data/language-learner.db",{readonly:true});
console.log(d.pragma("integrity_check",{simple:true}), d.prepare("pragma foreign_key_check").all().length+" fk violations",
d.prepare("select count(*) as n from students").get());'
```

`ok`, no foreign-key violations, and the accounts are there. Then sign in and
open a Lesson with an image in its Theory: the images are the half of a restore
that fails silently.

## Traps this step actually hit

**A rebuild without a restart presents as a page with no CSS**, not as a stale
page — which is the thing you would actually be looking for. Written down here
because the symptom is what gets searched for at the time; the mechanism, and the
watcher that now prevents it, are under
[Rebuilding](#rebuilding-the-restart-is-not-optional-so-it-is-not-manual).

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
systemctl is-active language-learner-restart.path         # the rebuild watcher is armed
```

Then sign in as the Admin and press the health-check button. A green result with a
wall time of roughly 4-7s is the proof that [ADR 0001](../docs/adr/0001-claude-agent-sdk-as-grading-engine.md)'s
credentials path works in the shape it actually ships.
