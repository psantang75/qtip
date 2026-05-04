#!/usr/bin/env bash
# QTIP remote-VM smoke test.
#
# Validates that we can SSH into a freshly-provisioned QTIP VM and that
# the host satisfies the prerequisites in `docs/deployment_runbook.md`
# (sudo, OS, outbound egress to npm/github/AI providers, DB reachability).
#
# Usage:
#   ./scripts/verify_remote.sh stage
#   ./scripts/verify_remote.sh prod
#   ./scripts/verify_remote.sh --host 10.90.15.6 --user qtip-admin
#
# The default hostnames/IPs come from IT's provisioning ticket; override
# with --host / --user / --port if the deploy target moves.

set -u
set -o pipefail

DEFAULT_USER="qtip-admin"
DEFAULT_PORT="22"
STAGE_HOST="10.90.15.6"
PROD_HOST="10.90.15.5"

print_usage() {
  cat <<EOF
Usage: $0 <stage|prod> [--user USER] [--port PORT]
       $0 --host HOST   [--user USER] [--port PORT]
EOF
}

# ---- arg parsing -----------------------------------------------------------
TARGET=""
HOST=""
USER_NAME="$DEFAULT_USER"
PORT="$DEFAULT_PORT"

while [[ $# -gt 0 ]]; do
  case "$1" in
    stage|prod) TARGET="$1"; shift ;;
    --host)     HOST="$2";   shift 2 ;;
    --user)     USER_NAME="$2"; shift 2 ;;
    --port)     PORT="$2";   shift 2 ;;
    -h|--help)  print_usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; print_usage; exit 2 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  case "$TARGET" in
    stage) HOST="$STAGE_HOST" ;;
    prod)  HOST="$PROD_HOST" ;;
    *) echo "ERROR: pass stage|prod or --host HOST" >&2; print_usage; exit 2 ;;
  esac
fi

LABEL="${TARGET:-$HOST}"

# ---- pretty print helpers --------------------------------------------------
green()  { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$1"; }

PASS=0
FAIL=0
record() { # $1 = exit_code, $2 = label
  if [[ "$1" -eq 0 ]]; then green "  PASS  $2"; PASS=$((PASS+1));
  else                       red   "  FAIL  $2"; FAIL=$((FAIL+1)); fi
}

# ---- run ------------------------------------------------------------------
echo "QTIP remote verification --> ${USER_NAME}@${HOST}:${PORT} (${LABEL})"
echo "----------------------------------------------------------------------"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -p "$PORT")

# 1. Can we even reach the SSH port?
echo
yellow "[1/5] SSH reachability"
ssh "${SSH_OPTS[@]}" "${USER_NAME}@${HOST}" "echo ssh-ok" >/dev/null 2>&1
record "$?" "ssh handshake (port ${PORT})"

if [[ "$FAIL" -gt 0 ]]; then
  red "Cannot SSH into host. Stopping; nothing else can be tested."
  exit 1
fi

# Build one remote command that runs every check. One round-trip is much
# faster than ssh-ing five times, and avoids interactive sudo prompts.
REMOTE_SCRIPT=$(cat <<'REMOTE'
set +e
echo "---HOST---"
uname -srm
. /etc/os-release 2>/dev/null && echo "OS=${PRETTY_NAME}"
echo "TZ=$(date +%Z) ($(timedatectl 2>/dev/null | awk -F': *' '/Time zone/ {print $2}'))"

echo "---SUDO---"
if sudo -n true 2>/dev/null; then echo "SUDO=passwordless"; else echo "SUDO=interactive_or_denied"; fi

echo "---DISK---"
df -h --output=avail / | tail -1

echo "---TOOLS---"
for t in node npm pm2 nginx mysql git; do
  if command -v "$t" >/dev/null 2>&1; then
    case "$t" in
      nginx) ver=$(nginx -v 2>&1 | sed 's|^nginx version: ||') ;;
      *)     ver=$($t --version 2>&1 | head -1) ;;
    esac
    printf '%s=%s\n' "$t" "$ver"
  else
    printf '%s=MISSING\n' "$t"
  fi
