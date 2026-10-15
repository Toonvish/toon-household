# Deploying toon-household

The one guide for running the app: from a freshly ordered server to the icon on the phone, then
update, backup, rollback and troubleshooting. One container stack, one origin, no third-party
service required.

The target is a cheap VPS with a domain of your own, but it runs on any 64-bit Linux box with Docker,
including a machine on the LAN (see [Variants](#variants)). The running example is a one-core VPS with
1 GB RAM and 30 GB SSD (netcup VPS pico, Hetzner CX/CAX, Oracle Free Tier, IONOS VPS S) with Debian 13
and a subdomain of your own. Photo and PDF import stay off by default; that is why the app fits this
class of machine.

| | |
| --- | --- |
| Time needed | about 30 minutes, ~10 of them waiting for DNS and the certificate |
| What runs afterwards | API, PWA and TLS, all in one container stack on the server |
| Third parties | a domain and, for real mail, the SMTP access of a mail provider. No API key, no cloud database. |

**The server already exists** (Docker installed, DNS set)? Start at
[step 6](#fresh-install), "Get the image".

Moving from the two old apps (toon-recipe, toon-finance)? The data migration is
[`docs/migration.md`](migration.md); the hostname and server side of that move is the [cutover section](#cutover-from-toon-edge)
of this guide. Everything else here applies to a fresh install and to a migrated one alike.

---

## What runs

```
                         :80 :443 (443/udp for HTTP/3)
                                   │
                        ┌──────────▼──────────┐
                        │ caddy               │  TLS, one certificate per name,
                        │                     │  the old-hostname redirects (optional)
                        └──────────┬──────────┘
                                   │ http, inside the Docker network only
                        ┌──────────▼──────────┐   SMTP or HTTPS   ┌─────────────────┐
                        │ app                 │ ················► │ your mail       │
                        │ API + PWA, one port │                   │ provider (opt.) │
                        └──────────┬──────────┘                   └─────────────────┘
                                   │                       with no mail settings the app
                        volume toon-household_toon-data    writes reset and invite links
                        (database, uploads)                to its log only
```

- **`app`** is the Bun/Hono API and the built PWA, one origin, one port (3001, never published).
  The recipe and finance modules, the core (accounts, households, invites) and the web app are one
  image. Migrations run on every start.
- **`caddy`** terminates TLS (a PWA needs a secure context: no service worker, no install and no
  offline mode without it), publishes 80, 443 and 443/udp, and serves the optional redirects from the
  old hostnames. It is the stack's own Caddy (`docker/Caddyfile`, SPEC D11); there is no shared edge
  proxy.
- **One volume to back up:** `toon-household_toon-data` (the libSQL database and the uploads). The
  volume `toon-household_caddy-data` holds the certificates (and, in internal-CA mode, the CA's private
  key); `toon-household_caddy-config` holds Caddy's autosave. The compose project is named
  `toon-household`, which prefixes all three.

Two containers, and no API key is needed to start them. What was external before:

| before | now |
| --- | --- |
| Resend (`MAIL_API_KEY`) | optional. Without mail settings the app only logs the links; for delivery any provider's SMTP access is enough. Resend still works, by SMTP or by the HTTP adapter. |
| Turso (`DATABASE_AUTH_TOKEN`) | optional, a libSQL file in the volume by default |
| OCR | server-side and optional: only with `WITH_OCR=1` in the image (see [Variants](#variants)) |
| Google and GitHub sign-in | stays external and is deliberately off. E-mail and password is the self-hosted way. |

There is no self-hosted replacement for Google or GitHub OAuth; it would need an OIDC provider of
your own plus a generic OIDC client the app does not have. Nothing is missing without it: registration,
login, invites, e-mail confirmation and password reset work completely.

---

## Prerequisites

- **64-bit Linux with Docker**, `x86_64` or `arm64` (the image is published for both). `uname -m` must
  print `x86_64` or `aarch64`; there is no Bun for 32 bit.
- **RAM depends on photo and PDF import.** Without it (the default) Bun, the libSQL file and the PWA
  are all that runs: **512 MB to 1 GB** is enough. With photo import (no PDF) from **1 GB with swap**;
  with PDF import **2 GB at least, with reserve**: text recognition is the memory hog and a PDF is up to
  ten pages of it.
- **1-2 GB swap.** Not for normal operation, so that an outlier does not call the OOM killer at once.
- **SSD, from ~10 GB.** The app is small; the rest is room for recipe photos and card images. SQLite on
  slow storage is the most common reason for "the app is slow".
- **A (sub)domain with an A record on the server IP** (plus AAAA if it has IPv6) and **ports 80 and 443
  reachable**: Caddy needs both for the Let's Encrypt certificate. Without a domain of your own it works
  on a LAN with a local CA on every device: [Variants](#variants).
- **An SSH key pair.** `ssh-keygen -t ed25519` if you have none.
- Optional, for real mail: **SMTP credentials** (host, port, user, password) of a mail provider. Can be
  added later.

---

## Fresh install

**All commands run on the server** unless it says "from the laptop".

### 1. Collect the values

| Placeholder | Where from |
| --- | --- |
| `<server-ip>` | the provider's control panel (network / IP addresses) or the delivery mail |
| `<hostname>` | the planned subdomain, e.g. `haushalt.example.org` |
| `<user>` | the user to create, `toon` below |
| public key | on the laptop: `cat ~/.ssh/id_ed25519.pub` |

### 2. Order the server, first login, a user with your key

When ordering: **Debian 13 or Ubuntu 24.04 LTS**, the minimal variant, no panel and no preinstalled web
hosting. Store your SSH key with the provider if it offers that. Take IPv4 and IPv6 if both are offered
(IPv6-only is cheaper and unreachable from IPv4-only networks).

```bash
ssh root@<server-ip>
apt update && apt full-upgrade -y
reboot
```

Do not work as `root`:

```bash
adduser toon
usermod -aG sudo toon
install -d -m 700 -o toon -g toon /home/toon/.ssh
nano /home/toon/.ssh/authorized_keys        # paste the public key from the laptop
chown toon:toon /home/toon/.ssh/authorized_keys
chmod 600 /home/toon/.ssh/authorized_keys
```

> **A group membership applies from the next login.** A session that is already open, even one opened
> before the `usermod`, does not know the group and answers `toon is not in the sudoers file`. Log out
> completely and in again, not a new shell in the same session. `id` must list `sudo`. The same trap
> comes back with the group `docker` in step 4.

In a **second session** check that key login works, and only then lock the door behind you:

```bash
ssh toon@<server-ip>
id                                          # must contain "sudo"
sudo -v                                     # must run without an error
```

In `/etc/ssh/sshd_config` set `PermitRootLogin no` and `PasswordAuthentication no`, then
`sudo systemctl restart ssh`. Install security updates automatically (the kernel needs an occasional
reboot afterwards, the containers keep running):

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

If `ssh` says `Permission denied (publickey)` and you know the password,
`ssh -o PreferredAuthentications=password root@<server-ip>` forces the password route. If nothing
works, the provider's **VNC console** is not SSH, so no `sshd_config` setting applies there.

### 3. Firewall and swap

Only 22 (SSH), 80 and 443 have to be open, 443 as TCP **and** UDP, because Caddy also speaks HTTP/3
(QUIC runs over UDP; the compose file publishes `443:443/udp` for it). Nothing else: the app publishes
no port. If UDP 443 is closed somewhere, every browser falls back to HTTP/2 cleanly; it only costs the
failed QUIC attempt.

```bash
sudo apt install -y ufw
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

> **`ufw` does not protect published container ports.** Docker writes its rules ahead of ufw's (the
> `DOCKER-USER` chain), so whatever `ports:` lists in the compose file is reachable even if ufw
> forbids it. That is why only 80 and 443 are listed there, without an address. If you ever publish
> another port (a debug UI, a database port), bind it to `127.0.0.1:` yourself and reach it through an
> SSH tunnel.
>
> **If the provider has a firewall in front of the VM** (netcup, Hetzner Cloud, AWS) it is the better
> place for the same rule, since it acts before the packet reaches the box. Then 80 and 443 must be
> open **there too**: a closed provider firewall is the most common cause of "no certificate" in
> step 8, and the app log shows nothing about it.

Swap, so that an outlier waits instead of being shot. Look first whether there is some (some images
come with swap or `zram`; then skip this part):

```bash
free -h            # the Swap row; total 0B means none
```

If there is none:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# use swap late: it is reserve, not memory
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl -p /etc/sysctl.d/99-swappiness.conf
free -h
```

### 4. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
exit                                        # log in again so the group applies
```

After logging in again:

```bash
docker run --rm hello-world
docker compose version
docker info | grep -i -e warning -e "memory limit"
```

There must be no warnings about missing memory limits: the stack sets `mem_limit` on the app
container, which does nothing without cgroup support. A normal VPS kernel has it.

### 5. DNS first

All devices must reach the app under **the same name**: the certificate is issued per name, access by
IP is a new warning, and `WEB_ORIGIN` (the links in outgoing mail) is built from it. At the DNS
provider of the domain create

```
haushalt   A      <server-ip>
haushalt   AAAA   <IPv6 of the server>       # only if there is one
```

and **before starting the stack** check it:

```bash
dig +short <hostname>                       # must print the server IP
```

> This is not a formality. On the first start Caddy asks Let's Encrypt for a certificate, and
> **failed attempts count against the rate limit** (5 failures per account, hostname and hour). A wrong
> DNS record costs an hour of waiting, not just a restart.

Reverse DNS (PTR) is not needed: mail goes through a provider's relay, not from the server itself.

### 6. Get the image

**Every push to `main` publishes a new image to GHCR**, built for `linux/amd64` and `linux/arm64`, as
`ghcr.io/toonvish/toon-household`. Actions, then **Release**, then *Run workflow* triggers it by hand.

> **A freshly published GHCR package is private.** Either make it public once (GitHub, profile or
> organisation, *Packages*, `toon-household`, *Package settings*, *Change visibility*), and the server
> needs no credentials at all, or keep it private and log in once on the server with a read-only token:
> `docker login ghcr.io -u <user>`. Both cases answer an anonymous pull with the same bare `denied`,
> so check the visibility before you suspect anything else.

The published image contains **`tesseract` with the German language pack but no `poppler`**: it can
do photo import, not PDF import. **Nothing is switched on anyway**: `IMPORT_OCR_ENABLED` stays `0`
until the `.env` says otherwise. The build argument only decides what the image CAN do. Whoever needs
PDF import builds their own image: [Variants](#variants).

### 7. The directory, the compose files and `.env`

```bash
sudo mkdir -p /opt/toon-household/docker
sudo chown -R "$USER" /opt/toon-household
cd /opt/toon-household

BASE=https://raw.githubusercontent.com/Toonvish/toon-household/main
curl -fsSL "$BASE/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$BASE/docker/Caddyfile"   -o docker/Caddyfile
curl -fsSL "$BASE/docker/env.example" -o .env
chmod 600 .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
nano .env          # TOON_HOSTNAME and MAIL_FROM to the real values
```

`docker/env.example` is the commented template with every variable; the application's own list is
`.env.example` at the repository root. Three things that go wrong here:

- **Never change `SESSION_SECRET` afterwards.** It also signs the `?sig` parameters of the `/uploads`
  URLs: a new value invalidates every image URL already handed out (the images themselves stay). Do not
  reuse the secrets of the old toon-recipe or toon-finance installs.
- **`.env` must sit next to `docker-compose.yml`**, otherwise the start fails with
  `SESSION_SECRET is missing`.
- **Do not set `PUBLIC_API_URL`.** The empty value is deliberate: the bundle uses relative URLs and the
  API serves it from the same origin. And never put `COMPOSE_PROJECT_NAME` into this `.env`: the project
  is named by the compose file.

Validate the compose file and the Caddyfile before the first start. Both go through compose, so the
`.env` is interpolated exactly as `up` does it; a syntax error in the Caddyfile takes the whole site
offline:

```bash
docker compose config -q
docker compose run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

### 8. Start, and create the first account

```bash
cd /opt/toon-household
docker compose pull
docker compose up -d
docker compose ps                           # app must become "healthy", caddy "running"
docker compose logs -f caddy                # the certificate arrives in the first seconds
```

Open `https://<hostname>` and register. The first account gets a household of its own, with the recipe
module enabled; more people join through the household's invite link (shown **and** mailed). The
finance module is enabled per household from Home ("Aktivieren") and needs two participants. On a
phone: Android, menu, *Install app*; iOS, *Share*, *Add to Home Screen*. The shopping list and the
finance capture then work offline, which rests on the service worker and that on a valid certificate,
which is there by itself here.

**Never run the demo `seed` on a server.** It creates accounts with a public password. With
`NODE_ENV=production` it refuses unless `ALLOW_SEED=1` and an own `SEED_PASSWORD` (10 characters or
more) are passed, once, on the command line and never stored in `.env`:

```bash
docker compose exec -e ALLOW_SEED=1 -e SEED_PASSWORD='<10+ characters>' app bun apps/api/scripts/seed.ts
```

### 9. Mail

Optional, but **before the first password reset**. Without further settings the app sends **no** mail:
it writes every reset and invite link to the container log and tells the UI so ("not configured", not
"sent"). Fine for a first look, useless for a reset to a real address. For delivery put the SMTP access
of a mail provider into `.env` (and set `MAIL_FROM`, which is already in the file, to an address the
relay may send from):

```bash
cat >> .env <<'EOF'
MAIL_TRANSPORT=smtp
MAIL_HOST=mx.example.net
MAIL_PORT=465
MAIL_SECURITY=tls
MAIL_USER=haushalt@example.org
MAIL_PASSWORD=...
EOF
docker compose up -d
```

Notes:

- **With a transport, e-mail confirmation switches on.** Once mail really goes out, an account with an
  **unconfirmed** address may only read (`403 email_unverified` on writes); accepting invites keeps
  working. The confirmation link is mailed at registration. There is deliberately no separate switch:
  it hangs on `MAIL_TRANSPORT`, because a switch you can flip without working delivery would only lock
  the instance. Accounts that predate the confirmation flow, migrated ones included, can be read-only
  after the switch until they have clicked the link once (in Settings); tell people beforehand.
- **`MAIL_TRANSPORT=smtp` is part of it**, otherwise it stays at the log. The line is easy to forget
  because the other values look as if they switched sending on.
- **`MAIL_SECURITY`**: `tls` is implicit TLS on port 465 (recommended), `starttls` upgrades on port 587.
  `none` is for a relay on your own network only, and **`none` with credentials makes the API refuse to
  start**: they would travel in cleartext.
- **`MAIL_FROM` must be an address the relay may send from**, otherwise it rejects the mail.
- **Set up SPF, DKIM and DMARC at the provider** and put the records into the DNS zone, or reset and
  invite mails land in spam.
- **Do not run a mail server of your own on the same box.** Fresh VPS address ranges are on blocklists
  almost everywhere and outgoing port 25 is blocked by many providers.

**Resend** works two ways after the same preparation in its dashboard (add the domain and put its MX
and two TXT records into the zone, add DMARC yourself, create an API key with *Sending access*):

```dotenv
# (a) over SMTP, recommended: the same variables as any provider; MAIL_USER is literally "resend"
MAIL_TRANSPORT=smtp
MAIL_HOST=smtp.resend.com
MAIL_PORT=465
MAIL_SECURITY=tls
MAIL_USER=resend
MAIL_PASSWORD=re_...

# (b) over the HTTP adapter; MAIL_API_KEY is then required and the container will not start without it
MAIL_TRANSPORT=resend
MAIL_API_KEY=re_...
```

`MAIL_FROM` has to be on the verified domain in both cases. A `docker-compose.yml` on the server that
is older than the `MAIL_API_KEY` line does not pass it through: fetch it again (step 7).

Check that mail really goes out: request a password reset to an external address of your own and look
at `docker compose logs app | grep '\[mail\]'` (see [Operations](#operations)). Without any mail setup a
locked-out account is released with

```bash
docker compose exec app bun apps/api/scripts/reset-password.ts <email>
```

### 10. First backup

Everything important is in the volume `toon-household_toon-data`:

```bash
cd /opt/toon-household
docker compose stop app                     # a consistent SQLite copy
docker run --rm -v toon-household_toon-data:/data -v "$PWD:/backup" alpine \
  tar czf "/backup/toon-$(date +%F).tar.gz" -C /data .
docker compose start app
```

Then **copy the file off the server**. A provider snapshot is no substitute: a running SQLite file in
a snapshot is not guaranteed to be consistent. Restoring is under [Operations](#operations).

### 11. Auto-deploy from GitHub Actions (optional)

After this every push to `main` rolls itself out. Whoever prefers to deploy by hand skips the whole
step: as long as the variable `DEPLOY_ENABLED` is not `true`, the release workflow skips the deploy
job and it stays at `docker compose pull && docker compose up -d` on the server.

**What does NOT happen here: a key with shell access in someone else's custody.** The key is bound to
a fixed command (`command="..."` in `authorized_keys`) that knows only `deploy`, `sync-config` and
`status`. The image repository is a constant in the script, not something GitHub sends; otherwise a
stolen key could point the server at any image in the world. `restrict` also removes port and agent
forwarding, X11 and the pty. A stolen key can roll out a version, nothing more.

**a) Install the script** (on the server):

```bash
sudo curl -fsSL https://raw.githubusercontent.com/Toonvish/toon-household/main/docker/toon-deploy.sh \
     -o /usr/local/bin/toon-household-deploy
sudo chmod 755 /usr/local/bin/toon-household-deploy
toon-household-deploy status                # must show the running stack
```

The name is deliberate and different from the old `toon-deploy` and `toon-finance-deploy`: a forced
command hangs off the key, so one key can drive exactly one app, and a distinct name lets the new key
be installed before the old ones are removed. If the installation is not in `/opt/toon-household` or
the image lives elsewhere, `TOON_APP_DIR`, `TOON_IMAGE_REPO` and `TOON_RAW_BASE` at the top of the
script say so.

**b) Make a key pair** of its own for this job, without a passphrase (a runner cannot type one):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gh-deploy -N '' -C github-actions-deploy
```

**c) Enter the public half** with the fixed command in front:

```bash
printf 'restrict,command="/usr/local/bin/toon-household-deploy" %s\n' "$(cat ~/.ssh/gh-deploy.pub)" \
  >> ~/.ssh/authorized_keys
```

Check that the key really opens no shell; the answer must be the script's error message, not a prompt:

```bash
ssh -i ~/.ssh/gh-deploy -o IdentitiesOnly=yes localhost 'id'
# -> ERROR: Unknown command: id (allowed: deploy, sync-config, status)
```

**d) Read the host key** (on the server, not from the laptop, or you pin whatever answered on the
way):

```bash
ssh-keyscan -p 22 <hostname-or-ip>
```

**e) Enter it in GitHub**, repository, *Settings*, *Secrets and variables*, *Actions*:

| Secret | Value |
| --- | --- |
| `DEPLOY_SSH_HOST` | hostname or IP of the server |
| `DEPLOY_SSH_USER` | the SSH user (must be in the `docker` group) |
| `DEPLOY_SSH_KEY` | the content of `~/.ssh/gh-deploy` (the **private** half) |
| `DEPLOY_SSH_KNOWN_HOSTS` | the complete output of (d) |
| `DEPLOY_SSH_PORT` | optional, default 22 |

And under *Variables* (not secrets):

| Variable | Value |
| --- | --- |
| `DEPLOY_ENABLED` | `true`, **the switch**. Without it the deploy job is skipped. Set it only when the five secrets exist, otherwise the job starts and fails on the empty host key. |
| `TOON_HOSTNAME` | only for the clickable link on the deployment; the server reads its hostname from its own `.env` |

Afterwards delete the private key from the server (`rm ~/.ssh/gh-deploy`): it lives in GitHub now and
the server does not need it.

**f) Create the environment**: *Settings*, *Environments*, **production**. It is where the five secrets
should hang so that no other workflow can read them. Whoever does not want every push to go live at
once adds *Required reviewers* there; every deploy then waits for approval.

**Test it**: Actions, **Release**, *Run workflow*, tick *Deploy to the server after the build*. The job
ends with `app is healthy` and `docker compose ps`.

> **`docker-compose.yml` and `docker/Caddyfile` do not travel with a deploy.** The key cannot copy files,
> on purpose: a compose or Caddy change is a configuration change and should not happen by the way.
> When either changed in the repository, run `toon-household-deploy sync-config` once on the server.
> It downloads both files, keeps the old ones as `*.bak`, validates both (`docker compose config -q`
> and `caddy validate` through compose), puts the old files back and fails if either is invalid, and
> restarts the caddy container when the Caddyfile changed. A changed `docker-compose.yml` takes effect
> with the next deploy.

**Switching it off**: setting `DEPLOY_ENABLED` to `false` stops the job. The *access* is only taken
away by deleting the line from `~/.ssh/authorized_keys`; that is the step that counts, whatever GitHub
still stores.

### 12. Closing checklist

- [ ] `ssh toon@<server-ip>` works with the key, `id` shows `sudo`; `root` and password login are off.
- [ ] `sudo ufw status` shows 22, 80, 443 (tcp and udp) and nothing else; the provider firewall agrees.
- [ ] `free -h` shows swap.
- [ ] `dig +short <hostname>` returns the server IP.
- [ ] `docker compose ps` shows `app` as `healthy` and `caddy` as `running`, and nothing else.
- [ ] `https://<hostname>` opens the app **without** a certificate warning.
- [ ] An account is registered and the app can be installed on the phone.
- [ ] A password-reset mail to an external address arrives (or sending is deliberately not set up; then
      the link is in the app log).
- [ ] A first backup of `toon-household_toon-data` exists outside the server.

---

## Operations

All commands run in `/opt/toon-household` on the server.

### Update

**With auto-deploy set up** (step 11) there is nothing to do: the push to `main` builds, tests and rolls
out, waits for `healthy` and writes the rolled-out digest into the server's `.env`. If the health check
fails, `.env` keeps the last healthy version, and `docker compose up -d` brings it back without editing
anything.

**Without auto-deploy** the push only publishes the image. On the server:

```bash
cd /opt/toon-household && docker compose pull && docker compose up -d --remove-orphans
docker compose ps                     # app should be "healthy"
```

When `docker-compose.yml` or `docker/Caddyfile` changed in the repository, the server gets them in
**neither** case by itself, auto-deploy included. One command fetches, validates and applies them:

```bash
toon-household-deploy sync-config     # or, without the script, the curl lines of step 7 plus the validation there
```

`TOON_IMAGE` in `.env` decides *what* is pulled. `:latest` follows the newest `main` build; a
`@sha256:...` digest stays pinned until you change it. Digests are in the summary of every release run.

### How a new version reaches the devices

**Nothing to do: the installed app fetches it itself.** It asks the server for a new version when it
comes to the foreground (plus every 30 minutes and when the connection returns), downloads it in the
background and restarts. An installed iOS web app only navigates at start, so the foreground check is
the one that matters: bringing it back from the app switcher once is enough.

The exception is **unsaved input on screen** (a half-typed recipe, an import draft with open changes):
it does *not* reload by itself then, so the input is not lost. A banner "Neue Version verfügbar" with
a button appears instead; saving also lets it pick the update up.

When an app hangs on an old version for days, almost always something caches `sw.js` or `index.html`:

```bash
curl -sI https://<hostname>/sw.js | grep -i cache-control   # must say "no-cache"
```

### Rollback

Get the digest of the good version: Actions, **Release**, open an earlier run, copy the digest from the
summary. Then on the server, either

```bash
toon-household-deploy deploy sha256:<digest>
```

which waits for `healthy` and writes the digest into `.env`, or by hand:

```bash
cd /opt/toon-household
sed -i "s|^TOON_IMAGE=.*|TOON_IMAGE=ghcr.io/toonvish/toon-household@sha256:<digest>|" .env
docker compose pull && docker compose up -d
```

With auto-deploy the same works from GitHub: Actions, **Deploy**, *Run workflow*, digest into the
field. A pinned digest does not survive the next auto-deploy, which rewrites the line to the newly
rolled-out version. To hold a version longer, switch the deploy job off (delete the line from
`authorized_keys`, or require a reviewer in the `production` environment). For normal manual updates
set `TOON_IMAGE=ghcr.io/toonvish/toon-household:latest` again.

> Migrations run on every start and **cannot be undone**. A rollback to an image from before a schema
> change needs the backup from before it.

### Backup and restore

Everything important is in one volume, `toon-household_toon-data` (database, uploads). The backup is
step 10:

```bash
cd /opt/toon-household
docker compose stop app                       # a consistent SQLite copy
docker run --rm -v toon-household_toon-data:/data -v "$PWD:/backup" alpine \
  tar czf "/backup/toon-$(date +%F).tar.gz" -C /data .
docker compose start app
```

Restore:

```bash
docker compose down
docker run --rm -v toon-household_toon-data:/data -v "$PWD:/backup" alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/toon-2026-08-04.tar.gz -C /data"
docker compose up -d
```

The exact volume name comes from `docker volume ls` (the prefix is `name:` of the compose file). The
tar commands run as root and a restored tree keeps the owner it was saved with (the `bun` user, uid
1000, which is who the app runs as). A provider snapshot is no substitute: a running SQLite file in a
snapshot is not guaranteed to be consistent, the commands above are. Copy the result **off the
server**. The volume `toon-household_caddy-data` is deliberately not part of this: in internal-CA mode
it holds the CA's private key, and in ACME mode the certificates are fetched again.

### Logs

```bash
docker compose logs -f app        # API requests, import and mail errors
docker compose logs -f caddy      # TLS, certificates, redirects
docker compose ps                 # health
```

### Checking mail

There is no mail UI in the stack; the proof is in the app log:

```bash
docker compose logs app | grep '\[mail\]'
```

| Line | means |
| --- | --- |
| *nothing* | Sending worked, or no mail has been triggered yet. A successful send deliberately writes nothing to the log. |
| `[mail] NOT SENT — MAIL_TRANSPORT is not configured` plus the whole mail text | No delivery set up. The link in the box is valid and can be passed on by hand (step 9). |
| `[mail] Sending to ... failed (smtp)` / `(resend)` | A configured relay refused. That is a broken deployment: the action itself went through on purpose, the mail did not. |

The UI shows the same three states (the invite panel and the e-mail confirmation colour "sent", "not
configured" and "failed" differently), so `docker compose logs` is only needed for the last case.

Anyone who wants to read mail in a browser can put a Mailpit container (`axllent/mailpit`) next to the
stack for a test (`MAIL_TRANSPORT=smtp`, `MAIL_HOST=mailpit`, `MAIL_PORT=1025`, `MAIL_SECURITY=none`),
but **only** with `ports: ["127.0.0.1:8025:8025"]` and access through
`ssh -N -L 8025:127.0.0.1:8025 toon@<server-ip>`: its UI shows every reset and invite link, and whoever
can open it takes over any account. It does not belong on a production install with a real relay.

### Scripts inside the running container

The image carries `apps/api/scripts/`; run them through the app container:

```bash
docker compose exec app bun apps/api/scripts/reset-password.ts <email>      # a reset link; --send also mails it
docker compose exec app bun apps/api/scripts/uploads-gc.ts --dry-run        # files no row references
docker compose exec app bun apps/api/scripts/plan-run.ts                    # the fixed-cost catch-up by hand
```

`plan-run` is a convenience only: the app already runs the fixed-cost catch-up at boot and every six
hours. `uploads-gc` always keeps files younger than 24 hours; leave `--dry-run` off to delete.

### Updating Caddy

Caddy is **pinned to a version** in `docker-compose.yml` and therefore does not move with
`docker compose pull`. That is deliberate: a floating `caddy:2-alpine` can replace the TLS terminator
under a running install, and when that goes wrong the site is gone, over which you reach the server.
Security updates have to be applied by hand; looking once or twice a year is enough:

```bash
curl -s https://api.github.com/repos/caddyserver/caddy/releases/latest | grep '"tag_name"'
```

Change the `image:` line of the `caddy` service in `docker-compose.yml` in the repository, push, and
fetch the file again on the server (`toon-household-deploy sync-config`). On the server itself, edit
the line, then:

```bash
docker compose config -q
docker compose run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d
```

### Changing the Caddyfile

**Always validate before you reload.** An error takes the whole site with it:

```bash
nano docker/Caddyfile
docker compose run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile   # MUST say "Valid configuration"
docker compose restart caddy
```

The Caddyfile is a single-file bind mount that pins the old inode, so after replacing the file a
**restart** of the caddy container is what makes it take effect (`sync-config` does that itself, and
only when the file changed). Every documented way to run or validate Caddy goes through compose: the
stack's `.env` supplies the variables, and a raw `docker run` of the Caddy image without them fails
for reasons that have nothing to do with the file. The Bun version has one place: `ARG BUN_VERSION`
in the `Dockerfile`, plus `.bun-version` for CI; the two must match.

## Cutover from toon-edge

This is the move from the old arrangement (toon-recipe and toon-finance as two stacks behind the shared
toon-edge proxy) to this one stack. Three stacks become one; two hostnames become one
(`TOON_HOSTNAME`) plus, for a while, two optional redirect hostnames (`RECIPE_HOSTNAME` and
`FINANCE_HOSTNAME`, [ADR 0008](adr/0008-old-hostnames-map-paths-and-retire-workers.md)); the old volumes stay as the backup
until the very last step. The data side (what is copied, what the report means, what can go wrong) is
[`docs/migration.md`](migration.md); this section is the server side and the order, from DNS to the
deletion of the old volumes. Its numbering is the one of [the cutover order](migration.md#cutover-order),
widened by the steps before and after it.

Plan a window of an hour or two in which nobody books or cooks. Every step up to and including step 9
is reversible: stop the new stack, start toon-edge, then the two old stacks (see "Rolling back" below).
The old volumes are never touched before step 12.

Names used below, all facts of this repository: the new stack lives in `/opt/toon-household`, its volume
is `toon-household_toon-data`, its image is `ghcr.io/toonvish/toon-household`. The old volumes are
`toon-recipe_toon-data` and `toon-finance_toon-data` (database `local.db` and `uploads/` in the first,
database `local.db` in the second); toon-edge kept its certificates in `toon-edge_caddy-data` and
`toon-edge_caddy-config`.

0. **Before the day.**

   - **DNS first.** The new hostname must resolve to this server before anything starts (see
     [Fresh install](#fresh-install), step 5, for the Let's Encrypt rate limit). The two old hostnames
     already point here; check all three:

     ```bash
     dig +short <hostname>                  # the new TOON_HOSTNAME: the server IP
     dig +short <old-recipe-hostname>       # the server IP
     dig +short <old-finance-hostname>      # the server IP
     ```

   - **OAuth apps.** For every provider in use (Google, GitHub) add the new callback URL
     `https://<hostname>/api/auth/oauth/<provider>/callback` next to the old ones at the provider. Remove
     the old ones with step 12.
   - **Everybody opens both old apps online once.** An unsent shopping-list change or finance booking
     lives only in that device's browser; it drains when the old app is online. After the cutover it is
     lost, because the old API is gone (the retiring worker of ADR 0008 deliberately leaves IndexedDB
     alone, but nothing can accept its content any more).
   - **The image is pullable** from the server: `docker pull ghcr.io/toonvish/toon-household:latest`
     (a `denied` is the package visibility or a missing `docker login`, see [Fresh install](#fresh-install),
     step 6).
   - **Read [`docs/migration.md`](migration.md)**, at least "What is migrated, and what is not" and "The
     report". Decide who gets which claim link.

1. **Prepare the new stack without starting it.** The old stacks keep running while you do this; only the
   `up` has to wait, because the toon-edge proxy still holds ports 80 and 443.

   ```bash
   sudo mkdir -p /opt/toon-household/docker
   sudo chown -R "$USER" /opt/toon-household
   cd /opt/toon-household

   BASE=https://raw.githubusercontent.com/Toonvish/toon-household/main
   curl -fsSL "$BASE/docker-compose.yml" -o docker-compose.yml
   curl -fsSL "$BASE/docker/Caddyfile"   -o docker/Caddyfile
   curl -fsSL "$BASE/docker/env.example" -o .env
   chmod 600 .env
   sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
   nano .env
   ```

   In `.env` set `TOON_HOSTNAME` to the new name and `MAIL_FROM`, set `RECIPE_HOSTNAME` and
   `FINANCE_HOSTNAME` to the two old hostnames (that is what makes them redirect), and copy the mail
   values and, if used, the OAuth client IDs and secrets from the old `.env` files. The
   `SESSION_SECRET` is a NEW value (the sed line above): never reuse an old one, and never change it
   afterwards. If the old stacks used `TOON_TLS_ISSUER=internal`, set it here too, and expect to install
   the new root certificate on every device: the new Caddy makes its own CA (see
   [Variants](#variants)).

   ```bash
   docker compose pull
   docker compose config -q
   docker compose run --rm --no-deps --entrypoint caddy caddy \
     validate --config /etc/caddy/Caddyfile --adapter caddyfile   # MUST say "Valid configuration"
   ```

   Do NOT run `docker compose up` yet. A started stack creates its own empty database, and step 6 needs
   an empty volume.

2. **Stop the old stacks, without `-v`.** The recipe and the finance stack first, then toon-edge, which
   holds ports 80 and 443. A `-v` on `down` would delete the volumes you are about to copy: the three
   commands carry no such flag, and neither must you add one.

   ```bash
   (cd /opt/toon-recipe  && docker compose down)
   (cd /opt/toon-finance && docker compose down)
   (cd /opt/toon-edge    && docker compose down)
   docker ps                                  # none of the old containers is left
   docker volume ls | grep -E 'toon-(recipe|finance|edge)'   # every old volume is still there
   ```

3. **Copy the old volumes out.** Into `migration-in/`, WAL included; the commands and the reason for
   copying the whole volume are in [Preparing the inputs](migration.md#preparing-the-inputs) and
   [Cutover order](migration.md#cutover-order) step 2. Work in a directory outside `/opt/toon-household`
   (for example `~/cutover`):

   ```bash
   mkdir -p ~/cutover/migration-in/recipe ~/cutover/migration-in/finance ~/cutover/migration-out
   cd ~/cutover
   docker run --rm -v toon-recipe_toon-data:/data:ro  -v "$PWD/migration-in/recipe:/out"  alpine cp -a /data/. /out/
   docker run --rm -v toon-finance_toon-data:/data:ro -v "$PWD/migration-in/finance:/out" alpine cp -a /data/. /out/
   ls -la migration-in/recipe migration-in/finance      # local.db, local.db-wal, uploads/
   ```

   A schema-version error in the next step means an old app was not at its last migration: start that
   one old stack once, stop it again and repeat this step.

4. **Dry run and read the report.** Two ways to run `migrate:legacy`; use the first when the server has
   no Bun. It runs from the new image (it carries `apps/api/scripts/`) as uid 1000 in the directory of
   step 3, so `migration-out/` must be writable by that uid (`chmod -R go+rwX migration-out`, or use
   `--user "$(id -u):$(id -g)"` instead):

   ```bash
   cd ~/cutover
   docker run --rm --user 1000:1000 \
     -e DATABASE_URL=file:/work/migration-out/toon.db -e UPLOAD_DIR=/work/migration-out/uploads \
     -e WEB_ORIGIN=https://<new-hostname> \
     -v "$PWD:/work" --entrypoint bun ghcr.io/toonvish/toon-household:latest \
     apps/api/scripts/migrate-legacy.ts \
     --recipe-db /work/migration-in/recipe/local.db --recipe-uploads /work/migration-in/recipe/uploads \
     --finance-db /work/migration-in/finance/local.db --report /work/migration-out/dry-run.json
   ```

   The other way is a checkout of this repository with Bun, exactly as
   [Commands](migration.md#commands) shows (`bun run migrate:legacy -- …`). Either way, read the whole
   report before going on: [The report](migration.md#the-report). The household proposal, the collisions,
   every warning and the balance table decide whether to continue. Fix and repeat until the dry run exits
   0, `== Errors ==` says `(none)` and every balance row says `OK`.

5. **Apply, then apply again.** The apply writes `migration-out/toon.db` and its uploads and prints the
   claim links of the finance placeholders. Those links are credentials, and so is the apply report:
   write it to a private directory outside any repository, never paste the output anywhere.

   ```bash
   cd ~/cutover
   export PRIVATE_DIR="$HOME/toon-cutover-private"
   mkdir -p -m 700 "$PRIVATE_DIR"
   docker run --rm --user 1000:1000 \
     -e DATABASE_URL=file:/work/migration-out/toon.db -e UPLOAD_DIR=/work/migration-out/uploads \
     -e WEB_ORIGIN=https://<new-hostname> \
     -v "$PWD:/work" -v "$PRIVATE_DIR:/private" --entrypoint bun ghcr.io/toonvish/toon-household:latest \
     apps/api/scripts/migrate-legacy.ts \
     --recipe-db /work/migration-in/recipe/local.db --recipe-uploads /work/migration-in/recipe/uploads \
     --finance-db /work/migration-in/finance/local.db --apply --report /private/apply.json
   ```

   Run the same command a second time without `--report`: it must write nothing and end with
   `[migrate:legacy] already migrated: nothing written.` See
   [Cutover order](migration.md#cutover-order) step 5 for the Bun form of both runs. The container runs as
   uid 1000, so `$PRIVATE_DIR` must belong to that uid (true for the first user of a fresh server; else
   `sudo chown 1000:1000 "$PRIVATE_DIR"`).

6. **Copy the result into `toon-household_toon-data`**, before the new stack has ever started. The
   rename to `local.db` is the name the stack's `DATABASE_URL` uses, and the `-wal` goes along if one
   exists. This is the exact command of [Cutover order](migration.md#cutover-order) step 6, with the real
   volume name:

   ```bash
   cd ~/cutover
   docker volume create toon-household_toon-data
   docker run --rm -v toon-household_toon-data:/data -v "$PWD/migration-out:/in:ro" alpine sh -c \
     'cp /in/toon.db /data/local.db && { [ ! -f /in/toon.db-wal ] || cp /in/toon.db-wal /data/local.db-wal; } && cp -a /in/uploads /data/uploads && chown -R 1000:1000 /data'
   ```

   The `chown` to 1000:1000 is required: the image runs as `USER bun`, which is uid 1000 (see the
   comment in the `Dockerfile`), and a volume pre-filled by a root container is not re-owned by Docker.
   Without it the database, its `-wal` and the uploads cannot be written (`EACCES`, see
   [Troubleshooting](#troubleshooting)). Docker Compose will warn on the first `up` that the volume
   "already exists but was not created by Docker Compose". That is expected and harmless: the name
   matches, so the stack uses it.

7. **Start the new stack.** Now, and only now, the ports are free.

   ```bash
   cd /opt/toon-household
   docker compose up -d
   docker compose ps                         # app must become "healthy", caddy "running"
   docker compose logs -f caddy              # three certificates: the new hostname and the two old ones
   ```

   If a certificate does not arrive, the cause is DNS or a firewall in front of the box, as in
   [Fresh install](#fresh-install), step 5. The stack runs the schema migrations at boot, which is a no-op
   on the migrated database.

8. **Verify.** In this order:

   - **Health:** `curl -s https://<new-hostname>/api/health` answers with `"modules":["recipe","finance"]`.
   - **The old hostnames redirect path by path (ADR 0008).** Three rows of each table in the Caddyfile
     are enough here; every row is checked in the milestone record:

     ```bash
     for p in / /plan /shopping; do
       curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://<old-recipe-hostname>$p"
     done
     # 301 https://<new-hostname>/recipe
     # 301 https://<new-hostname>/recipe/plan
     # 301 https://<new-hostname>/recipe/shopping

     for p in / /plan /new; do
       curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://<old-finance-hostname>$p"
     done
     # 301 https://<new-hostname>/finance
     # 301 https://<new-hostname>/finance/plan
     # 301 https://<new-hostname>/finance/new
     ```

   - **The retiring worker:** an installed old PWA asks its hostname for `/sw.js`; that must be a 200 with
     a self-unregistering worker, not a redirect:

     ```bash
     curl -sI https://<old-recipe-hostname>/sw.js | head -n 1      # HTTP/2 200
     curl -s  https://<old-recipe-hostname>/sw.js | head -n 1      # // Retires the service worker ...
     curl -s  https://<old-finance-hostname>/sw.js | head -n 1
     ```

   - **The data:** sign in (see [Cutover order](migration.md#cutover-order) step 8 for the account cases),
     open a recipe, the meal plan, a shopping list and the finance overview. The balance must equal the
     migrated balance in the report, plus any fixed-cost plan rows the first boot booked: the stack
     catches the plan up at start (`plan:run`), so a period that began after the old finance app last ran
     appears as a `Fixkostenanteil MM/YYYY` booking (origin `fixed_plan`) created at the first boot. Each
     such row moves the balance by its viewer share; the balance without them must match the report.
   - **People:** hand each claim link over privately (the placeholder's person registers through it),
     then act on the ADR 0005 warnings of the report: seat the second participant of a solo ledger,
     check the plan payer, remove an income that names someone who is not a participant.
   - **Mail:** a password reset to an external address arrives, or the link is in the app log
     ([Fresh install](#fresh-install), step 9; with a transport, unconfirmed accounts are read-only until
     they confirm their address).

9. **Switch deploys over.** Install `toon-household-deploy`, its key and this repository's secrets and the
   `DEPLOY_ENABLED` variable as in [Fresh install](#fresh-install), step 11. Then stop the old
   repositories from deploying: set their `DEPLOY_ENABLED` variable to `false` (or delete it), so a push
   there can no longer try to roll out to a stack that is gone. The old forced-command keys are removed
   in step 10, the new one is already in place.

10. **Retire the old stacks and toon-edge.** Once step 8 is satisfied. Keep the old `.env` files
    somewhere private for now (mail and OAuth values), and keep every old volume:

    ```bash
    sudo rm -rf /opt/toon-recipe /opt/toon-finance /opt/toon-edge
    docker network rm toon-edge
    sudo rm -f /usr/local/bin/toon-deploy /usr/local/bin/toon-finance-deploy
    grep -n -e toon-deploy -e toon-finance-deploy ~/.ssh/authorized_keys   # delete those lines (nano)
    docker image ls | grep -E 'toon-(recipe|finance)'                      # then docker image rm <id> for the old images
    ```

    Also remove the old deploy secrets in the two old repositories. `docker volume ls` must still list
    `toon-recipe_toon-data` and `toon-finance_toon-data`, and `migration-in/` stays too: they are the backup.

11. **Later: drop the redirects.** After the bookmarks and installed apps have had time to move (weeks:
    browsers cache a 301, and an installed old PWA retires its worker only on its next update check
    while the old hostname still answers `/sw.js`), unset `RECIPE_HOSTNAME` and `FINANCE_HOSTNAME` in
    `/opt/toon-household/.env` (delete the two lines) and apply it:

    ```bash
    cd /opt/toon-household
    nano .env
    docker compose up -d
    ```

    The old hostnames then stop answering; remove their DNS records afterwards.

12. **Last: delete the old volumes.** This is the owner's decision and the only step that cannot be
    undone: afterwards the old apps are gone for good. First take a backup of the new volume (see
    [Operations](#operations)) and keep it somewhere off the server. Then list what exists and remove it
    by name:

    ```bash
    docker volume ls | grep -E 'toon-(recipe|finance|edge)'
    docker volume rm toon-recipe_toon-data toon-finance_toon-data \
      toon-edge_caddy-data toon-edge_caddy-config
    docker volume rm toon-recipe_caddy-data toon-recipe_caddy-config    # only if the listing shows them (left from before toon-edge)
    rm -rf ~/cutover/migration-in ~/cutover/migration-out
    rm -rf "$PRIVATE_DIR"                   # the private apply report holds claim links
    ```

    With an internal CA (`TOON_TLS_ISSUER=internal`) the old caddy-data volume holds the private key of
    that CA. Deleting it means every device needs the new root certificate (see [Variants](#variants));
    with `acme` it makes no difference. Also remove the old OAuth callback URLs at the providers and the
    kept `.env` copies of step 10.

**Rolling back.** Until step 10 nothing old has been removed. If the new stack misbehaves, stop it
with `docker compose down` in `/opt/toon-household` (no flag: `toon-household_toon-data` stays), start
toon-edge first (`cd /opt/toon-edge && docker compose up -d`: it holds the ports and creates the
network), then the two old stacks. Their volumes are as they were at step 2. Anything entered in the new
stack after step 7 is not in the old ones; if that matters, export it first or accept the loss. A rollback
after step 10 means restoring the directories from your own copies, which is why step 10 waits for
step 8, and after step 12 there is no rollback.

---

## Variants

### No domain of your own (on the LAN)

Without a publicly resolvable name Caddy cannot get a Let's Encrypt certificate. It then issues one
from **its own local CA**:

```dotenv
# in .env
TOON_TLS_ISSUER=internal
TOON_HSTS_MAX_AGE=0          # HSTS on an internal name would lock you out
TOON_HOSTNAME=haushalt.fritz.box
```

Anything that resolves on the network works as the name: `<name>.fritz.box` on a FRITZ!Box, a `*.local`
name over mDNS (reliable on iOS and macOS, limited on Android) or a fixed entry in the router. The
two settings are Caddy's, fed from the same `.env`; they apply to every site of the stack.

**The root certificate then has to go onto every device.** Without it there is not merely a warning but
**no service worker**: the browser treats the origin as insecure despite "proceed anyway". Without a
service worker there is no install, **no offline shopping list and no offline finance capture** (exactly
the features that are meant to work offline), and no cached images. The app itself still works, like an
ordinary web page with a warning.

Fetch the certificate in the device's browser:

```
http://haushalt.fritz.box/toon-root-ca.crt
```

(deliberately `http://`: a device that does not know the CA yet cannot load it over the HTTPS this
very CA signs without walking into the warning we are trying to remove. What is published is a public
certificate; the CA's private key never leaves the `caddy-data` volume. In ACME mode the route answers
404.) Then install it:

- **iPhone / iPad:** load the file, *Settings*, *Profile Downloaded*, **Install**. Then
  **necessarily** *Settings*, *General*, *About*, *Certificate Trust Settings*, **enable** the
  certificate. Without that second step it has no effect.
- **Android:** *Settings*, *Security*, *Encryption and credentials*, *Install a certificate*, *CA
  certificate*, confirm the warning. Chrome on Android accepts only CAs installed that way.
- **macOS:** double-click, keychain *System*, open the certificate in Keychain Access, *Trust*,
  *Always Trust*.
- **Windows:** double-click, *Install Certificate*, *Local Machine*, *Trusted Root Certification
  Authorities*.
- **Linux:** `sudo cp toon-root-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`

> The `caddy-data` volume then holds the **private key of this CA**. If it is lost, Caddy creates a new
> CA and the root certificate has to be installed on every device again. Do not put it into a backup
> you hand on.

**A third case: a domain of your own but no open ports** (server on the LAN, public DNS records) needs
a DNS-01 challenge. That means a Caddy image built with your DNS provider's plugin (`caddy:builder`,
for example the module `github.com/caddy-dns/cloudflare`), its API token in the `caddy` service's
environment, and the issuer opened up with `acme { dns <provider> {env.<TOKEN>} }` in the Caddyfile's
global `cert_issuer` and in the `tls` block of the main site. The comment at the top of
`docker/Caddyfile` says the same.

### Photo and PDF import are optional

Off by default, and the published image can do photos only. Import by web address and by pasted text
is pure fetch-and-parse; OCR is the one part of this app with a real appetite: `tesseract` with the
language packs is ~105 MB, `poppler-utils` another ~28 MB, and a running job holds `sharp`, a decoded
~2000 px image and, for a PDF, the whole parsed document in memory. That is exactly why it can be
switched off: so the app fits a 1 GB VPS.

**Photo and PDF are switched separately**, and that is the difference between "fits 1 GB" and "does
not": a photo is ONE tesseract run, a scanned PDF is up to ten. On one core a scan runs into the
server's 60 s limit in every case, even with 4 GB RAM. One core handles photos and no scans, hence
the separate switch.

**Four switches, in pairs:**

| | where | effect |
| --- | --- | --- |
| `--build-arg WITH_OCR=1` | `docker build` | installs `tesseract-ocr` and `tesseract-ocr-deu` (~105 MB) into the image |
| `IMPORT_OCR_ENABLED=1` | runtime (`.env`) | enables **photo** import. The compose file defaults it to `0`. |
| `--build-arg WITH_PDF=1` | `docker build` | installs `poppler-utils` (~28 MB). **Defaults to the value of `WITH_OCR`.** |
| `IMPORT_PDF_ENABLED=1` | runtime (`.env`) | enables **PDF** import. The compose file sets an explicit `0` because the published image has no poppler. |

The three build-argument combinations (the tag is whatever you want to run; the local stack test below
uses `toon-household:local`):

```bash
# lean: no tesseract, no poppler
docker build -t toon-household:local .

# photo import only, German: THIS IS WHAT release.yml PUSHES TO GHCR (WITH_OCR=1 WITH_PDF=0)
docker build --build-arg WITH_OCR=1 --build-arg WITH_PDF=0 -t toon-household:local .

# photo AND PDF
docker build --build-arg WITH_OCR=1 -t toon-household:local .
```

**For photo import the published image is enough**: it only has to be switched on in `.env`. The
reason for the choice sits in auto-deploy: `deploy.yml` pins `TOON_IMAGE` to the digest of exactly that
build, so an image built by hand and transferred is overwritten by the next push to `main`. Whoever
wants **PDF** import builds their own (on the laptop, then push to a registry or
`docker save | ssh ... docker load`; building on a one-core VPS is a patience exercise) and needs
**2 GB RAM or more**.

#### German photo import on 1 GB and one core

`.env` of the stack:

```dotenv
IMPORT_OCR_ENABLED=1        # photos on
IMPORT_PDF_ENABLED=0        # PDFs deliberately off: they do not fit 60 s on one core
TESSERACT_LANGS=deu         # one language model instead of two
IMPORT_OCR_CONCURRENCY=1    # one tesseract process: that is the memory ceiling
```

`TOON_MEM_LIMIT` stays at the default `768m`; photo OCR needs no higher limit. Add the 2 GB swap of step
3: not as memory, but so that an outlier waits instead of being killed.

**Measured** in a container with `--memory=1g --cpus=1`, a real 12 MP photo through the real pipeline:

| | |
| --- | --- |
| duration of one photo | 2.3 s on a fast desktop core |
| memory peak of the whole job | 140 MB (Bun, sharp and the tesseract child together) |
| of which tesseract | ~44 MB (`deu`, 2000 px), ~59 MB with `deu+eng` |
| image | 527 MB instead of 421 MB lean |

The vCore of a cheap VPS is clearly slower: realistically **5 to 15 s per photo**, with the same memory.
In operation: the rest of the app stays usable meanwhile (tesseract is a process of its own), a second
person importing at the same time **waits** up to 30 s for a free slot and only then gets `429`, and
`TESSERACT_LANGS=deu` does not stop English recipes (the parsers are German anyway), it makes an
English PHOTO recognised worse. When photo import is off, `POST /imports/{image,pdf,file}` answer
`501 ocr_disabled` before the rate limit and before the body is read, `/api/health` reports
`features.ocrImport: false` and `features.pdfImport: false`, and the UI hides the photo and PDF
sections. A draft an earlier photo import created stays reviewable and saveable. `IMPORT_OCR_ENABLED=1`
or `IMPORT_PDF_ENABLED=1` on an image without the binary is no crash but the documented 422 that names
it (`tesseract_unavailable`, `rasterization_unavailable`); rebuild instead.

---

## Local stack test

Tests the complete stack (the image, the compose file, the Caddyfile and its redirects) on a
**development machine**, with hostnames ending in `.test` and Caddy's internal CA. **Never run this in
`/opt/toon-household`** and never on the server that serves the real app.

The test runs as **its own compose project, `toon-household-local`**. `.env.local-stack` (committed;
local-test values only, never use them on a server) sets `COMPOSE_PROJECT_NAME=toon-household-local`, and
every command below **spells the project out with `-p` as well**. Its volumes are therefore
`toon-household-local_toon-data`, `toon-household-local_caddy-data` and
`toon-household-local_caddy-config`, and the volume removal at the end can never reach the production
volume `toon-household_toon-data`: without a project name of its own, the compose file's
`name: toon-household` would put the test on the production names. Ports 80 and 443 on the machine must
be free (a stack of another project that still runs answers `port is already allocated`).

```bash
# from a checkout of the repository
docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?"     # minutes; "exit=0" is success
# photo import in the image: add --build-arg WITH_OCR=1 --build-arg WITH_PDF=0 (see Variants)

docker compose -p toon-household-local --env-file .env.local-stack config -q
docker compose -p toon-household-local --env-file .env.local-stack up -d
docker compose -p toon-household-local --env-file .env.local-stack ps      # app "healthy", caddy "running"
```

The three hostnames have no public DNS. Map them in `/etc/hosts`:

```bash
echo "127.0.0.1 haushalt.test rezepte.test finanzen.test" | sudo tee -a /etc/hosts
```

or leave `/etc/hosts` alone and tell `curl` where they are with `--resolve`. Fetch the local CA over
plain HTTP, then check the app through it:

```bash
curl -fsS --resolve haushalt.test:80:127.0.0.1 -o toon-root-ca.crt http://haushalt.test/toon-root-ca.crt
curl -fsS --resolve haushalt.test:443:127.0.0.1 --cacert toon-root-ca.crt https://haushalt.test/api/health
```

The health answer lists `modules` (`recipe`, `finance`) and the feature flags. In a browser,
`https://haushalt.test` shows a certificate warning until the root certificate is installed as in
[Variants](#variants). The two old hostnames redirect path by path; one row of the map:

```bash
curl -sI --resolve rezepte.test:443:127.0.0.1 --cacert toon-root-ca.crt https://rezepte.test/plan | grep -i '^location'
# location: https://haushalt.test/recipe/plan
```

Logs while it runs:
`docker compose -p toon-household-local --env-file .env.local-stack logs -f app caddy`.

Tear it down, **volumes included** (the only place in this guide that deletes volumes this way, and
the ones it removes are the test's own):

```bash
docker compose -p toon-household-local --env-file .env.local-stack down -v
```

Because `.env.local-stack` sets `COMPOSE_PROJECT_NAME`, the same commands without `-p` are equivalent;
the `-p` is spelled out so that a copy of any of them can never aim at the production names.

---

## Troubleshooting

### First installation

| Symptom | Cause / fix |
| --- | --- |
| `Permission denied (publickey)` | The key is not in `/home/<user>/.ssh/authorized_keys`, or the permissions are wrong (`700` on `.ssh`, `600` on the file). |
| `toon is not in the sudoers file` | The session is older than the `usermod -aG sudo toon`, or it never ran. Do it as `root`, then **log in completely anew**; check `id`. No root SSH any more: `su -`, otherwise the VNC console of the panel. If `id` already shows `sudo`, `/etc/sudoers` was changed: `grep -E '^%sudo' /etc/sudoers` must print `%sudo ALL=(ALL:ALL) ALL`; repair only with `visudo`. |
| `docker: permission denied` | Not logged in again after `usermod -aG docker`. |
| `exec format error` at start | A 32-bit userland. `uname -m` must be `x86_64` or `aarch64`. |
| `SESSION_SECRET is missing` at `up` | `.env` is not **next to** `docker-compose.yml`, or `SESSION_SECRET` is empty. |
| `manifest unknown` / `denied` at pull | The GHCR package is still private: `docker login ghcr.io -u <user>` with a read-only token, or switch it to *public* (step 6); otherwise a wrong `TOON_IMAGE` value. |
| Container permanently `unhealthy` | `docker compose logs app`. Usually a missing variable; the API names it in plain text at start. |
| `port is already allocated` | Another stack still holds 80 or 443: the old toon-edge stack, an old app stack with its own Caddy, or a local stack test. Stop it (`docker compose ps` in its directory) before starting this one. |

### TLS and reachability

| Symptom | Cause / fix |
| --- | --- |
| No certificate, ACME error in the `caddy` log | DNS points elsewhere, port 80/443 is closed (**the provider firewall first**), or `TOON_HOSTNAME` is an internal name, then `TOON_TLS_ISSUER=internal`. From outside: `dig +short <hostname>` and `curl -I http://<hostname>`. |
| Certificate warning despite a valid certificate | Access by IP or by a name other than `TOON_HOSTNAME`. Always use the same name. |
| An old hostname shows a certificate warning | Its DNS record does not point at this server, or `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME` is missing in `.env`: Caddy fetches a certificate for an old hostname only while the variable is set. |
| Warning **and** no install option | Internal CA without an installed root certificate (on iOS also *enable* it): [Variants](#variants). |
| The shopping list does not work offline | Same cause: no service worker without a trusted certificate. Check *Application, Service Workers* in the DevTools. |
| A blank app, or the browser blocks API calls with CSP errors | A bundle built without `PUBLIC_API_URL=""`: its absolute API URL is blocked by `connect-src 'self'`. The `Dockerfile` refuses to build such an image; a self-built image from an older tree can still be affected. Rebuild from a current checkout. |
| The app shows the old version after an update | Mostly a CDN or proxy in front. `sw.js` and `index.html` are served with `Cache-Control: no-cache`; nothing may override that. |
| The Caddyfile does not change after `sync-config` | `sync-config` restarts the caddy container only when the file actually changed (it compares the new file with the old one). If the file is right but the behaviour is not, run `docker compose restart caddy` by hand. |
| Password-reset links point at the wrong host | `TOON_HOSTNAME` in `.env` is not the name people use. |

### Data

| Symptom | Cause / fix |
| --- | --- |
| `EACCES` / `SQLITE_CANTOPEN` on the database after copying files into the volume | The files were copied in as root and are not owned by uid 1000, the `bun` user the app runs as. `docker run --rm -v toon-household_toon-data:/data alpine chown -R 1000:1000 /data` fixes it; [`docs/migration.md`](migration.md) copies with the `chown` included. |

### Mail

| Symptom | Cause / fix |
| --- | --- |
| Mails do not arrive | First `docker compose logs app \| grep '\[mail\]'` ([Checking mail](#checking-mail)). `NOT SENT` means no delivery is set up, usually `MAIL_TRANSPORT=smtp` is missing although `MAIL_HOST` and friends are set (step 9). Nothing there means the mail went out: check SPF, DKIM and DMARC before blaming the spam folder. |
| The API does not start and complains about `MAIL_SECURITY` | `none` together with `MAIL_USER` / `MAIL_PASSWORD` is forbidden on purpose; use `tls` (465) or `starttls` (587). |
| Container does not start, `MAIL_API_KEY` missing | `MAIL_TRANSPORT=resend` without a key. Set the key or switch to the SMTP route; a too old `docker-compose.yml` on the server does not pass the value through. |

### Import, memory, performance

| Symptom | Cause / fix |
| --- | --- |
| `501 ocr_disabled` on photo import | Expected unless `IMPORT_OCR_ENABLED=1` is set; the published image can do photos once it is switched on. A lean self-built image needs `--build-arg WITH_OCR=1`. |
| `ocr_failed` on every photo import | `IMPORT_OCR_ENABLED=1` on an image without the binaries. `docker compose exec app tesseract --list-langs` must show `deu` and `eng`. `reason` says what is missing: `tesseract_unavailable` (binary) or `language_data_missing` (language pack). Nothing is loaded at runtime. |
| `pdf_no_text_layer` on every scanned PDF | poppler is missing (the published image has none): `docker compose exec app pdftoppm -v`. |
| The container is "killed" during an import | Memory. Check swap (step 3) and `TOON_MEM_LIMIT`; on 1 GB `IMPORT_PDF_ENABLED=0` and `IMPORT_OCR_CONCURRENCY=1` belong with it. |
| Photo import answers `429` although nobody else imports | An earlier job still sits in its slot. `IMPORT_OCR_CONCURRENCY` is the slot count; a new import waits 30 s for a free one and only then answers `429`. After 60 s at the latest (`OCR_TIMEOUT_MS`) every job gives its slot back. |
| The app is slow, `docker stats` unremarkable | The disk. SQLite on slow storage is the most common cause. |

### Auto-deploy

| Symptom | Cause / fix |
| --- | --- |
| The deploy does not run at all | Usually the variable `DEPLOY_ENABLED` is not `true`, so the job is skipped (shown as *skipped* in the run). Otherwise: the `production` environment waits for an approval, or the push was not to `main` or a `v*` tag. |
| `Host key verification failed` | `DEPLOY_SSH_KNOWN_HOSTS` does not match the server (rebuilt, another port, or read from the laptop instead of the server). Again: `ssh-keyscan -p <port> <host>` **on the server**. |
| `Permission denied (publickey)` | The public key is not in the `authorized_keys` of `DEPLOY_SSH_USER`, or `DEPLOY_SSH_KEY` holds the public instead of the private half. |
| `ERROR: Unknown command` | The forced command works, but the script is older than the workflow (or the reverse). Fetch `toon-household-deploy` again (step 11a). |
| `permission denied` on the Docker socket | `DEPLOY_SSH_USER` is not in the `docker` group: `sudo usermod -aG docker <user>`. Applies to new sessions only. |
| `docker compose pull` fetches nothing new | `.env` has a fixed `@sha256:...` digest in `TOON_IMAGE`. Set it back to `:latest` for running updates. |
| `denied` on the first pull in the deploy | The GHCR package is private (step 6); the forced command cannot log in for you. |

---

## What is deliberately missing

- **No mail server and no Mailpit service.** Without mail settings the app logs the links; with a
  provider's SMTP access it sends. A viewer for mail that goes nowhere is not part of the stack (the
  one safe way to add one for a test is in [Operations](#operations)).
- **No path prefixes** (`example.org/recipe`, `example.org/finance` as separate apps). The modules
  share one origin and one build; the path is baked into the build (Vite `base`, the manifest scope, the
  router, the session cookie's path), and a prefix would mean one image per path.
- **No Content-Security-Policy in Caddy.** The app sends its own, hashed over the built `index.html`;
  a second, differing one at the proxy would silently turn the app into a blank page. The proxy adds
  only the headers the app cannot set for itself.
- **Photo and PDF import are off by default.** The published image can do photos (`WITH_OCR=1`) and not
  PDFs (`WITH_PDF=0`); see [Variants](#variants).
- **Google and GitHub sign-in are off.** E-mail and password is the self-hosted way; everything works
  without OAuth.
- **No shared edge proxy.** The stack has its own Caddy, and one stack per server owns ports 80 and
  443. The old toon-edge stack goes away in the cutover.
