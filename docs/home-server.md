# A home server

Instead of Vercel + Turso, the whole of Tora can run on one small always-on computer at home (a
mini PC with a low-power CPU uses about 6-10 W): the app, the database (a local file, no read
quota), the nightly collect (which needs a home connection anyway) and a browser for store feeds
([Store notices](store-feeds.md)). It is reached from anywhere through a free Tailscale Funnel
address (`https://<machine>.<tailnet>.ts.net`): no app on the phone, no router port opened, and a
changing home IP does not matter.

What you take on: updates, and keeping backups off the box (its disk fails, they go with it).

The steps below are for Ubuntu Server 24.04; each is run on the server unless said otherwise.
`<user>` is your user on the server, the code is cloned to `~/code/tora-v2`.

## 1. The box

- Updates and the time zone: `sudo apt update && sudo apt full-upgrade -y`,
  `sudo timedatectl set-timezone <your zone, e.g. Asia/Tokyo>`. Security updates install themselves
  (`/etc/apt/apt.conf.d/20auto-upgrades`).
- ssh with a key from your PC (`ssh-keygen`, `ssh-copy-id`), then key-only logins:
  `PasswordAuthentication no` and `KbdInteractiveAuthentication no` in
  `/etc/ssh/sshd_config.d/10-keys-only.conf` (check the key works first).
- Reserve the box's addresses in the router (one per network port and for Wi-Fi).
- Wi-Fi: turn its power saving off (a oneshot service running
  `iw dev <wifi> set power_save off`). A cable is better: a netplan file with the cable ports
  (`match: name: "en*"`, `dhcp4: true`, `route-metric: 100`, `optional: true`) makes the cable
  preferred and Wi-Fi the fallback (`sudo netplan try` undoes itself if ssh drops).
- Remove what you do not use (an old Docker with an admin page open on the network, for example).
- In the BIOS, "Restore on AC power loss", so the box comes back after a power cut.

## 2. Node, the code, the data

- Node with nvm, the version the repo names in `.nvmrc` (`nvm install`, then `corepack enable`;
  pnpm comes from `packageManager`), and a link the services run Node through:
  `ln -sfn "$(dirname "$(dirname "$(nvm which default)")")" ~/.local/share/tora/node`. Updates
  install a new `.nvmrc` version themselves and move the link (section 7).
- The code: give the server read-only deploy keys on GitHub (one per repo, write access off) with
  an ssh host alias each, clone, point the `collectors` submodule at its alias, `pnpm install`.
- The data from the previous machine: the database file (`~/.local/share/tora/local/tora.db`),
  the backups, `~/.local/state/tora/time-zone`; and `.env` with `AUTH_SECRET` (the same one, or
  every authenticator stops working), plug-in keys, and
  `DATABASE_URL=file:/home/<user>/.local/share/tora/local/tora.db`. Then `pnpm db:migrate`,
  `pnpm plugins`, `pnpm build`.

## 3. Services

`/etc/systemd/system/tora-app.service` (the app, on the box only; the Funnel brings the outside
in). `$NODE_BIN` is `/home/<user>/.local/share/tora/node/bin` (the link above, so a new Node
needs no change here):

```ini
[Unit]
Description=Tora web app
After=network-online.target
Wants=network-online.target

[Service]
User=<user>
WorkingDirectory=/home/<user>/code/tora-v2
Environment=PATH=$NODE_BIN:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ExecStart=$NODE_BIN/pnpm --filter @tora/web start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The collect: `tora-collect.service` (`Type=oneshot`, the same `User`, `PATH`, and
`ExecStart=/home/<user>/code/tora-v2/scripts/collect-cron.sh`) and `tora-collect.timer`
(`OnCalendar=*-*-* *:05:00`, `Persistent=true`). `collect-cron.sh` runs the day's collect, backup
and alerts once a day (the first check after midnight) and a "collect now" from the app on the
next check ([Running collectors](running.md)). Before the first check, if the old machine already
collected today: `date +%F > ~/.local/state/tora/last-success-date`.

Enable them: `sudo systemctl daemon-reload && sudo systemctl enable --now tora-app tora-collect.timer`.

## 4. The address (Tailscale, tailnet only)

Since 2026-10-31 Tora answers only on the tailnet (Tailscale Serve), not on the internet (Funnel):
only devices signed in to your tailnet reach it, so a stranger cannot even reach the login page.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=tora
sudo tailscale set --operator=$USER   # Serve without sudo
tailscale serve --bg 3000             # https://tora.<tailnet>.ts.net, tailnet devices only
tailscale serve status
```

