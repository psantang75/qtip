#!/usr/bin/env bash
# QTIP VM bootstrap (Ubuntu 24.04 LTS).
#
# Idempotent host-prep for `qtip-stage` and `qtip-prod`. Install the runtime
# bits the deployment runbook (`docs/deployment_runbook.md`) assumes are
# present:
#
#   - Node.js 20 LTS + npm  (via NodeSource apt repo)
#   - PM2 (global, system-wide)
#   - nginx                  (reverse proxy + SPA host)
#   - mysql-client           (used by `scripts/deploy_database.sh`)
#   - /opt/qtip              (deploy dir, owned by the deploy user)
#
# Run via SSH from your workstation:
#
#   ssh qtip-admin@10.90.15.6 "sudo bash -s" < scripts/bootstrap_vm.sh   # stage
#   ssh qtip-admin@10.90.15.5 "sudo bash -s" < scripts/bootstrap_vm.sh   # prod
#
# Or directly on the VM as `qtip-admin`:
#
#   sudo bash ./bootstrap_vm.sh
#
# Re-running is safe: every step checks "is it already installed / done"
# before acting.

set -euo pipefail

NODE_MAJOR=20
DEPLOY_DIR="/opt/qtip"
DEPLOY_USER="${SUDO_USER:-qtip-admin}"

log()  { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] WARN  %s\n' "$*" >&2; }
err()  { printf '[bootstrap] ERROR %s\n' "$*" >&2; }

# Sanity: must run as root (or via sudo). Apt + npm -g require it.
if [[ "${EUID}" -ne 0 ]]; then
  err "Must be run as root.  Try: sudo bash $0  (or via ssh: sudo bash -s)"
  exit 1
fi

# Sanity: this script targets Ubuntu 24.04. Refuse anything else so we
# don't corrupt a host running a different package layout.
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  err "Expected Ubuntu, got '${ID:-unknown}'.  Aborting."
  exit 1
fi
log "Host: ${PRETTY_NAME}  (deploy user: ${DEPLOY_USER})"

# ── 1. apt prerequisites ───────────────────────────────────────────────────
log "[1/5] apt prerequisites (curl, ca-certificates, gnupg)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsof >/dev/null

# ── 2. Node.js 20 via NodeSource ───────────────────────────────────────────
log "[2/5] Node.js ${NODE_MAJOR} LTS"
if command -v node >/dev/null 2>&1 \
   && node -v | grep -qE "^v${NODE_MAJOR}\."; then
  log "  Node $(node -v) already installed; skipping NodeSource setup"
else
  install -d -m 0755 /etc/apt/keyrings
  if [[ ! -s /etc/apt/keyrings/nodesource.gpg ]]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    chmod 0644 /etc/apt/keyrings/nodesource.gpg
  fi
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
  log "  Installed Node $(node -v)  /  npm $(npm -v)"
fi

# ── 3. PM2 (global) ────────────────────────────────────────────────────────
log "[3/5] PM2"
if command -v pm2 >/dev/null 2>&1; then
  log "  PM2 $(pm2 -v) already installed; skipping"
else
  npm install -g --silent pm2
  log "  Installed PM2 $(pm2 -v)"
fi

# Wire pm2 to start on boot under the deploy user. When `pm2 startup` is
# invoked as root with `-u <user> --hp <home>`, current PM2 versions
# write and enable the systemd unit directly — no need to parse and eval
# the printed sudo command. We tolerate non-zero here so a quirky PM2
# version doesn't abort the rest of the bootstrap.
if systemctl list-unit-files 2>/dev/null | grep -q "^pm2-${DEPLOY_USER}\.service"; then
  log "  pm2 systemd unit already configured"
else
  log "  Configuring pm2 systemd unit for ${DEPLOY_USER}"
  set +e
  pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" >/tmp/pm2-startup.out 2>&1
  PM2_RC=$?
  set -e
  if [[ "${PM2_RC}" -ne 0 ]] || ! systemctl list-unit-files 2>/dev/null | grep -q "^pm2-${DEPLOY_USER}\.service"; then
    warn "  pm2 startup did not register systemd unit (rc=${PM2_RC}); see /tmp/pm2-startup.out on the host"
    warn "  Continuing — you can run \`sudo pm2 startup systemd -u ${DEPLOY_USER} --hp /home/${DEPLOY_USER}\` manually later"
  else
    systemctl enable "pm2-${DEPLOY_USER}.service" >/dev/null 2>&1 || true
    log "  pm2 systemd unit registered"
  fi
fi

# ── 4. nginx + mysql client ────────────────────────────────────────────────
log "[4/5] nginx + mysql client"
apt-get install -y -qq nginx mysql-client >/dev/null
systemctl enable --now nginx >/dev/null 2>&1 || true
log "  nginx: $(nginx -v 2>&1)"
log "  mysql client: $(mysql --version)"

# ── 5. /opt/qtip deploy directory ──────────────────────────────────────────
log "[5/5] ${DEPLOY_DIR} (owned by ${DEPLOY_USER})"
install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}"
install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}/logs"
install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}/uploads"
install -d -m 0755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${DEPLOY_DIR}/scripts/backups"

# ── Summary ────────────────────────────────────────────────────────────────
echo
log "──────────────────────────────────────────────────────"
log "Bootstrap complete."
log "  Node     : $(node -v)"
log "  npm      : $(npm -v)"
log "  PM2      : $(pm2 -v)"
log "  nginx    : $(nginx -v 2>&1 | sed 's/.*nginx\///')"
log "  mysql    : $(mysql --version | awk '{print $3}')"
log "  Deploy   : ${DEPLOY_DIR} (owner ${DEPLOY_USER})"
log "──────────────────────────────────────────────────────"
