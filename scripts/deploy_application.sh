#!/usr/bin/env bash
# QTIP Application Deployment Script (Linux / bash)
#
# Bash equivalent of `scripts/deploy_application.ps1`. Phases mirror the
# PowerShell version one-for-one so the runbook in
# `docs/deployment_runbook.md` applies unchanged on Linux hosts.
#
#   1. Prereq check (node, npm, pm2, mysql client)
#   2. Build backend + frontend
#   3. Apply DB migrations (delegates to scripts/deploy_database.sh)
#   4. Stop existing PM2 processes
#   5. Start the app via ecosystem.config.cjs --env <env>
#   6. Health check (/monitoring/health, /monitoring/ready)
#
# Usage:
#   ./scripts/deploy_application.sh -e staging
#   ./scripts/deploy_application.sh -e production --skip-build
#   ./scripts/deploy_application.sh -e production --health-check-only
#   ./scripts/deploy_application.sh -e production --restart

set -u
set -o pipefail

ENV=""
SKIP_BUILD=0
SKIP_DATABASE=0
HEALTH_CHECK_ONLY=0
RESTART=0
HEALTH_TIMEOUT=300
BACKEND_PORT="${PORT:-3000}"

print_usage() {
  cat <<EOF
Usage: $0 -e|--environment <development|staging|production>
          [--skip-build] [--skip-database]
          [--health-check-only] [--restart]
          [--health-timeout SECONDS]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--environment)    ENV="$2"; shift 2 ;;
    --skip-build)        SKIP_BUILD=1; shift ;;
    --skip-database)     SKIP_DATABASE=1; shift ;;
    --health-check-only) HEALTH_CHECK_ONLY=1; shift ;;
    --restart)           RESTART=1; shift ;;
    --health-timeout)    HEALTH_TIMEOUT="$2"; shift 2 ;;
    -h|--help)           print_usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; print_usage; exit 2 ;;
  esac
done

case "$ENV" in
  development|staging|production) ;;
  *) echo "ERROR: --environment must be development, staging or production" >&2
     print_usage; exit 2 ;;
esac

# ---- logging --------------------------------------------------------------
mkdir -p ./logs
LOG_FILE="./logs/deployment_$(date +%Y%m%d_%H%M%S).log"

