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

## 4. The address (Tailscale Funnel)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=tora
sudo tailscale funnel --bg 3000   # the first time, approve Funnel at the link it prints
```

Rename the tailnet first if you want its friendlier name (admin console > DNS). The address can
take from minutes to about an hour to appear in public DNS. With https, logins work as on Vercel
(no `TORA_LOCAL_HTTP`). Sign the old devices out (`pnpm user revoke <name> all`) before logging in
at the new address: each account has 2 device slots.

## 5. A browser for store feeds

A real Firefox on a virtual screen, seen from your PC through ssh:

```bash
# Firefox from Mozilla's repository (Ubuntu's is a snap, awkward as a service)
sudo install -d -m 0755 /etc/apt/keyrings
wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O- | sudo tee /etc/apt/keyrings/packages.mozilla.org.asc >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" | sudo tee /etc/apt/sources.list.d/mozilla.list >/dev/null
printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' | sudo tee /etc/apt/preferences.d/mozilla >/dev/null
sudo apt update && sudo apt install -y firefox tigervnc-standalone-server tigervnc-tools openbox fonts-noto-cjk xclip
```

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

To see the screen, from your PC: `ssh -L 5900:localhost:5900 <server>` and a VNC viewer (e.g.
TigerVNC) on `localhost:5900`; copy and paste work both ways (the viewer's Options > Input >
clipboard boxes ticked). Install your userscript manager and feed there; the feed's address is
`http://localhost:3000`. To install or update a userscript without its menus, serve its folder for
a while (`timeout 600 python3 -m http.server 8765 --bind 127.0.0.1` in it) and open
`http://127.0.0.1:8765/<name>.user.js` in that Firefox: the manager offers to install it.

## 6. Backups off the box

On your PC (WSL or Linux, with an ssh key for the server):

```bash
scripts/copy-backups.sh <server>            # copy now
scripts/copy-backups.sh install <server>    # Windows: a task at logon and every 6 hours
```

It mirrors the server's backups (what the server prunes is pruned here too, never when the server
suddenly holds almost none) and refreshes the analysis copy for read-only queries
([Backups](backups.md)). The PC is no longer a Tora host: point its `DATABASE_URL` at the analysis
copy, and remove its own collect task.

## 7. Updates

The server updates itself: every 5 minutes it checks GitHub, and when there are new commits it
pulls both repos, installs, migrates, saves the plug-ins' data, builds, restarts the app and checks
it answers (`scripts/update-server.sh --auto`). Never while a collect runs (it waits for the next
check). When a step fails, it goes back to the version before, keeps that running, tells admins
(Discord, Telegram) and does not try that version again until a newer push. Every update is in
Settings > Activity; the log is `~/.local/state/tora/update.log`. While the app builds (a minute
or two), pages may fail to load.

The restart needs root: a sudoers rule allows that one command without a password, and the timer
runs the script:

```bash
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart tora-app" | sudo tee /etc/sudoers.d/tora-update
sudo chmod 440 /etc/sudoers.d/tora-update && sudo visudo -c
```

`tora-update.service` (`Type=oneshot`, `User=<user>`, the same `PATH` as the collect,
`ExecStart=/home/<user>/code/tora-v2/scripts/update-server.sh --auto`) and `tora-update.timer`
(`OnCalendar=*:0/5`), enabled like the others. By hand, any time:
`ssh -t <server> code/tora-v2/scripts/update-server.sh`.

Node: the repo names its version in `.nvmrc` (e.g. after a Node security release). An update
that brings a new one installs it with nvm, makes it the default and points
`~/.local/share/tora/node` at it before installing packages; going back to the version before
points it back.

Settings > Collectors > Schedule shows when things run: the server's hourly check (each one is
recorded by `pnpm collect:request`), the next daily collect, each collector's likely start (last
night's, moved to the next collect), what else the collect does, and the other timers (the
morning check, the store feed check, updates).

Logs: `journalctl -u tora-app`, `~/.local/state/tora/collect.log`, `~/.local/state/tora/update.log`.