done

echo "---EGRESS---"
egress() {
  local label="$1" url="$2"
  local code
  code=$(curl -sS -o /dev/null --max-time 8 -w '%{http_code}' "$url" 2>/dev/null)
  if [[ -z "$code" || "$code" == "000" ]]; then
    echo "${label}=BLOCKED"
  else
    echo "${label}=${code}"
  fi
}
egress egress_github     https://github.com
egress egress_npm        https://registry.npmjs.org
egress egress_github_api https://api.github.com
egress egress_openai     https://api.openai.com/v1/models
egress egress_anthropic  https://api.anthropic.com

echo "---DONE---"
REMOTE
)

echo
yellow "[2/5] Host facts (OS, sudo, tools, egress)"
REMOTE_OUT=$(ssh -o BatchMode=yes -o ConnectTimeout=15 -p "$PORT" \
                 "${USER_NAME}@${HOST}" "bash -s" <<<"$REMOTE_SCRIPT" 2>&1)
SSH_RC=$?
record "$SSH_RC" "remote-script execution"

if [[ "$SSH_RC" -ne 0 ]]; then
  echo "$REMOTE_OUT"
  exit 1
fi

# Persist a copy locally so we can paste it back to IT if anything is wrong.
mkdir -p ./logs
LOG_FILE="./logs/verify_remote_${LABEL}_$(date +%Y%m%d_%H%M%S).log"
echo "$REMOTE_OUT" > "$LOG_FILE"

# ---- evaluate the captured output -----------------------------------------
echo
yellow "[3/5] Sudo + base requirements"
if grep -q "^SUDO=passwordless"          <<<"$REMOTE_OUT"; then record 0 "passwordless sudo"; else record 1 "passwordless sudo (got: $(grep ^SUDO= <<<"$REMOTE_OUT"))"; fi
if grep -q "^OS="                         <<<"$REMOTE_OUT"; then record 0 "OS detected ($(grep ^OS= <<<"$REMOTE_OUT" | head -1))"; else record 1 "OS detection"; fi

echo
yellow "[4/5] Required CLI tools"
for tool in node npm git; do
  if grep -q "^${tool}=MISSING" <<<"$REMOTE_OUT"; then
    record 1 "${tool} installed"
  else
    record 0 "${tool} installed ($(grep "^${tool}=" <<<"$REMOTE_OUT" | head -1))"
  fi
done
for tool in pm2 nginx mysql; do
  if grep -q "^${tool}=MISSING" <<<"$REMOTE_OUT"; then
    yellow "  WARN  ${tool} not installed yet (we install this during bootstrap)"
  else
    record 0 "${tool} installed ($(grep "^${tool}=" <<<"$REMOTE_OUT" | head -1))"
  fi
done

echo
yellow "[5/5] Outbound egress"
check_egress() { # $1=label, $2=human-name
  local val
  val=$(grep "^${1}=" <<<"$REMOTE_OUT" | cut -d= -f2)
  case "$val" in
    BLOCKED|"")                 record 1 "${2} reachable (BLOCKED)" ;;
    2*|3*|4*|5*)                record 0 "${2} reachable (HTTP ${val})" ;;
    *)                          record 1 "${2} reachable (got: ${val})" ;;
  esac
}
check_egress egress_github     "github.com"
check_egress egress_npm        "registry.npmjs.org"
check_egress egress_github_api "api.github.com"
check_egress egress_openai     "api.openai.com (AI Reviewer)"
check_egress egress_anthropic  "api.anthropic.com (AI Reviewer)"

# ---- summary --------------------------------------------------------------
echo
echo "----------------------------------------------------------------------"
if [[ "$FAIL" -eq 0 ]]; then
  green "All checks passed (${PASS}/${PASS}).  Log: ${LOG_FILE}"
  exit 0
else
  red "Failed: ${FAIL}.  Passed: ${PASS}.  Log: ${LOG_FILE}"
  echo "Forward the log to IT for any FAIL items in §1, §3, or §5 (egress)."
  exit 1
fi