Each phone or PC that opens Tora needs the Tailscale app, signed in to the same tailnet (or a
shared node, for someone else). The address and its certificate are the same as Funnel's was, so
logins, devices and the installed app keep working. With https, logins work as on Vercel (no
`TORA_LOCAL_HTTP`). Alert links open only on tailnet devices.

Moving from Funnel: `tailscale funnel --https=443 off` (or `tailscale serve reset`), then the
Serve line above; stop the public address check (`sudo systemctl disable --now tora-funnel.timer`);
the Funnel node attribute in the tailnet's access controls can go.

### Keeping the address up (Funnel only)

`ops/funnel-check.sh` (tora-funnel timer) checks the public address and sets the Funnel up again
after a boot with no network; it is off with the tailnet-only address. If the tailnet address
fails after such a boot, `tailscale serve --bg 3000` again or `sudo systemctl restart tailscaled`.

## 5. A browser for store feeds

A real Firefox on a virtual screen, seen from your PC through ssh:

```bash
# Firefox from Mozilla's repository (Ubuntu's is a snap, awkward as a service)
sudo install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | sudo tee /etc/apt/keyrings/packages.mozilla.org.asc >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" | sudo tee /etc/apt/sources.list.d/mozilla.list >/dev/null
printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' | sudo tee /etc/apt/preferences.d/mozilla >/dev/null
# Ubuntu's own "firefox" (a stub that installs the snap) is versioned 1:1snap1, which sorts above
# every real Firefox: blocked, or the nightly unattended upgrade swaps Mozilla's for it.
printf 'Package: firefox*\nPin: version 1:1snap*\nPin-Priority: -1\n' | sudo tee /etc/apt/preferences.d/firefox-no-snap
# Unattended upgrades take only Ubuntu's origins by default: Mozilla's too, for its security updates.
printf 'Unattended-Upgrade::Origins-Pattern { "site=packages.mozilla.org"; };\n' | sudo tee /etc/apt/apt.conf.d/51unattended-upgrades-mozilla
sudo apt update && sudo apt install -y firefox tigervnc-standalone-server tigervnc-tools openbox fonts-noto-cjk xclip
```

Check: `apt-cache policy firefox` shows Mozilla's version installed, and `pgrep -af firefox` shows
`/usr/lib/firefox`, never `/snap` (the snap refuses to run as a service: "is not a snap cgroup").

Four services, all with `User=<user>`:

