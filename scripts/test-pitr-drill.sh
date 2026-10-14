#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# TURFF — Isolated Point-in-Time Recovery (PITR) Drill Verification Script
#
# Purpose: Executes a complete, end-to-end PITR drill in an isolated environment.
# Verifies:
#   1. Continuous WAL archiving via archive_command (wal-archive.sh)
#   2. Base backup creation
#   3. WAL replay up to target timestamp
#   4. Rejection/omission of transactions committed AFTER the target timestamp
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

DRILL_BASE_DIR="/tmp/turff_pitr_drill_$$"
PRIMARY_DATA="${DRILL_BASE_DIR}/primary_data"
BASEBACKUP_DIR="${DRILL_BASE_DIR}/base_backup"
RECOVERY_DATA="${DRILL_BASE_DIR}/recovery_data"
WAL_ARCHIVE="${DRILL_BASE_DIR}/wal_archive"
DRILL_LOG="${DRILL_BASE_DIR}/drill.log"

export WAL_ARCHIVE_DIR="${WAL_ARCHIVE}"
export PGPORT=5433

log() {
  local level="$1"
  shift
  echo "[$(date -u +"%Y-%m-%d %H:%M:%S UTC")] [${level}] $*"
}

cleanup() {
  log "INFO" "Cleaning up isolated drill workspace: ${DRILL_BASE_DIR}"
  if [[ -f "${PRIMARY_DATA}/postmaster.pid" ]]; then
    pg_ctl -D "${PRIMARY_DATA}" -m immediate stop 2>/dev/null || true
  fi
  if [[ -f "${RECOVERY_DATA}/postmaster.pid" ]]; then
    pg_ctl -D "${RECOVERY_DATA}" -m immediate stop 2>/dev/null || true
  fi
  rm -rf "${DRILL_BASE_DIR}"
}
trap cleanup EXIT INT TERM

mkdir -p "${DRILL_BASE_DIR}" "${WAL_ARCHIVE}" "${BASEBACKUP_DIR}"

log "INFO" "Starting TURFF Isolated PITR Disaster Recovery Drill..."
DRILL_START_TIME=$(date +%s)

# ── 1. Initialize Isolated Primary Cluster ─────────────────────────────────────
log "INFO" "Step 1: Initializing primary cluster at ${PRIMARY_DATA}..."
initdb -D "${PRIMARY_DATA}" -U postgres -A trust --no-locale > /dev/null

cat << 'EOF' >> "${PRIMARY_DATA}/postgresql.conf"
wal_level = replica
archive_mode = on
archive_command = '/app/wal-archive.sh %p %f'
archive_timeout = 60
max_wal_senders = 5
port = 5433
EOF

log "INFO" "Starting isolated primary database (port 5433)..."
pg_ctl -D "${PRIMARY_DATA}" -l "${DRILL_LOG}" start
sleep 2

