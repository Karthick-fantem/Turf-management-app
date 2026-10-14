#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — WAL Offsite Encryption & Safe Retention Sync Tool
#
# Finding: PRA-OPS-03 / Phase R7.3
# Purpose: Encrypts local WAL files, syncs to S3/R2, and prunes expired WAL
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/wal_archive}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
OLDEST_REQUIRED_WAL="${1:-}"

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-ap-south-1}"
BACKUP_S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
BACKUP_S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-db/}"

log() {
  local level="$1"
  shift
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [${level}] $*"
}

if [[ ! -d "${WAL_ARCHIVE_DIR}" ]]; then
  log "WARN" "WAL archive directory does not exist: ${WAL_ARCHIVE_DIR}"
  exit 0
fi

# ── 1. Encrypt unencrypted WAL segments ───────────────────────────────────────
if [[ -n "${BACKUP_ENCRYPTION_KEY}" ]]; then
  for wal_file in "${WAL_ARCHIVE_DIR}"/*; do
    [[ -f "${wal_file}" ]] || continue
    base_name=$(basename "${wal_file}")

    # Skip files already encrypted or temporary files
    if [[ "${base_name}" == *.enc || "${base_name}" == *.tmp* ]]; then
      continue
    fi

    # Only process valid WAL names
    if [[ "${base_name}" =~ ^[0-9A-Fa-f]{24}(\.[0-9A-Fa-f]{8}\.backup)?$ || "${base_name}" =~ ^[0-9A-Fa-f]{8}\.history$ ]]; then
      enc_dest="${WAL_ARCHIVE_DIR}/${base_name}.enc"
      if [[ ! -f "${enc_dest}" ]]; then
        log "INFO" "Encrypting WAL segment: ${base_name}..."
        openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -salt \
          -in "${wal_file}" \
          -out "${enc_dest}.tmp.$$" \
          -pass "env:BACKUP_ENCRYPTION_KEY"
        chmod 600 "${enc_dest}.tmp.$$"
        mv -f "${enc_dest}.tmp.$$" "${enc_dest}"
      fi
    fi
  done
fi

# ── 2. Sync to Offsite Storage (if configured) ────────────────────────────────
if [[ -n "${BACKUP_S3_BUCKET}" && -n "${BACKUP_S3_ACCESS_KEY_ID}" && -n "${BACKUP_S3_SECRET_ACCESS_KEY}" ]]; then
  if command -v aws > /dev/null 2>&1; then
    AWS_ARGS=()
    [[ -n "${BACKUP_S3_ENDPOINT}" ]] && AWS_ARGS+=(--endpoint-url "${BACKUP_S3_ENDPOINT}")
    [[ -n "${BACKUP_S3_REGION}" ]] && AWS_ARGS+=(--region "${BACKUP_S3_REGION}")

    export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID}"
    export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY}"

    S3_WAL_DEST="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}wal/"
    log "INFO" "Syncing encrypted WAL segments to ${S3_WAL_DEST}..."
    aws s3 sync "${WAL_ARCHIVE_DIR}/" "${S3_WAL_DEST}" \
      --exclude "*" \
      --include "*.enc" \
      "${AWS_ARGS[@]}" || log "WARN" "Offsite WAL sync warning"
  fi
fi

# ── 3. Retention Enforcement ──────────────────────────────────────────────────
# Golden rule: NEVER delete WAL files newer than or equal to the oldest required WAL.
if [[ -n "${OLDEST_REQUIRED_WAL}" ]]; then
  log "INFO" "Enforcing WAL retention. Oldest required WAL: ${OLDEST_REQUIRED_WAL}"

  for wal_file in "${WAL_ARCHIVE_DIR}"/*; do
    [[ -f "${wal_file}" ]] || continue
    base_name=$(basename "${wal_file}" .enc)

    if [[ "${base_name}" =~ ^[0-9A-Fa-f]{24}$ ]]; then
      # Lexicographical comparison works because WAL filenames are timeline + segment numbers in hex
      if [[ "${base_name}" < "${OLDEST_REQUIRED_WAL}" ]]; then
        log "INFO" "Pruning obsolete WAL segment: $(basename "${wal_file}")"
        rm -f "${wal_file}"
      fi
    fi
  done
else
  log "INFO" "No base backup boundary provided; retaining all WAL segments safely."
fi

exit 0