- `tora-display`: the virtual screen and its VNC server in one (TigerVNC's Xvnc, whose clipboard
  carries Japanese text; x11vnc's does not): `/usr/bin/Xvnc :1 -geometry 1400x1000 -depth 24
-localhost -rfbport 5900 -SecurityTypes None -AlwaysShared -nolisten tcp` (only reachable from
  the box itself).
- `tora-wm`: a window manager (`Environment=DISPLAY=:1`, `/usr/bin/openbox`, after and requiring
  `tora-display`, before `tora-browser`). Without one, Firefox's menus open but take no clicks.
- `tora-clip`: keeps the clipboard in step (`Environment=DISPLAY=:1`, `/usr/bin/vncconfig -nowin`,
  after and requiring `tora-display`).
- `tora-browser`: `Environment=DISPLAY=:1`, `/usr/bin/firefox --profile /home/<user>/.tora-firefox
--no-remote <board address>`, `Restart=always`, after and requiring `tora-display`.

One window with the board, kept between restarts: the service starts Firefox without an address
(an address opens a new tab each time) and the profile's `user.js` pins the settings Firefox applies
at every start: restore the last session (`browser.startup.page` 3, also after a crash without
asking: `browser.sessionstore.max_resumed_crashes` -1), the board as home page when there is no
session, and no welcome or "what's new" tabs (`browser.startup.homepage_override.mstone` "ignore",
`startup.homepage_welcome_url` and `startup.homepage_override_url` empty,
`browser.aboutwelcome.enabled` false).

To see the screen, from your PC: `ssh -L 5900:localhost:5900 <server>` and a VNC viewer (e.g.
TigerVNC) on `localhost:5900`; copy and paste work both ways (the viewer's Options > Input >
clipboard boxes ticked). Install your userscript manager and feed there; the feed's address is
`http://localhost:3000`. To install or update a userscript without its menus, serve its folder for
a while (`timeout 600 python3 -m http.server 8765 --bind 127.0.0.1` in it) and open
`http://127.0.0.1:8765/<name>.user.js` in that Firefox: the manager offers to install it.

## 6. Backups off the box

On your PC (WSL or Linux, with an ssh key for the server):

```bash
ops/copy-backups.sh <server> [folder]            # copy now
ops/copy-backups.sh install <server> [folder]    # Windows: a hidden task at logon and every 6 hours
```

The copies go to the folder given (default `BACKUP_DIR`, else `~/.local/share/tora/backups`;
for example `~/backups/tora`, next to other apps' copies). It mirrors the server's backups (what the server prunes is pruned here too, never when the server
suddenly holds almost none) and refreshes the analysis copy for read-only queries
([Backups](backups.md)). The PC is no longer a Tora host: point its `DATABASE_URL` at the analysis
copy, and remove its own collect task.

The same task watches the server from outside, since nothing on the server can say it is down:
with `TORA_STATUS_URL` and `TORA_STATUS_TOKEN` (Settings > Admin > Server) and `TORA_WATCH_DISCORD`
(a Discord channel's webhook link) in the repo's `.env`, a server not answering its address
for a day (`TORA_WATCH_HOURS`, default 24) is told once on that channel, and again when it answers.
Only while the PC is on. With the tailnet-only address, WSL must reach the tailnet: Tailscale on
Windows plus WSL's mirrored networking (test: `curl -sI https://tora.<tailnet>.ts.net` in WSL).

## 7. Updates

The server updates itself: every 5 minutes it checks GitHub, and when there are new commits it
pulls both repos, installs, migrates, saves the plug-ins' data, builds, restarts the app and checks
it answers (`ops/update-server.sh --auto`). Never while a collect runs (it waits for the next
check). When a step fails, it goes back to the version before, keeps that running, tells admins
(Discord, Telegram) and does not try that version again until a newer push. Every update is in
Settings > Activity; the log is `~/.local/state/tora/update.log`. While the app builds (a minute
or two), pages may fail to load.

It installs a new commit only after GitHub CI passed on that exact commit (`ops/ci-status.sh` reads
its check runs; the repo is public, so no token), and updates to that commit even when a later one
arrived meanwhile (that one waits for its own CI). While CI runs, or when GitHub gives no usable
answer (no network, an error, its rate limit), nothing changes and the next check asks again; the
update log notes it once per commit and status. When the server has gone 24 hours without updating
because CI is not green (counted from the server's own version, so newer pushes do not restart it;
an update or a reported CI failure does), admins are told once and it keeps waiting. An alert no admin channel took is sent
again at each check until one does. Only a passed run counts: a failed or unanswered check never
updates the server. When CI failed, the server stays where it is, does not ask about that commit
again until a newer push, and admins get an alert saying CI failed (in Settings > Activity too). The
private collectors are not gated (CI does not check them out). By hand, the script prints the
commit's CI status as a warning and updates anyway. A fork without CI sets
`TORA_UPDATE_REQUIRE_CI=0` in `.env`.

- CI failed, then a re-run passed on the same commit: the server does not notice by itself. Run
  `ops/update-server.sh` by hand, or delete `~/.local/state/tora/update-failed` and the next check
  updates.
- A commit CI never runs on (`[skip ci]` in its message, a push that changes only ignored paths, a
  disabled workflow) is never installed by the automatic update: it waits, and the 24-hour alert
  says so. Push a commit CI runs on, or update by hand.
- "CI passed" means the run named exactly `check` (the job in `.github/workflows/ci.yml`) concluded
  `success` and no other counted run failed. No `check` run yet, or one that concluded `skipped` or
  `neutral`, means CI did not test the commit, so the server waits. Renaming that job holds every
  update back until `ops/ci-status.sh` follows.
- The process job (`process-check`) never holds back an update: `ops/ci-status.sh` drops it by that
  exact name before the verdict, and it can never stand in for `check`. A run with any other name
  still counts.

The restart needs root: a sudoers rule allows that one command without a password, and the timer
runs the script:

```bash
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart tora-app" | sudo tee /etc/sudoers.d/tora-update
sudo chmod 440 /etc/sudoers.d/tora-update && sudo visudo -c
```

`tora-update.service` (`Type=oneshot`, `User=<user>`, the same `PATH` as the collect,
`ExecStart=/home/<user>/code/tora-v2/ops/update-server.sh --auto`) and `tora-update.timer`
(`OnCalendar=*:0/5`), enabled like the others. By hand, any time:
`ssh -t <server> code/tora-v2/ops/update-server.sh`.

Node: the repo names its version in `.nvmrc` (e.g. after a Node security release). An update
that brings a new one installs it with nvm, makes it the default and points
`~/.local/share/tora/node` at it before installing packages; going back to the version before
points it back.

Settings > Collectors > Schedule shows when things run: the server's hourly check (each one is
recorded by `pnpm collect:request`), the next daily collect, each collector's likely start (last
night's, moved to the next collect), what else the collect does, and the other timers (the
morning check, the store feed check, updates).

Logs: `journalctl -u tora-app`, `~/.local/state/tora/collect.log`, `~/.local/state/tora/update.log`.
