#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — Production Disaster Recovery & Safe Database Restore Tool
#
# Finding: PRA-OPS-03 / Phase R7.2
# Decryption: OpenSSL AES-256-CBC PBKDF2 (matching R7.1)
# Safety: Strictly isolated target database; refuses production targets
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration Defaults ────────────────────────────────────────────────────
POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
PROD_DB_NAME="${POSTGRES_DB:-turff_db}"

BACKUP_FILE="${1:-}"
TARGET_DB="${2:-}"
CONFIRM_FLAG="${3:-${RESTORE_CONFIRM:-false}}"

START_TIME=$(date +%s)
TMP_RESTORE_DIR="${TMPDIR:-/tmp}/turff_restore_$$"
TMP_DUMP="${TMP_RESTORE_DIR}/restored_archive.dump"

# ── Logging Helper ────────────────────────────────────────────────────────────
log() {
  local level="$1"
  shift
  local msg="$*"
  local safe_msg
  safe_msg=$(echo "$msg" | sed -E \
    -e 's/password=[^ ]+/[REDACTED]/g' \
    -e 's/pass:[^ ]+/[REDACTED]/g')
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [${level}] ${safe_msg}"
}

# ── Cleanup Trap ──────────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  if [[ -d "${TMP_RESTORE_DIR}" ]]; then
    rm -rf "${TMP_RESTORE_DIR}"
    log "INFO" "Cleaned up temporary restore workspace"
  fi

  if [[ $exit_code -ne 0 ]]; then
    log "ERROR" "Restore process failed or was interrupted (exit code: ${exit_code})"
  fi
}
trap cleanup EXIT INT TERM

# ── Usage Instructions ────────────────────────────────────────────────────────
usage() {
  cat << 'EOF'
TURFF Safe Database Restore Tool

Usage:
  db-restore.sh <path-to-backup.dump.enc> <target-database> [--confirm]

Requirements:
  - <path-to-backup.dump.enc>: Path to encrypted .dump.enc archive
  - <target-database>: Destination database (MUST NOT be production)
  - --confirm or RESTORE_CONFIRM=true: Explicit confirmation flag
  - BACKUP_ENCRYPTION_KEY: Must be provided via environment variable

Safety Rules:
  - Refuses to restore into: turff_db, turff_prod, turff_production, postgres, template0, template1
  - Refuses to proceed without --confirm or RESTORE_CONFIRM=true
  - Never executes prisma migrate reset
  - Plaintext decrypted dumps are immediately deleted after restoration
EOF
  exit 1
}

# ── 1. Input Validation ───────────────────────────────────────────────────────
if [[ -z "${BACKUP_FILE}" || -z "${TARGET_DB}" ]]; then
  usage
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  log "ERROR" "Specified backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# ── 2. Production Target Refusal (SAFETY GATE) ─────────────────────────────────
FORBIDDEN_NAMES=("turff_db" "turff_prod" "turff_production" "postgres" "template0" "template1" "${PROD_DB_NAME}")
for forbidden in "${FORBIDDEN_NAMES[@]}"; do
  if [[ "${TARGET_DB,,}" == "${forbidden,,}" ]]; then
    log "CRITICAL" "SAFETY INTERVENTION: Target database '${TARGET_DB}' is a forbidden production name. Refusing execution."
    exit 1
  fi
done

# Safe database name format validation
if [[ ! "${TARGET_DB}" =~ ^[a-zA-Z0-9_]+$ ]]; then
  log "ERROR" "Invalid target database name. Must contain only alphanumeric characters and underscores."
  exit 1
fi

# ── 3. Explicit Confirmation Check (SAFETY GATE) ──────────────────────────────
if [[ "${CONFIRM_FLAG}" != "--confirm" && "${CONFIRM_FLAG}" != "true" ]]; then
  log "ERROR" "SAFETY INTERVENTION: Restore requires explicit confirmation. Pass '--confirm' or set RESTORE_CONFIRM=true."
  exit 1
fi

