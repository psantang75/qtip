#!/usr/bin/env bash
# QTIP Database Deployment Script (Linux / bash)
#
# Bash equivalent of `scripts/deploy_database.ps1`. Aligns with the
# Prisma-based flow described in `docs/deployment_runbook.md` §3.3:
#
#   1. Load `backend/.env`
#   2. (Optional) take a logical backup with mysqldump
#   3. Run `prisma migrate deploy --schema backend/prisma/schema.prisma`
#   4. Re-generate the Prisma client
#   5. Smoke-verify a few core tables exist
#
# Usage:
#   ./scripts/deploy_database.sh -e staging
#   ./scripts/deploy_database.sh -e production --backup-first
#   ./scripts/deploy_database.sh -e production --verify-only

set -u
set -o pipefail

ENV=""
BACKUP_FIRST=0
VERIFY_ONLY=0

print_usage() {
  cat <<EOF
Usage: $0 -e|--environment <development|staging|production>
          [--backup-first] [--verify-only]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--environment) ENV="$2"; shift 2 ;;
    --backup-first)   BACKUP_FIRST=1; shift ;;
    --verify-only)    VERIFY_ONLY=1;  shift ;;
    -h|--help)        print_usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; print_usage; exit 2 ;;
  esac
done

case "$ENV" in
  development|staging|production) ;;
  *) echo "ERROR: --environment must be development, staging or production" >&2
     print_usage; exit 2 ;;
esac

# ---- helpers --------------------------------------------------------------
log()   { printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2"; }
info()  { log INFO    "$1"; }
warn()  { log WARN    "$1"; }
err()   { log ERROR   "$1" >&2; }
ok()    { log SUCCESS "$1"; }

# ---- load .env (backend/.env first, then root .env as fallback) -----------
load_env() {
  local f
  for f in "backend/.env" ".env"; do
    if [[ -f "$f" ]]; then
      # Parse KEY=VALUE literally rather than `source`-ing the file.
      # Sourcing breaks when a value contains shell metacharacters (e.g. a
      # ')' in a DB password triggers "syntax error near unexpected token").
      # Reading line-by-line treats every value as a literal string.
      local line key val
      while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line#"${line%%[![:space:]]*}"}"   # ltrim
        [[ -z "$line" || "$line" == \#* ]] && continue
        [[ "$line" == export\ * ]] && line="${line#export }"
        [[ "$line" != *=* ]] && continue
        key="${line%%=*}"
        val="${line#*=}"
        key="${key%"${key##*[![:space:]]}"}"        # rtrim key
        # strip one layer of matching surrounding quotes
        if [[ "$val" == \"*\" || "$val" == \'*\' ]]; then
          val="${val:1:${#val}-2}"
        fi
        [[ -z "$key" ]] && continue
        export "$key=$val"
      done < "$f"
      ok "Environment loaded from $f"
      return 0
    fi
  done
  warn "No .env found (looked in backend/.env and ./.env)"
}

require_env() {
  local missing=()
  for v in DB_HOST DB_USER DB_PASSWORD DB_NAME; do
    if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
  done
  if (( ${#missing[@]} > 0 )); then
    err "Missing required env vars: ${missing[*]}"
    exit 1
  fi
}

# ---- DB tasks -------------------------------------------------------------
test_connection() {
  info "Testing database connection to ${DB_USER}@${DB_HOST}/${DB_NAME}..."
  if MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" \
       -e "SELECT 1" >/dev/null 2>&1; then
    ok "Database connection successful"
    return 0
  fi
  err "Database connection failed"
  return 1
}

create_backup() {
  local dir="./scripts/backups"
  mkdir -p "$dir"
  local ts file
  ts=$(date +%Y%m%d_%H%M%S)
  file="${dir}/qtip_backup_${ENV}_${ts}.sql"
  info "Creating database backup -> ${file}"
  if MYSQL_PWD="$DB_PASSWORD" mysqldump \
       -h "$DB_HOST" -u "$DB_USER" \
       --single-transaction --routines --triggers \
       "$DB_NAME" > "$file" 2>/dev/null; then
    local size_mb
    size_mb=$(du -m "$file" | cut -f1)
    ok "Backup created (${size_mb} MB)"
    echo "$file"
    return 0
  fi
  err "Backup failed"
  return 1
}

run_prisma_migrations() {
  info "Applying Prisma migrations (prisma migrate deploy)..."
  if (cd backend && npx prisma migrate deploy); then
    ok "Migrations applied"
  else
    err "Migration failed"
    return 1
  fi
  info "Regenerating Prisma client..."
  if (cd backend && npx prisma generate); then
    ok "Prisma client regenerated"
    return 0
  fi
  err "Prisma generate failed"
  return 1
}

verify_deployment() {
  info "Verifying database deployment..."
  local q passed=0 failed=0
  declare -a checks=(
    "users_table:SELECT COUNT(*) FROM users"
    "roles_table:SELECT COUNT(*) FROM roles"
    "departments_table:SELECT COUNT(*) FROM departments"
    "forms_table:SELECT COUNT(*) FROM forms"
    "admin_user_exists:SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id = r.id WHERE r.role_name = 'Admin'"
  )
  for check in "${checks[@]}"; do
    local name="${check%%:*}" sql="${check#*:}"
    if MYSQL_PWD="$DB_PASSWORD" mysql -N -h "$DB_HOST" -u "$DB_USER" "$DB_NAME" \
         -e "$sql" >/dev/null 2>&1; then
      ok "  ${name}: PASS"
      passed=$((passed+1))
    else
      err "  ${name}: FAIL"
      failed=$((failed+1))
    fi
  done
  if (( failed > 0 )); then
    err "Verification failed (${failed}/${#checks[@]})"
    return 1
  fi
  ok "All verification checks passed (${passed}/${#checks[@]})"
}

# ---- main -----------------------------------------------------------------
echo "QTIP Database Deployment - ${ENV}"
echo "================================="

load_env
require_env
test_connection || exit 1

if (( VERIFY_ONLY == 1 )); then
  verify_deployment
  exit $?
fi

if (( BACKUP_FIRST == 1 )); then
  if ! create_backup >/dev/null; then
    err "Backup failed. Aborting deployment."
    exit 1
  fi
fi

if ! run_prisma_migrations; then
  err "Migration failed. Restore from the backup above if needed."
  exit 1
fi

if ! verify_deployment; then
  err "Post-migration verification failed."
  exit 1
fi

ok "Database deployment for ${ENV} completed successfully"
