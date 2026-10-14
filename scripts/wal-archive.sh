#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — PostgreSQL Write-Ahead Log (WAL) Archive Helper Script
#
# Finding: PRA-OPS-03 / Phase R7.3
# Purpose: Executed by PostgreSQL server process as 'archive_command'
# Usage:   wal-archive.sh <path-to-source-wal> <wal-filename>
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

WAL_SOURCE_PATH="${1:-}"
WAL_FILENAME="${2:-}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-/wal_archive}"

# ── 1. Input Validation ───────────────────────────────────────────────────────
if [[ -z "${WAL_SOURCE_PATH}" || -z "${WAL_FILENAME}" ]]; then
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-archive.sh: Missing required arguments. Usage: wal-archive.sh %p %f" >&2
  exit 1
fi

# Validate filename format: 24 hex characters or .backup / .history history files
if [[ ! "${WAL_FILENAME}" =~ ^[0-9A-Fa-f]{24}(\.[0-9A-Fa-f]{8}\.backup)?$ && ! "${WAL_FILENAME}" =~ ^[0-9A-Fa-f]{8}\.history$ ]]; then
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-archive.sh: Invalid WAL filename format: '${WAL_FILENAME}'" >&2
  exit 1
fi

if [[ ! -f "${WAL_SOURCE_PATH}" ]]; then
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [ERROR] wal-archive.sh: Source WAL file does not exist: '${WAL_SOURCE_PATH}'" >&2
  exit 1
fi

# Ensure archive directory exists
mkdir -p "${WAL_ARCHIVE_DIR}"

DEST_FILE="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}"
TMP_DEST_FILE="${WAL_ARCHIVE_DIR}/${WAL_FILENAME}.tmp.$$"

# ── 2. Idempotency Check ──────────────────────────────────────────────────────
# PostgreSQL requirement: If the destination file already exists with identical
# content, return exit code 0 to allow the server to continue.
if [[ -f "${DEST_FILE}" ]]; then
  SRC_SIZE=$(wc -c < "${WAL_SOURCE_PATH}" | tr -d ' ')
  DEST_SIZE=$(wc -c < "${DEST_FILE}" | tr -d ' ')

  if [[ "${SRC_SIZE}" -eq "${DEST_SIZE}" ]]; then
    # Verify checksums match
    SRC_HASH=$(sha256sum "${WAL_SOURCE_PATH}" | awk '{print $1}')
    DEST_HASH=$(sha256sum "${DEST_FILE}" | awk '{print $1}')

    if [[ "${SRC_HASH}" == "${DEST_HASH}" ]]; then
      # Identical file already archived successfully
      exit 0
    else
      echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [CRITICAL] wal-archive.sh: Hash mismatch for existing archive: '${DEST_FILE}'" >&2
      exit 1
    fi
  else
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [CRITICAL] wal-archive.sh: Size mismatch for existing archive: '${DEST_FILE}'" >&2
    exit 1
  fi
fi

# ── 3. Atomic Delivery ────────────────────────────────────────────────────────
# Copy to temporary file first, then atomically rename so readers never observe
# partial or in-flight writes.
trap 'rm -f "${TMP_DEST_FILE}"' EXIT INT TERM

cp "${WAL_SOURCE_PATH}" "${TMP_DEST_FILE}"
chmod 600 "${TMP_DEST_FILE}"

# Sync to ensure written to disk
if command -v sync > /dev/null 2>&1; then
  sync "${TMP_DEST_FILE}" 2>/dev/null || true
fi

mv -f "${TMP_DEST_FILE}" "${DEST_FILE}"
trap - EXIT INT TERM

exit 0
