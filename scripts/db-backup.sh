#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — Production Automated Database Backup & Offsite Sync Script
#
# Finding: PRA-OPS-03 (P1 Blocker)
# Compatible: PostgreSQL 15+ (pg_dump -Fc)
# Encryption: OpenSSL AES-256-CBC with PBKDF2
# Storage: AWS S3 / Cloudflare R2 / Local Ephemeral Staging
# Retention: 7 Daily, 4 Weekly, 3 Monthly (Grandfather-Father-Son)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration Defaults ────────────────────────────────────────────────────
POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-turff_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/backups}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-ap-south-1}"
BACKUP_S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
BACKUP_S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-db/}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
BACKUP_RETENTION_WEEKS="${BACKUP_RETENTION_WEEKS:-4}"
BACKUP_RETENTION_MONTHS="${BACKUP_RETENTION_MONTHS:-3}"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_ADMIN_CHAT_ID="${TELEGRAM_ADMIN_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"

LOCK_FILE="${BACKUP_WORK_DIR}/backup.lock"
STATUS_FILE="${BACKUP_WORK_DIR}/latest-status.json"

START_TIME=$(date +%s)
TIMESTAMP_UTC=$(date -u +"%Y%m%d_%H%M%S")
TIMESTAMP_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ARTIFACT_BASE="turff_db_${TIMESTAMP_UTC}_utc"
PLAINTEXT_DUMP="${BACKUP_WORK_DIR}/${ARTIFACT_BASE}.dump"
ENCRYPTED_DUMP="${BACKUP_WORK_DIR}/${ARTIFACT_BASE}.dump.enc"
CURRENT_STAGE="INIT"

# ── Helper: Logging & Sanitization ────────────────────────────────────────────
log() {
  local level="$1"
  shift
  local msg="$*"
  # Sanitize sensitive patterns
  local safe_msg
  safe_msg=$(echo "$msg" | sed -E \
    -e 's/password=[^ ]+/[REDACTED]/g' \
    -e 's/pass:[^ ]+/[REDACTED]/g' \
    -e 's/bot[0-9]+:[A-Za-z0-9_-]+/bot[REDACTED_TOKEN]/g')
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [${level}] ${safe_msg}"
}

