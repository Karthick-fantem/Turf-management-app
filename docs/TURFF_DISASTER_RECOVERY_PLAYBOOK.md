# TURFF — Production Disaster Recovery & Restoration Playbook

**Document Version:** 1.0.0  
**Effective Date:** October 15, 2026  
**Target:** `PRA-OPS-03` / Blocker 8  
**Owner:** Operations & Security Engineering  
**Classification:** Confidential — Internal Operations Runbook  

---

## 1. Overview & Recovery Objectives

This playbook establishes the standard operating procedure for recovering the TURFF production PostgreSQL database in the event of hardware failure, catastrophic volume deletion, data corruption, or ransomware incidents.

### Recovery Objectives
- **RPO (Recovery Point Objective):**
  - **With WAL Archiving Active:** $\le 5$ minutes (governed by `archive_timeout = 300s` or immediate WAL segment closure on 16MB boundary).
  - **Logical Backup Fallback (WAL Archiving Inactive/Disabled):** $\le 24$ hours (governed by daily automated backup schedule at 02:00 UTC).
- **RTO (Recovery Time Objective):** $\le 30$ minutes from declaration of disaster to application traffic resumption (observed isolated drill replay duration: 6 seconds).

---

## 2. Architecture & Backup Artifact Inventory

### 2.1 Backup Storage Locations
1. **Primary Offsite Storage (Production):**
   - Bucket: AWS S3 or Cloudflare R2 (`turff-db-backups-prod`)
   - Path Prefix:
     - Logical Backups: `db/turff_db_YYYYMMDD_HHMMSS_utc.dump.enc`
     - Physical Base Backups: `base/turff_base_YYYYMMDD_HHMMSS_utc.tar.gz.enc`
     - WAL Segments: `wal/<timeline-lsn-24-hex>.enc`
2. **Local Staging Volumes (Docker):**
   - Logical Backups: `turff_backup_data` mounted at `/backups` inside `db-backup`.
   - WAL Archive: `turff_wal_archive` mounted at `/wal_archive` across `db` and `db-backup`.
   - Status tracking: `/backups/latest-status.json` and `/wal_archive/archive-status.json`.

### 2.2 Encryption Standard
- **Cipher:** OpenSSL-compatible AES-256-CBC with PBKDF2 (SHA-256, 10,000 iterations, 8-byte salt).
- **Format:**
  - Logical: Custom PostgreSQL compressed binary archive (`-Fc -Z6`) wrapped in OpenSSL `Salted__` envelope.
  - Physical / WAL: Gzip-compressed tarball (`.tar.gz`) or raw 16MB WAL segment wrapped in OpenSSL `Salted__` envelope.

---

## 3. Pre-Restoration Safety Rules (MANDATORY GATES)

Before initiating any restoration activity, operators **MUST** observe the following safeguards:

> [!CAUTION]
> **RULE 1: NEVER DIRECTLY OVERWRITE LIVE PRODUCTION DATABASE**
> Always restore into a clean, isolated staging/test database first (`turff_restore_drill` or `turff_recovered`) to verify integrity before switching connection endpoints.

> [!CAUTION]
> **RULE 2: NEVER EXECUTE `prisma migrate reset`**
> Restorations must use `pg_restore --clean --if-exists`. Never execute destructive Prisma CLI commands during disaster recovery.

> [!IMPORTANT]
> **RULE 3: CONFIRM ARCHIVE INTEGRITY BEFORE TOUCHING DATABASE**
> Always inspect the decrypted archive with `pg_restore -l` to verify the Table of Contents (TOC) header. If the archive is truncated or invalid, stop immediately.

---

## 4. Step-by-Step Restoration Procedure

### Scenario A: Isolated Recovery Drill or Integrity Audit
*Used for scheduled disaster drills without altering live production systems.*

#### Step 1: Obtain the Encrypted Backup Artifact
From S3/R2 or local staging:
```bash
# Example from S3
aws s3 cp s3://turff-db-backups-prod/db/turff_db_20261014_214147_utc.dump.enc ./backups/
```

#### Step 2: Set Environment Variables
```bash
export BACKUP_ENCRYPTION_KEY="<production-encryption-key>"
export POSTGRES_HOST="db"
export POSTGRES_PORT="5432"
export POSTGRES_USER="postgres"
export POSTGRES_PASSWORD="<db-password>"
```

#### Step 3: Execute Safe Restore Script
```bash
# Target database MUST NOT be production (turff_db)
./scripts/db-restore.sh ./backups/turff_db_20261014_214147_utc.dump.enc turff_test_restore --confirm
```