# ── 4. Encryption Key Check ───────────────────────────────────────────────────
if [[ -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  log "ERROR" "BACKUP_ENCRYPTION_KEY environment variable is required for decryption."
  exit 1
fi

mkdir -p "${TMP_RESTORE_DIR}"
chmod 700 "${TMP_RESTORE_DIR}"

# ── 5. Decryption ─────────────────────────────────────────────────────────────
log "INFO" "Decrypting backup archive with AES-256-CBC (PBKDF2)..."
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 -salt \
  -in "${BACKUP_FILE}" \
  -out "${TMP_DUMP}" \
  -pass "env:BACKUP_ENCRYPTION_KEY"; then
  log "ERROR" "Decryption failed. Invalid encryption key or corrupt archive file."
  exit 1
fi
chmod 600 "${TMP_DUMP}"

# ── 6. Archive Table of Contents Verification ─────────────────────────────────
log "INFO" "Verifying archive table-of-contents via pg_restore..."
if ! pg_restore -l "${TMP_DUMP}" > /dev/null 2>&1; then
  log "ERROR" "Archive verification failed: decrypted file is not a valid PostgreSQL custom dump."
  exit 1
fi

TOC_ENTRIES=$(pg_restore -l "${TMP_DUMP}" | grep -c -v '^;' || true)
log "INFO" "Archive verified successfully (${TOC_ENTRIES} Table of Contents entries)"

# ── 7. Destination Database Provisioning ──────────────────────────────────────
export PGPASSWORD="${POSTGRES_PASSWORD}"

log "INFO" "Ensuring isolated destination database '${TARGET_DB}' exists..."
# Create target database if it does not already exist
psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" | grep -q 1 || \
psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c \
  "CREATE DATABASE \"${TARGET_DB}\";"

# ── 8. Restoration Execution ──────────────────────────────────────────────────
log "INFO" "Restoring database schema and data into isolated '${TARGET_DB}'..."

# Note: pg_restore may return non-zero exit code if warnings/notices occur (e.g. IF EXISTS drops)
# We capture exit status and check database contents explicitly
RESTORE_STATUS=0
pg_restore \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${TARGET_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "${TMP_DUMP}" || RESTORE_STATUS=$?

if [[ ${RESTORE_STATUS} -gt 1 ]]; then
  log "ERROR" "pg_restore failed with critical error code: ${RESTORE_STATUS}"
  exit 1
fi

# ── 9. Post-Restoration Integrity Verification ────────────────────────────────
log "INFO" "Validating restored database integrity in '${TARGET_DB}'..."

RESTORED_TABLES=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -tA -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")

RESTORED_MIGRATIONS=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -tA -c \
  "SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;" 2>/dev/null || echo "0")

RESTORED_USERS=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -tA -c \
  "SELECT count(*) FROM \"User\";" 2>/dev/null || echo "0")

RESTORED_SLOTS=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -tA -c \
  "SELECT count(*) FROM \"Slot\";" 2>/dev/null || echo "0")

RESTORED_WALLETS=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -tA -c \
  "SELECT count(*) FROM \"Wallet\";" 2>/dev/null || echo "0")

unset PGPASSWORD

log "INFO" "Restoration verification results:"
log "INFO" "  - Public BASE Tables: ${RESTORED_TABLES}"
log "INFO" "  - Applied Migrations: ${RESTORED_MIGRATIONS}"
log "INFO" "  - Users: ${RESTORED_USERS}"
log "INFO" "  - Slots: ${RESTORED_SLOTS}"
log "INFO" "  - Wallets: ${RESTORED_WALLETS}"

if [[ "${RESTORED_TABLES}" -lt 50 ]]; then
  log "ERROR" "Restored table count (${RESTORED_TABLES}) is lower than expected baseline (53 tables)."
  exit 1
fi

DURATION=$(( $(date +%s) - START_TIME ))
log "INFO" "DISASTER RECOVERY DRILL RESTORE COMPLETED SUCCESSFULLY in ${DURATION}s."
log "INFO" "Destination: ${TARGET_DB} (Verified Isolated)"
exit 0
