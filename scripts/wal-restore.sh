#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — PostgreSQL Write-Ahead Log (WAL) Restore Helper Script
#
# Finding: PRA-OPS-03 / Phase R7.3
# Purpose: Executed by PostgreSQL server during PITR as 'restore_command'
# Usage:   wal-restore.sh <wal-filename> <destination-path>
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

WAL_FILENAME="${1:-}"
WAL_DEST_PATH="${2:-}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/wal_archive}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"

# ── 1. Input Validation ───────────────────────────────────────────────────────
if [[ -z "${WAL_FILENAME}" || -z "${WAL_DEST_PATH}" ]]; then
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-restore.sh: Missing required arguments. Usage: wal-restore.sh %f %p" >&2
  exit 1
fi

PLAIN_SOURCE="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}"
ENC_SOURCE="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}.enc"

# ── 2. Locate and Restore Segment ─────────────────────────────────────────────
# Case A: Plaintext uncompressed archive segment exists
if [[ -f "${PLAIN_SOURCE}" ]]; then
  cp "${PLAIN_SOURCE}" "${WAL_DEST_PATH}"
  chmod 600 "${WAL_DEST_PATH}"
  exit 0
fi

# Case B: Encrypted archive segment exists
if [[ -f "${ENC_SOURCE}" ]]; then
  if [[ -z "${BACKUP_ENCRYPTION_KEY}" ]]; then
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-restore.sh: BACKUP_ENCRYPTION_KEY required to decrypt ${ENC_SOURCE}" >&2
    exit 1
  fi

  if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 -salt \
    -in "${ENC_SOURCE}" \
    -out "${WAL_DEST_PATH}" \
    -pass "env:BACKUP_ENCRYPTION_KEY"; then
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-restore.sh: Failed to decrypt WAL segment: ${ENC_SOURCE}" >&2
    exit 1
  fi

  chmod 600 "${WAL_DEST_PATH}"
  exit 0
fi

# Case C: Segment not found in archive.
# PostgreSQL expects exit code 1 when a requested WAL segment does not exist
# (e.g., reaching the end of the archived WAL stream).
exit 1