---

### Scenario B: Complete Bare-Metal Host Rebuild (Production Disaster)
*Used when the primary production host or Docker volume is destroyed.*

#### Step 1: Provision Clean Host and Clone Repository
```bash
git clone <turff-repo-url> /opt/turff
cd /opt/turff
```

#### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` and fill in:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=turff_db`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`

#### Step 3: Launch Clean Database Container
```bash
docker compose -f docker-compose.prod.yml up -d db
```
Wait until PostgreSQL healthcheck reports healthy:
```bash
docker compose -f docker-compose.prod.yml exec db pg_isready -U postgres
```

#### Step 4: Download Latest Known-Good Encrypted Backup
```bash
aws s3 cp s3://${BACKUP_S3_BUCKET}/db/$(aws s3 ls s3://${BACKUP_S3_BUCKET}/db/ | sort | tail -n 1 | awk '{print $4}') /tmp/latest_backup.dump.enc
```

#### Step 5: Decrypt and Restore
```bash
# Decrypt
openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 \
  -in /tmp/latest_backup.dump.enc \
  -out /tmp/latest_backup.dump \
  -pass "env:BACKUP_ENCRYPTION_KEY"

# Verify archive
pg_restore -l /tmp/latest_backup.dump > /dev/null

# Restore into target production database
docker compose -f docker-compose.prod.yml exec -T db pg_restore \
  -U postgres \
  -d turff_db \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges < /tmp/latest_backup.dump

# Immediately delete plaintext dump
rm -f /tmp/latest_backup.dump
```

#### Step 6: Verify Database Integrity & Start Application
```bash
# Verify Prisma migration status
cd apps/backend && npx prisma migrate status

# Start all remaining services
docker compose -f docker-compose.prod.yml up -d backend web db-backup
```

---

### Scenario C: Point-In-Time Recovery (PITR) to a Specific Microsecond Target
*Used when a specific catastrophic event (malicious SQL injection, accidental table truncation, bad schema migration, or logical corruption) occurred at a known timestamp $T_{disaster}$, and database state must be restored to $T_{target} < T_{disaster}$ with zero loss of prior legitimate transactions.*

#### Step 1: Select a Valid Base Backup
To recover to target timestamp $T_{target}$, identify a physical base backup (`base.tar.gz` or `.dump.enc`) created *strictly before* $T_{target}$:
1. List available base backups from S3/R2 or local staging:
   ```bash
   aws s3 ls s3://${BACKUP_S3_BUCKET}/base/
   ```
2. Verify the base backup's `backup_label` timestamp is older than $T_{target}$. Base backups taken after $T_{target}$ cannot be replayed backward in time.

#### Step 2: Establish the Exact Target Recovery Timestamp
Determine $T_{target}$ from:
- Application error/audit logs (e.g. HTTP access log timestamp of malicious request).
- NestJS audit logs or database query logs.
- Format required: ISO 8601 UTC timestamp, e.g. `'2026-10-14 21:57:30.691321+00'`.
- **Precaution**: Target timestamp should be set to immediately prior to the corrupting transaction's commit time.

#### Step 3: Provision an Isolated Recovery Container
Never perform PITR in-place on the running production cluster. Launch an isolated recovery environment:
```bash
# Create isolated directory
mkdir -p /tmp/turff_pitr_recovery/{data,wal_archive}
cd /tmp/turff_pitr_recovery

# Fetch base backup and WAL segments
aws s3 cp s3://${BACKUP_S3_BUCKET}/base/<chosen_base_backup>.tar.gz.enc ./base.tar.gz.enc
aws s3 sync s3://${BACKUP_S3_BUCKET}/wal/ ./wal_archive/

# Decrypt base backup
openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 \
  -in ./base.tar.gz.enc -out ./base.tar.gz \
  -pass "env:BACKUP_ENCRYPTION_KEY"

# Extract base backup into isolated data directory
tar -xzf ./base.tar.gz -C ./data
chmod 700 ./data
rm -f ./base.tar.gz
```

#### Step 4: Configure PostgreSQL PITR Parameters
In PostgreSQL 15, recovery configuration is specified directly in `postgresql.conf` alongside a trigger signal file:
```bash
# 1. Create recovery signal file (tells PostgreSQL to enter archive recovery)
touch ./data/recovery.signal

# 2. Append recovery directives to postgresql.conf
cat << EOF >> ./data/postgresql.conf
# ── PITR Configuration ──
restore_command = 'env WAL_ARCHIVE_DIR=/tmp/turff_pitr_recovery/wal_archive /app/wal-restore.sh %f %p'
recovery_target_time = '${TARGET_TS}'
recovery_target_action = 'promote'
recovery_target_inclusive = true
EOF
```