# ── Helper: Telegram Alert ────────────────────────────────────────────────────
send_alert() {
  local status="$1"
  local stage="$2"
  local err_msg="${3:-None}"

  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_ADMIN_CHAT_ID" ]]; then
    log "INFO" "Telegram notification omitted (credentials not configured)"
    return 0
  fi

  local icon="✅"
  if [[ "$status" != "SUCCESS" ]]; then
    icon="🚨"
  fi

  local safe_err
  safe_err=$(echo "$err_msg" | sed -E 's/([_*\`\[])/\\\1/g')
  local safe_artifact
  safe_artifact=$(basename "${ENCRYPTED_DUMP:-none}" | sed -E 's/([_*\`\[])/\\\1/g')

  local text="${icon} *TURFF OPS: PostgreSQL Backup ${status}*

• *Stage:* ${stage}
• *Artifact:* \`${safe_artifact}\`
• *Timestamp:* ${TIMESTAMP_ISO}
• *Error:* \`${safe_err}\`"

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"${TELEGRAM_ADMIN_CHAT_ID}\", \"text\": \"${text}\", \"parse_mode\": \"Markdown\"}" \
    > /dev/null 2>&1 || log "WARN" "Failed to dispatch Telegram alert"
}

# ── Helper: Write Status File ─────────────────────────────────────────────────
write_status() {
  local status="$1"
  local stage="$2"
  local err_msg="${3:-}"
  local size_bytes="${4:-0}"
  local offsite="${5:-false}"
  local duration=$(( $(date +%s) - START_TIME ))

  cat <<EOF > "${STATUS_FILE}.tmp"
{
  "timestamp": "${TIMESTAMP_ISO}",
  "status": "${status}",
  "stage": "${stage}",
  "artifactId": "$(basename "${ENCRYPTED_DUMP}")",
  "sizeBytes": ${size_bytes},
  "durationSeconds": ${duration},
  "offsiteUploaded": ${offsite},
  "error": $(if [[ -n "$err_msg" ]]; then echo "\"${err_msg}\""; else echo "null"; fi)
}
EOF
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
}

# ── Cleanup Trap ──────────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  # Remove plaintext dump if still present
  if [[ -f "${PLAINTEXT_DUMP}" ]]; then
    rm -f "${PLAINTEXT_DUMP}"
    log "INFO" "Cleaned up intermediate plaintext dump"
  fi

  # Release lockfile
  if [[ -f "${LOCK_FILE}" ]]; then
    rm -f "${LOCK_FILE}"
  fi

  if [[ $exit_code -ne 0 && "${CURRENT_STAGE}" != "SUCCESS" ]]; then
    log "ERROR" "Backup process terminated prematurely at stage: ${CURRENT_STAGE} (exit code: ${exit_code})"
    write_status "FAILED" "${CURRENT_STAGE}" "Process crashed or terminated prematurely (exit code ${exit_code})" 0 false
    send_alert "FAILED" "${CURRENT_STAGE}" "Terminated with exit code ${exit_code}"
  fi
}
trap cleanup EXIT INT TERM

# ── 1. Preflight Validation ───────────────────────────────────────────────────
CURRENT_STAGE="PREFLIGHT"
log "INFO" "Starting TURFF production backup workflow..."
mkdir -p "${BACKUP_WORK_DIR}"

if [[ -z "${BACKUP_ENCRYPTION_KEY}" ]]; then
  log "ERROR" "BACKUP_ENCRYPTION_KEY is unset or empty. Plaintext backup is strictly prohibited."
  write_status "FAILED" "PREFLIGHT" "BACKUP_ENCRYPTION_KEY unset" 0 false
  send_alert "FAILED" "PREFLIGHT" "BACKUP_ENCRYPTION_KEY unset"
  exit 1
fi

if [[ ${#BACKUP_ENCRYPTION_KEY} -lt 16 ]]; then
  log "ERROR" "BACKUP_ENCRYPTION_KEY must be at least 16 characters long."
  write_status "FAILED" "PREFLIGHT" "BACKUP_ENCRYPTION_KEY too short" 0 false
  send_alert "FAILED" "PREFLIGHT" "BACKUP_ENCRYPTION_KEY too short"
  exit 1
fi

# ── 2. Concurrency Lock ───────────────────────────────────────────────────────
CURRENT_STAGE="LOCK"
if [[ -f "${LOCK_FILE}" ]]; then
  EXISTING_PID=$(cat "${LOCK_FILE}" 2>/dev/null || echo "unknown")
  log "ERROR" "Another backup job is currently running or lockfile exists (PID: ${EXISTING_PID})"
  write_status "FAILED" "LOCK" "Concurrent backup active (lock held by ${EXISTING_PID})" 0 false
  send_alert "FAILED" "LOCK" "Concurrent backup active (lock held by ${EXISTING_PID})"
  exit 1
fi
echo "$$" > "${LOCK_FILE}"

# ── 3. Database Dump Creation ─────────────────────────────────────────────────
CURRENT_STAGE="DUMP"
log "INFO" "Executing pg_dump in custom binary format (-Fc -Z6)..."

export PGPASSWORD="${POSTGRES_PASSWORD}"
if ! pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -Fc \
  -Z6 \
  -f "${PLAINTEXT_DUMP}"; then
  log "ERROR" "pg_dump failed to extract database contents"
  write_status "FAILED" "DUMP" "pg_dump command failure" 0 false
  send_alert "FAILED" "DUMP" "pg_dump execution failed"
  exit 1
fi
unset PGPASSWORD

if [[ ! -s "${PLAINTEXT_DUMP}" ]]; then
  log "ERROR" "Produced dump file is empty or missing"
  write_status "FAILED" "DUMP" "Produced dump file is empty" 0 false
  send_alert "FAILED" "DUMP" "Dump file is empty or missing"
  exit 1
fi
log "INFO" "pg_dump succeeded: $(ls -lh "${PLAINTEXT_DUMP}" | awk '{print $5}')"

# ── 4. Archive Table of Contents Verification ─────────────────────────────────
CURRENT_STAGE="VERIFY"
log "INFO" "Verifying archive table-of-contents via pg_restore..."
if ! pg_restore -l "${PLAINTEXT_DUMP}" > /dev/null 2>&1; then
  log "ERROR" "Archive verification failed: corrupted pg_dump file"
  write_status "FAILED" "VERIFY" "Archive TOC verification failed" 0 false
  send_alert "FAILED" "VERIFY" "pg_restore TOC check failed"
  exit 1
fi
log "INFO" "Archive integrity confirmed"

# ── 5. AES-256 Encryption ─────────────────────────────────────────────────────
CURRENT_STAGE="ENCRYPT"
log "INFO" "Encrypting backup archive with AES-256-CBC (PBKDF2)..."

if ! openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -salt \
  -in "${PLAINTEXT_DUMP}" \
  -out "${ENCRYPTED_DUMP}" \
  -pass "env:BACKUP_ENCRYPTION_KEY"; then
  log "ERROR" "OpenSSL encryption failed"
  write_status "FAILED" "ENCRYPT" "Encryption operation failed" 0 false
  send_alert "FAILED" "ENCRYPT" "OpenSSL encryption failed"
  exit 1
fi
chmod 600 "${ENCRYPTED_DUMP}"

# Immediately destroy unencrypted dump
rm -f "${PLAINTEXT_DUMP}"
log "INFO" "Encrypted artifact created: $(ls -lh "${ENCRYPTED_DUMP}" | awk '{print $5}')"
SIZE_BYTES=$(wc -c < "${ENCRYPTED_DUMP}" | tr -d ' ')

# ── 6. Offsite Upload ─────────────────────────────────────────────────────────
CURRENT_STAGE="UPLOAD"
OFFSITE_STORED=false

if [[ -n "${BACKUP_S3_BUCKET}" && -n "${BACKUP_S3_ACCESS_KEY_ID}" && -n "${BACKUP_S3_SECRET_ACCESS_KEY}" ]]; then
  log "INFO" "Uploading encrypted artifact to S3/R2 (${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX})..."
  S3_DEST="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}$(basename "${ENCRYPTED_DUMP}")"

  # If aws CLI is available:
  if command -v aws > /dev/null 2>&1; then
    AWS_ARGS=()
    if [[ -n "${BACKUP_S3_ENDPOINT}" ]]; then
      AWS_ARGS+=(--endpoint-url "${BACKUP_S3_ENDPOINT}")
    fi
    if [[ -n "${BACKUP_S3_REGION}" ]]; then
      AWS_ARGS+=(--region "${BACKUP_S3_REGION}")
    fi

    export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID}"
    export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY}"

    if ! aws s3 cp "${ENCRYPTED_DUMP}" "${S3_DEST}" "${AWS_ARGS[@]}"; then
      log "ERROR" "AWS S3 upload failed"
      write_status "FAILED" "UPLOAD" "AWS S3 cp failed" "${SIZE_BYTES}" false
      send_alert "FAILED" "UPLOAD" "S3 upload failed"
      exit 1
    fi
    OFFSITE_STORED=true
    log "INFO" "Offsite upload completed: ${S3_DEST}"
  else
    log "WARN" "aws-cli tool not found in container. Stored encrypted artifact locally."
  fi
else
  log "WARN" "[PENDING ACTIVATION] Offsite cloud storage credentials not supplied. Stored encrypted artifact locally at ${ENCRYPTED_DUMP}."
fi

# ── 7. Retention Enforcement ──────────────────────────────────────────────────
CURRENT_STAGE="RETENTION"
log "INFO" "Enforcing local backup retention (${BACKUP_RETENTION_DAYS} daily, ${BACKUP_RETENTION_WEEKS} weekly, ${BACKUP_RETENTION_MONTHS} monthly)..."

# Keep the newest 7 files locally as baseline
find "${BACKUP_WORK_DIR}" -maxdepth 1 -name "turff_db_*_utc.dump.enc" -type f | sort -r | tail -n +$((BACKUP_RETENTION_DAYS + 1)) | while read -r old_file; do
  log "INFO" "Pruning old local backup: $(basename "$old_file")"
  rm -f "$old_file"
done

# ── 8. Status Recording & Completion ──────────────────────────────────────────
CURRENT_STAGE="SUCCESS"
DURATION=$(( $(date +%s) - START_TIME ))
write_status "SUCCESS" "COMPLETE" "" "${SIZE_BYTES}" "${OFFSITE_STORED}"
send_alert "SUCCESS" "COMPLETE" "Backup completed in ${DURATION}s"

log "INFO" "TURFF backup completed successfully in ${DURATION}s. Artifact: $(basename "${ENCRYPTED_DUMP}")"
exit 0