# ── 2. Create Base State at T0 ────────────────────────────────────────────────
log "INFO" "Step 2: Creating schema and T0 baseline records..."
psql -h localhost -p 5433 -U postgres -d postgres << 'EOF'
CREATE TABLE pitr_financial_ledger (
  id SERIAL PRIMARY KEY,
  event VARCHAR(50) NOT NULL,
  amount_inr INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

INSERT INTO pitr_financial_ledger (event, amount_inr, created_at)
VALUES ('T0_OPENING_BALANCE', 100000, CURRENT_TIMESTAMP);
EOF

# ── 3. Take Base Backup ───────────────────────────────────────────────────────
log "INFO" "Step 3: Taking physical base backup via pg_basebackup..."
pg_basebackup -h localhost -p 5433 -U postgres -D "${BASEBACKUP_DIR}" -Ft -z -X fetch
log "INFO" "Base backup completed. Archived base.tar.gz size: $(ls -lh "${BASEBACKUP_DIR}/base.tar.gz" | awk '{print $5}')"

# ── 4. Legitimate Activity at T1 (Target State) ───────────────────────────────
log "INFO" "Step 4: Executing legitimate transactions at T1..."
sleep 1

# Insert legitimate transaction
psql -h localhost -p 5433 -U postgres -d postgres << 'EOF'
INSERT INTO pitr_financial_ledger (event, amount_inr, created_at)
VALUES ('T1_CONFIRMED_SLOT_BOOKING', 1200, CURRENT_TIMESTAMP);
EOF

sleep 1

# Capture target recovery timestamp post-commit (strictly after T1 commit, before T2 disaster)
TARGET_TS=$(psql -h localhost -p 5433 -U postgres -d postgres -tA -c \
  "SELECT clock_timestamp()::text;" | tr -d '\r\n')

log "INFO" "Recorded Legitimate Transaction T1. Setting PITR target timestamp: '${TARGET_TS}'"

# Switch WAL so T1 segment is immediately shipped to archive
log "INFO" "Switching WAL segment to trigger archiving..."
psql -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_switch_wal();" > /dev/null
sleep 2

# Verify WAL file arrived in archive
ARCHIVED_WALS=$(ls -1 "${WAL_ARCHIVE}" | grep -c -E '^[0-9A-Fa-f]{24}' || true)
log "INFO" "Archived WAL segments in ${WAL_ARCHIVE}: ${ARCHIVED_WALS} segments"
if [[ "${ARCHIVED_WALS}" -lt 1 ]]; then
  log "ERROR" "No WAL segments found in archive! Archiving failed."
  exit 1
fi

# ── 5. Simulate Disastrous Transaction at T2 (Corrupting Event) ───────────────
log "INFO" "Step 5: Simulating corrupting disaster transaction at T2..."
sleep 2

psql -h localhost -p 5433 -U postgres -d postgres << 'EOF'
INSERT INTO pitr_financial_ledger (event, amount_inr, created_at)
VALUES ('T2_MALICIOUS_OR_CORRUPT_TRANSACTION', 9999999, CURRENT_TIMESTAMP);
EOF

# Force second WAL switch
psql -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_switch_wal();" > /dev/null
sleep 2

log "INFO" "Stopping primary database..."
pg_ctl -D "${PRIMARY_DATA}" stop
sleep 1

# ── 6. Execute Point-in-Time Recovery to T1 ───────────────────────────────────
log "INFO" "Step 6: Executing Point-in-Time Recovery to Target: '${TARGET_TS}'..."
RECOVERY_START_TIME=$(date +%s)
mkdir -p "${RECOVERY_DATA}"

# Extract base backup
tar -xzf "${BASEBACKUP_DIR}/base.tar.gz" -C "${RECOVERY_DATA}"
chmod 700 "${RECOVERY_DATA}"

# Place recovery signal file
touch "${RECOVERY_DATA}/recovery.signal"

# Configure restore_command and recovery target
cat << EOF >> "${RECOVERY_DATA}/postgresql.conf"
restore_command = 'env WAL_ARCHIVE_DIR="${WAL_ARCHIVE}" /app/wal-restore.sh %f %p'
recovery_target_time = '${TARGET_TS}'
recovery_target_action = 'promote'
port = 5433
EOF

log "INFO" "Starting PostgreSQL in PITR archive recovery mode..."
RECOVERY_LOG="${DRILL_BASE_DIR}/recovery.log"
if ! pg_ctl -D "${RECOVERY_DATA}" -l "${RECOVERY_LOG}" start; then
  log "ERROR" "pg_ctl failed to start recovery cluster. Contents of recovery.log:"
  cat "${RECOVERY_LOG}" || true
  exit 1
fi

# Wait for recovery to complete and promote
PROMOTED=false
for i in {1..30}; do
  STATUS=$(psql -h localhost -p 5433 -U postgres -d postgres -tA -c "SELECT pg_is_in_recovery();" 2>/dev/null || true)
  if [[ "${STATUS}" == "f" ]]; then
    log "INFO" "PostgreSQL promoted from recovery to read-write mode!"
    PROMOTED=true
    break
  fi
  sleep 1
done

if [[ "${PROMOTED}" != "true" ]]; then
  log "ERROR" "Database failed to promote within 30 seconds! Recovery log:"
  cat "${RECOVERY_LOG}" || true
  exit 1
fi

RECOVERY_DURATION=$(( $(date +%s) - RECOVERY_START_TIME ))
log "INFO" "Recovery and promotion completed in ${RECOVERY_DURATION}s."

# ── 7. Verify Integrity of Point-In-Time State ────────────────────────────────
log "INFO" "Step 7: Validating restored table records..."

RECORDS=$(psql -h localhost -p 5433 -U postgres -d postgres -tA -c \
  "SELECT event || ':' || amount_inr FROM pitr_financial_ledger ORDER BY id;")

echo "Restored Records in pitr_financial_ledger:"
echo "${RECORDS}"

# Invariant Checks:
# 1. T0_OPENING_BALANCE must be present
if echo "${RECORDS}" | grep -q "T0_OPENING_BALANCE"; then
  log "INFO" "PASS: T0_OPENING_BALANCE present."
else
  log "ERROR" "FAIL: T0_OPENING_BALANCE missing!"
  exit 1
fi

# 2. T1_CONFIRMED_SLOT_BOOKING must be present
if echo "${RECORDS}" | grep -q "T1_CONFIRMED_SLOT_BOOKING"; then
  log "INFO" "PASS: T1_CONFIRMED_SLOT_BOOKING present."
else
  log "ERROR" "FAIL: T1_CONFIRMED_SLOT_BOOKING missing!"
  exit 1
fi

# 3. T2_MALICIOUS_OR_CORRUPT_TRANSACTION must be ABSENT (rolled back!)
if echo "${RECORDS}" | grep -q "T2_MALICIOUS_OR_CORRUPT_TRANSACTION"; then
  log "ERROR" "CRITICAL FAILURE: T2_MALICIOUS_OR_CORRUPT_TRANSACTION is present! PITR did not stop at target timestamp!"
  exit 1
else
  log "INFO" "PASS: T2_MALICIOUS_OR_CORRUPT_TRANSACTION is ABSENT. Disaster successfully rolled back!"
fi

TOTAL_DRILL_TIME=$(( $(date +%s) - DRILL_START_TIME ))
log "INFO" "═══════════════════════════════════════════════════════════════════════════════"
log "INFO" "PITR DISASTER RECOVERY DRILL VERIFIED SUCCESSFULLY!"
log "INFO" "Target Timestamp Reached: ${TARGET_TS}"
log "INFO" "Recovery Duration: ${RECOVERY_DURATION}s | Total Drill Time: ${TOTAL_DRILL_TIME}s"
log "INFO" "═══════════════════════════════════════════════════════════════════════════════"
exit 0