#### Step 5: Start Recovery Cluster and Monitor Replay
Start PostgreSQL on an alternate port (e.g. 5433) using Docker or `pg_ctl`:
```bash
# Run isolated recovery container
docker run -d --name turff-pitr-recovery \
  -v /tmp/turff_pitr_recovery/data:/var/lib/postgresql/data \
  -v /tmp/turff_pitr_recovery/wal_archive:/wal_archive \
  -v /opt/turff/scripts/wal-restore.sh:/app/wal-restore.sh:ro \
  -e BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}" \
  -p 5433:5432 \
  postgres:15-alpine

# Monitor WAL replay progress in container logs
docker logs -f turff-pitr-recovery
```
PostgreSQL log will display:
- `starting point-in-time recovery to YYYY-MM-DD HH:MI:SS.US+00`
- Sequential invocation of `restore_command` fetching WAL segments
- `recovery stopping at restore point or target time`
- `archive recovery complete`
- `database system was not properly shut down; automatic recovery in progress`
- `database system is ready to accept connections`

#### Step 6: Verify Promotion and Restored State
Check that PostgreSQL has completed recovery and promoted to read-write mode:
```bash
# Verify promotion
docker exec turff-pitr-recovery psql -U postgres -c "SELECT pg_is_in_recovery();"
# Expected output: 'f' (false - promoted and accepting writes)

# Run verification checklist against port 5433
PGPORT=5433 ./scripts/verify-database-integrity.sh
```

#### Step 7: Record Metrics and Cut Over
- Record measured recovery duration (start of `tar` extraction to completion of promotion).
- Record exact observed recovery LSN and timestamp:
  ```sql
  SELECT pg_last_wal_replay_lsn(), CURRENT_TIMESTAMP;
  ```
- If promoting recovered database to production:
  1. Stop application traffic (`docker compose stop backend web`).
  2. Swap Docker named volumes or update `POSTGRES_HOST`/port.
  3. Start application and verify readiness probe (`/health/ready`).

#### Step 8: Operational Limitations and Edge Cases
1. **No Trustworthy Time Reference:** If clock skew occurred or the exact timestamp of corruption is unknown, perform recovery to a named restore point (`recovery_target_name`) or transaction ID (`recovery_target_xid`), or step recovery interactively using `recovery_target_action = 'pause'`.
2. **Missing WAL Segments:** If a gap exists in the WAL archive between the base backup and target timestamp, recovery will fail at the missing segment. Maintain at least 2 independent copies of the WAL archive.
3. **Timeline Divergence:** When a database is promoted after PITR, a new timeline (e.g. Timeline 2) is created. Archived WALs will have new timeline prefixes (`00000002...`). Ensure future recoveries account for the correct timeline history file (`.history`).

---

## 5. Post-Restoration Verification Checklist

Following restoration, verify:

| Verification Item | Query / Command | Expected Pass Criteria |
|---|---|---|
| **Base Tables** | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';` | Exactly 53 tables |
| **Applied Migrations** | `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;` | 17 migrations |
| **Prisma CLI Sync** | `npx prisma migrate status` | `Database schema is up to date!` |
| **User Identities** | `SELECT count(*) FROM "User";` | Non-zero; matches pre-incident baseline |
| **Venues & Slots** | `SELECT count(*) FROM "Slot";` | Non-zero; bookable slots present |
| **Wallets & Ledgers** | `SELECT count(*) FROM "Wallet";` | Matches pre-incident balance ledgers |
| **Health Probes** | `curl -f http://localhost:3000/health/ready` | HTTP 200 `{"status": "ok", "services": {"database": "ok", "redis": "ok"}}` |

---

## 6. Escalation & Communication Matrix

| Role | Contact Trigger | Responsibility |
|---|---|---|
| **Incident Commander** | Failure of primary database host | Coordinates failover and stakeholder notification |
| **Lead Database Operator** | Initiation of restoration runbook | Executes decryption, restoration, and verification queries |
| **Security Officer** | Key decryption approval | Authorizes usage of production backup encryption key |
| **Platform Communications** | Downtime exceeding 15 minutes | Issues maintenance status updates to turf owners and players |
