#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — Backup Sidecar Container Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# If custom command arguments are passed, execute them directly
if [[ $# -gt 0 ]]; then
  exec "$@"
fi

# One-shot mode: run single backup and exit with its status
if [[ "${BACKUP_RUN_ONCE:-false}" == "true" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Executing single on-demand backup..."
  exec /app/db-backup.sh
fi

echo "═══════════════════════════════════════════════════════════════════════════════"
echo " TURFF PostgreSQL Backup Sidecar Daemon"
echo " Target Schedule: ${BACKUP_SCHEDULE:-0 2 * * *} (Daily 02:00 UTC)"
echo " Offsite Storage: ${BACKUP_S3_BUCKET:-Local Ephemeral /backups/}"
echo " User: $(whoami) (UID: $(id -u))"
echo "═══════════════════════════════════════════════════════════════════════════════"

TARGET_HOUR="${BACKUP_TARGET_HOUR_UTC:-2}"
TARGET_MIN="${BACKUP_TARGET_MIN_UTC:-0}"
LAST_RUN_DAY=""

# Optional startup check
if [[ "${BACKUP_ON_STARTUP:-false}" == "true" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Running initial startup backup check..."
  /app/db-backup.sh || echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Initial startup backup encountered an issue"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Daemon loop active. Awaiting daily 02:00 UTC execution window..."

while true; do
  CURRENT_DAY=$(date -u +"%Y%m%d")
  CURRENT_HOUR=$(date -u +"%H")
  CURRENT_MIN=$(date -u +"%M")

  CURR_H=$((10#$CURRENT_HOUR))
  CURR_M=$((10#$CURRENT_MIN))

  if [[ "$CURRENT_DAY" != "$LAST_RUN_DAY" && $CURR_H -eq $((10#$TARGET_HOUR)) && $CURR_M -ge $((10#$TARGET_MIN)) ]]; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Daily execution window reached. Launching scheduled backup..."
    LAST_RUN_DAY="$CURRENT_DAY"
    /app/db-backup.sh || echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup execution failed"
  fi

  sleep 30
done
