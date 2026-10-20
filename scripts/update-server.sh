#!/usr/bin/env bash
# Updates a Tora home server (docs/home-server.md) to the latest pushed code: both repos, packages,
# database migrations, the plug-ins' data, a new build, and a restart of the app. Run on the
# server, from anywhere: `ssh -t minipc code/tora-v2/scripts/update-server.sh` (sudo asks for the
# server's password to restart the app).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

before="$(git rev-parse --short HEAD)"
git pull --ff-only
git submodule update --init
echo "code: $before -> $(git rev-parse --short HEAD), collectors $(git -C collectors rev-parse --short HEAD)"
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm plugins
pnpm build
sudo systemctl restart tora-app
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 3
  if curl -sf -o /dev/null http://127.0.0.1:3000/login; then
    echo "Tora is up."
    exit 0
  fi
done
echo "The app does not answer: journalctl -u tora-app -n 50 --no-pager"
exit 1