log()   { local lvl="$1" msg="$2"; printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$lvl" "$msg" | tee -a "$LOG_FILE"; }
info()  { log INFO    "$1"; }
warn()  { log WARN    "$1"; }
err()   { log ERROR   "$1" >&2; }
ok()    { log SUCCESS "$1"; }

# ---- env loader (best-effort; backend reads its own .env at runtime) ------
load_env() {
  if [[ -f ".env" ]]; then
    set -a; . ".env"; set +a
    ok "Root .env loaded"
  elif [[ -f "backend/.env" ]]; then
    set -a; . "backend/.env"; set +a
    ok "backend/.env loaded"
  else
    warn "No .env found; relying on shell environment"
  fi
}

# ---- prereqs --------------------------------------------------------------
check_prereqs() {
  info "Checking deployment prerequisites..."
  local missing=()
  for tool in node npm mysql; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    else
      info "  ${tool}: $(${tool} --version 2>&1 | head -1)"
    fi
  done

  if ! command -v pm2 >/dev/null 2>&1; then
    warn "PM2 not found - installing globally..."
    if ! npm install -g pm2; then
      missing+=("pm2")
    fi
  else
    info "  pm2: $(pm2 --version 2>&1 | head -1)"
  fi

  if (( ${#missing[@]} > 0 )); then
    err "Missing required tools: ${missing[*]}"
    return 1
  fi
}

# ---- build ----------------------------------------------------------------
build_app() {
  if (( SKIP_BUILD == 1 )); then info "Skipping build step"; return 0; fi

  info "Cleaning previous builds..."
  rm -rf ./backend/dist ./frontend/dist

  info "Building backend..."
  ( cd backend && npm ci && npm run build ) || { err "Backend build failed"; return 1; }
  ok "Backend build completed"

  info "Building frontend..."
  ( cd frontend && npm ci && npm run build ) || { err "Frontend build failed"; return 1; }
  ok "Frontend build completed"
}

# ---- database -------------------------------------------------------------
deploy_db() {
  if (( SKIP_DATABASE == 1 )); then info "Skipping database deployment"; return 0; fi
  info "Delegating to scripts/deploy_database.sh..."
  local extra=()
  if [[ "$ENV" == "production" ]]; then extra+=(--backup-first); fi
  if ! bash ./scripts/deploy_database.sh -e "$ENV" "${extra[@]}"; then
    err "Database deployment failed"
    return 1
  fi
  ok "Database deployment completed"
}

# ---- pm2 lifecycle --------------------------------------------------------
stop_app() {
  info "Stopping existing application processes..."
  pm2 stop all   >/dev/null 2>&1 || true
  pm2 delete all >/dev/null 2>&1 || true

  # Belt-and-suspenders: kill anything still bound to :3000 / :5173.
  for port in "$BACKEND_PORT" 5173; do
    if command -v lsof >/dev/null 2>&1; then
      local pids
      pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      if [[ -n "$pids" ]]; then
        info "  killing pid(s) on :${port}: ${pids}"
        kill -9 $pids 2>/dev/null || true
      fi
    fi
  done
  ok "Stopped existing processes"
}

start_app() {
  info "Starting application via PM2 (--env ${ENV})..."
  if [[ ! -f "./ecosystem.config.cjs" ]]; then
    err "ecosystem.config.cjs not found at repo root"
    return 1
  fi
  if pm2 start ./ecosystem.config.cjs --env "$ENV"; then
    ok "Application started"
    pm2 status | tee -a "$LOG_FILE"
    return 0
  fi
  err "PM2 failed to start the application"
  return 1
}

# ---- health check ---------------------------------------------------------
health_check() {
  local timeout="${1:-$HEALTH_TIMEOUT}"
  info "Performing application health check (timeout=${timeout}s)..."
  local backend="http://localhost:${BACKEND_PORT}"
  local health="${backend}/monitoring/health"
  local ready="${backend}/monitoring/ready"
  local deadline=$(( $(date +%s) + timeout ))

  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -sSf --max-time 10 "$health" 2>/dev/null | grep -q '"status"\s*:\s*"ok"'; then
      ok "Backend /monitoring/health: PASS"
      if curl -sSf --max-time 10 "$ready" 2>/dev/null | grep -q '"status"\s*:\s*"ready"'; then
        ok "Backend /monitoring/ready: PASS"
        return 0
      fi
      warn "  /monitoring/ready not yet ready, retrying..."
    else
      warn "  /monitoring/health not yet healthy, retrying..."
    fi
    sleep 10
  done

  err "Health check timeout after ${timeout}s"
  return 1
}

# ---- modes ----------------------------------------------------------------
run_health_only() {
  load_env
  if health_check "$HEALTH_TIMEOUT"; then ok "Health check passed"; exit 0
  else err "Health check failed"; exit 1; fi
}

run_restart() {
  load_env
  info "Restart mode: stop -> start -> health-check"
  stop_app
  sleep 5
  start_app && health_check "$HEALTH_TIMEOUT" && { ok "Restart successful"; exit 0; }
  err "Restart failed"; exit 1
}

run_full_deploy() {
  local started_at; started_at=$(date +%s)
  load_env
  check_prereqs || exit 1
  build_app    || exit 1
  deploy_db    || exit 1
  stop_app
  sleep 5
  start_app    || exit 1
  health_check "$HEALTH_TIMEOUT" || {
    err "Post-deployment health check failed"
    exit 1
  }
  local elapsed=$(( $(date +%s) - started_at ))
  ok "Deployment completed in ${elapsed}s.  Log: ${LOG_FILE}"
}

# ---- main -----------------------------------------------------------------
echo "QTIP Application Deployment - ${ENV}"
echo "===================================="

if (( HEALTH_CHECK_ONLY == 1 )); then run_health_only; fi
if (( RESTART == 1 ));            then run_restart;     fi
run_full_deploy
