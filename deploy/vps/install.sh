#!/usr/bin/env bash
# One-time setup of the API deploys on the VPS. Safe to run again. Run as root: sudo deploy/vps/install.sh
# Needs: uv on PATH, Python 3.12 at /opt/uv-python (see bopomofo-deploy), PostgreSQL with the bopomofo and
# bopomofo_test databases, and /etc/bopomofo/api.env.
set -Eeuo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
BASE=/opt/bopomofo
USER_HOME=/var/lib/bopomofo-deploy

id bopomofo-deploy &>/dev/null ||
  useradd --system --home-dir "$USER_HOME" --create-home --shell /usr/sbin/nologin bopomofo-deploy
install -d -m 755 -o bopomofo-deploy -g bopomofo-deploy "$BASE/src" "$BASE/releases" "$BASE/venvs"
install -d -m 755 "$BASE/slots"
install -d -m 755 "$BASE/shared"
install -d -m 700 "$USER_HOME/state"
[[ -x /usr/local/bin/uv ]] || install -m 755 "$(command -v uv)" /usr/local/bin/uv

# Speech and voice models live outside the releases. Adopt a copy installed by hand in $BASE/backend.
if [[ ! -e $BASE/shared/models && -d $BASE/backend/models && ! -L $BASE/backend/models ]]; then
  mv -T "$BASE/backend/models" "$BASE/shared/models"
  ln -s "$BASE/shared/models" "$BASE/backend/models"
fi
install -d -m 755 "$BASE/shared/models"

# The hand-installed copy becomes the first release, laid out like the repository, so a deploy can roll back to
# it. $BASE/backend stays as a link, because a running API started from there keeps using that path.
if [[ -d $BASE/backend && ! -L $BASE/backend ]]; then
  rel=$BASE/releases/$(date -u +%Y%m%d-%H%M%S)-manual
  install -d -m 755 "$rel/frontend/public"
  mv -T "$BASE/backend" "$rel/backend"
  ln -s "$rel/backend" "$BASE/backend"
  cp -r "$repo/frontend/public/data" "$rel/frontend/public/data"
  echo "installed by hand before CD" >"$rel/REVISION"
  ln -sfn "$rel" "$BASE/current"
fi

# Read-only deploy key for the private repository, and GitHub's published ed25519 host key.
ssh_dir=$USER_HOME/.ssh
install -d -m 700 -o bopomofo-deploy -g bopomofo-deploy "$ssh_dir"
[[ -f $ssh_dir/id_ed25519 ]] ||
  runuser -u bopomofo-deploy -- ssh-keygen -q -t ed25519 -N '' -C "bopomofo-deploy@$(hostname)" -f "$ssh_dir/id_ed25519"
echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' >"$ssh_dir/known_hosts"
chown bopomofo-deploy:bopomofo-deploy "$ssh_dir/known_hosts"

install -m 755 "$here/bopomofo-deploy" /usr/local/sbin/bopomofo-deploy
install -m 644 "$here/bopomofo-api@.service" "$here/bopomofo-deploy.service" "$here/bopomofo-deploy.timer" /etc/systemd/system/
[[ -f /etc/bopomofo/deploy.env ]] || install -m 600 "$here/deploy.env.example" /etc/bopomofo/deploy.env
systemctl daemon-reload

# Caddy reads the serving port from a file that bopomofo-deploy rewrites. Until the first deploy with slots,
# the API keeps running as bopomofo-api.service on 8765, so the file starts there.
caddyfile=/etc/caddy/Caddyfile
upstream=/etc/caddy/bopomofo-api-upstream
[[ -f $upstream ]] || install -m 644 /dev/stdin "$upstream" <<<'reverse_proxy 127.0.0.1:8765'
if ! grep -q "import $upstream" "$caddyfile"; then
  cp -p "$caddyfile" "$caddyfile.before-slots-$(date -u +%Y%m%dT%H%MZ)"
  awk -v imp="import $upstream" '
    /^api\.bopomofo\.app[[:space:]]*\{/ { in_api = 1 }
    in_api && /^[[:space:]]*reverse_proxy[[:space:]]+127\.0\.0\.1:8765[[:space:]]*$/ { sub(/reverse_proxy.*/, imp); done = 1 }
    in_api && /^\}/ { in_api = 0 }
    { print }
    END { if (!done) exit 1 }
  ' "$caddyfile" >"$caddyfile.new" || { rm -f "$caddyfile.new"; echo "edit the api.bopomofo.app block of $caddyfile by hand: import $upstream" >&2; exit 1; }
  if ! out=$(caddy validate --config "$caddyfile.new" --adapter caddyfile 2>&1); then
    printf '%s\n' "$out" >&2
    exit 1
  fi
  chmod --reference="$caddyfile" "$caddyfile.new" && mv -T "$caddyfile.new" "$caddyfile"
  systemctl reload caddy
fi

cat <<EOF
Next:
  1. Put the test database URL in /etc/bopomofo/deploy.env.
  2. Add the read-only deploy key to GitHub:
       gh repo deploy-key add $ssh_dir/id_ed25519.pub --title "bopomofo VPS deploys"
  3. Deploy once and start the timer:
       bopomofo-deploy deploy origin/main && systemctl enable --now bopomofo-deploy.timer
EOF
