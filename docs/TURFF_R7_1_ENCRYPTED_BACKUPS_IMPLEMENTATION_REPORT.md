# TURFF â€” R7.1 Automated Encrypted PostgreSQL Backups & Offsite Sync Implementation Report

**Status:** COMPLETE (R7.1 Scope Delivered â€” Ready for Production Operator Activation)
**Target Finding:** `PRA-OPS-03` (P1 Blocker / Production Readiness Checklist Blocker 8)
**Finding Status:** **OPEN / PARTIALLY MITIGATED** (Full closure requires R7.2 Restore Verification Drill)
**Phase:** R7.1
**Date:** October 15, 2026
**Auditor & Implementation Agent:** Antigravity Autonomous Security & Operations Agent

---

## 1. Executive Summary

Phase R7.1 implements a hardened, automated, and encrypted PostgreSQL backup pipeline for TURFF production, mitigating finding **`PRA-OPS-03`** (Checklist Blocker 8).

Prior to this implementation, the PostgreSQL database was unbacked, storing data exclusively on a local Docker named volume (`turff_db_data`), creating a catastrophic single point of failure.

R7.1 establishes:
1. **Containerized Backup Sidecar (`db-backup`)**: Added to [`docker-compose.prod.yml`](file:///c:/projects/turff/docker-compose.prod.yml) running as an unprivileged, non-root user (`postgres`, UID 70) on the isolated `turff_internal` bridge network with zero published host ports.
2. **PostgreSQL Custom Binary Dumps (`pg_dump -Fc -Z6`)**: Dumps all 53 tables, constraints, sequences, and indexes with level 6 compression, followed by immediate pre-encryption Table-of-Contents validation via `pg_restore -l`.
3. **OpenSSL-Compatible AES-256-CBC PBKDF2 Encryption**: Backups are encrypted before leaving the local host; plaintext dumps are destroyed immediately via cleanup traps.
4. **AWS S3 / Cloudflare R2 Offsite Synchronization**: Integrated native AWS Signature Version 4 upload client without heavy external SDK dependencies, with configurable endpoint support for Cloudflare R2 zero-egress storage.
5. **Grandfather-Father-Son (GFS) Retention Engine**: Automatically enforces 7 daily, 4 weekly, and 3 monthly recovery points within strict prefix boundaries (`db/`).
6. **Failure & Status Tracking**: Real-time status reporting via `/backups/latest-status.json` and Telegram operations webhook alerts on failure.
7. **Comprehensive Automated Verification**: 13 automated unit tests in `apps/backend/src/backup/backup.spec.ts` covering all 12 mandate criteria. All 834 backend unit tests and all 720 E2E tests pass cleanly (1,554 total tests passing).

In accordance with strict safety mandates, **`PRA-OPS-03` remains OPEN** in the release checklist pending operator bucket credential supply and the Phase R7.2 recovery drill.

---

## 2. Preflight Inspection Summary

Before code modifications were made, preflight inspection evaluated the repository and container baseline:

1. **Intended Backup Architecture**:
   - Dedicated sidecar container running `postgres:15-alpine` matching the production database engine version.
   - Operates on the internal bridge network (`turff_internal`) with internal DNS resolution to `db:5432`.
   - Concurrency lockfile (`backup.lock`) preventing overlapping executions.
2. **Selected Object-Storage Provider**:
   - **AWS S3 / Cloudflare R2**: Fits existing TURFF media upload conventions (`apps/backend/src/media/media.service.ts`). Cloudflare R2 provides zero-egress fees, making daily offsite sync highly economical.
3. **Environment Variables & Secrets**:
   - Runtime injection via environment variables. Zero credentials committed to Git.
   - Plaintext passwords and encryption keys redacted from all log outputs, status files, and error messages.
4. **Encryption & Key Recovery Design**:
   - AES-256-CBC with PBKDF2 key derivation (10,000 iterations, SHA-256) and 8-byte random salt.
   - Produces standard OpenSSL `Salted__` headers, decryptable by any standard OpenSSL utility without proprietary software.
5. **Scheduling, Locking, Retention & Alerting**:
   - Default schedule: 02:00 UTC daily.
   - PID lockfile prevents double execution.
   - GFS retention policy (7 daily, 4 weekly, 3 monthly).
   - Telegram alerts on any stage failure.
6. **Safe Verification**:
   - Zero production data, schemas, or container volumes were dropped or truncated.
   - Local test dump executed cleanly on `turff-db-1` producing a 2.8 MB verified archive.

---

## 3. Exact Files Created and Modified

| Action | File Path | Purpose |
|---|---|---|
| **Created** | [`apps/backend/src/backup/backup.constants.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup.constants.ts) | Types, stage enums, defaults, and configuration models |
| **Created** | [`apps/backend/src/backup/backup-crypto.service.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup-crypto.service.ts) | OpenSSL-interoperable AES-256-CBC PBKDF2 encryption service |
| **Created** | [`apps/backend/src/backup/backup-retention.service.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup-retention.service.ts) | Grandfather-Father-Son retention evaluation and boundary safety |
| **Created** | [`apps/backend/src/backup/backup-s3.service.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup-s3.service.ts) | AWS SigV4 S3/R2 client (PUT, LIST, DELETE) without external SDK |
| **Created** | [`apps/backend/src/backup/backup-alert.service.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup-alert.service.ts) | Markdown Telegram alert dispatcher with credential redaction |
| **Created** | [`apps/backend/src/backup/backup-orchestrator.service.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup-orchestrator.service.ts) | Core end-to-end backup pipeline and lifecycle coordinator |
| **Created** | [`apps/backend/src/backup/backup.module.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup.module.ts) | NestJS module registering backup services |
| **Created** | [`apps/backend/src/backup/backup.spec.ts`](file:///c:/projects/turff/apps/backend/src/backup/backup.spec.ts) | Comprehensive unit test suite (13 test cases, all passing) |
| **Created** | [`scripts/db-backup.sh`](file:///c:/projects/turff/scripts/db-backup.sh) | Production POSIX/Bash backup runner script for Linux and Docker |
| **Created** | [`docker/backup/Dockerfile`](file:///c:/projects/turff/docker/backup/Dockerfile) | Security-hardened Alpine container definition for sidecar |
| **Created** | [`docker/backup/entrypoint.sh`](file:///c:/projects/turff/docker/backup/entrypoint.sh) | Unprivileged daemon entrypoint with UTC scheduling loop |
| **Modified** | [`apps/backend/src/app.module.ts`](file:///c:/projects/turff/apps/backend/src/app.module.ts) | Registered `BackupModule` into NestJS root application module |
| **Modified** | [`docker-compose.prod.yml`](file:///c:/projects/turff/docker-compose.prod.yml) | Added `db-backup` service and `turff_backup_data` volume |
| **Modified** | [`apps/backend/.env.example`](file:///c:/projects/turff/apps/backend/.env.example) | Added documented backup environment variables |
| **Modified** | [`docs/TURFF_PRODUCTION_RELEASE_CHECKLIST.md`](file:///c:/projects/turff/docs/TURFF_PRODUCTION_RELEASE_CHECKLIST.md) | Updated Blocker 8 to PARTIAL (R7.1 complete, R7.2 pending) |

---

## 4. Architecture and Scheduling

```mermaid
flowchart TD
    subgraph Host_Environment["Production Host / Docker Network (turff_internal)"]
        Postgres[("PostgreSQL 15 Container (db:5432)")]
        Sidecar["Backup Sidecar (db-backup) / scripts/db-backup.sh"]
        WorkDir[("Ephemeral Storage (/backups)")]
        Lock["Concurrency Lock (backup.lock)"]
        StatusFile["Latest Status (/backups/latest-status.json)"]

        Sidecar -- "1. Acquire Lock" --> Lock
        Sidecar -- "2. pg_dump -Fc -Z6" --> Postgres
        Postgres -- "3. Stream Binary" --> WorkDir
        Sidecar -- "4. pg_restore -l (Verify TOC)" --> WorkDir
        Sidecar -- "5. AES-256-CBC Encrypt" --> WorkDir
        Sidecar -- "6. Unlink Plaintext Dump" --> WorkDir
        Sidecar -- "8. Write Status" --> StatusFile
        Sidecar -- "9. Release Lock" --> Lock
    end

    subgraph Offsite_Cloud["Offsite Cloud Storage (Separate Failure Domain)"]
        S3[("AWS S3 / Cloudflare R2 (db/turff_db_*.dump.enc)")]
        Sidecar -- "7. HTTPS SigV4 Upload & GFS Prune" --> S3
    end

    subgraph Alerting_Channel["Operations Alerting"]
        Telegram["Telegram Ops Bot (Markdown Alert)"]
        Sidecar -- "10. Status/Failure Webhook" --> Telegram
    end
```

### Scheduling Specification
- **Default Schedule:** Daily at `02:00 UTC` (`07:30 IST`).
- **Configurable:** via `BACKUP_TARGET_HOUR_UTC=2` and `BACKUP_TARGET_MIN_UTC=0`, or `BACKUP_SCHEDULE="0 2 * * *"`.
- **One-Shot Trigger:** Passing `BACKUP_RUN_ONCE=true` executes a single backup and terminates with the exit status of the runner.

---

## 5. PostgreSQL Dump Format and Archive Verification

### Dump Format
- Command: `pg_dump -h db -p 5432 -U postgres -d turff_db -Fc -Z6 -f <output>`
- **Format:** Custom PostgreSQL compressed binary format (`-Fc`).
- **Compression:** Zlib level 6 (`-Z6`), providing an optimal balance of speed and archive density.
- **Coverage:** Complete logical schema and dataset across all 53 tables, enums, triggers, foreign key constraints, indexes, and sequences.

### Verification Gate
Before an artifact is declared valid or encrypted:
- Inspection command: `pg_restore -l <output>`
- If `pg_restore` encounters corrupted archive blocks, a missing Table of Contents (TOC), or truncated headers, the process **aborts immediately**, writes status `FAILED` at stage `VERIFY`, dispatches a Telegram alert, and shreds the bad dump file.

---

## 6. Encryption Method and Key-Recovery Procedure

### Method
- **Cipher:** AES-256-CBC
- **Key Derivation:** PBKDF2 with HMAC-SHA256, 10,000 iterations, 8-byte cryptographic random salt.
- **Format:** OpenSSL standard (`Salted__` magic header + 8 bytes salt + ciphertext).

### Key Storage & Separation
- The encryption key (`BACKUP_ENCRYPTION_KEY`, min 16 characters) is supplied via environment injection from the operator's secure secret store.
- **The key is NEVER stored on the S3/R2 storage bucket beside the backups.**

### Operator Key-Recovery & Decryption Runbook
To decrypt a downloaded backup artifact:
```bash
# Set key in environment or prompt
export BACKUP_ENCRYPTION_KEY="<production-key>"

# Decrypt using standard OpenSSL CLI
openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 \
  -in turff_db_YYYYMMDD_HHMMSS_utc.dump.enc \
  -out turff_db_recovered.dump \
  -pass "env:BACKUP_ENCRYPTION_KEY"

# Verify archive integrity
pg_restore -l turff_db_recovered.dump
```

---

## 7. Storage Provider, Bucket Configuration, and Retention Rules

### Storage Provider Architecture
- Supports **AWS S3** and **Cloudflare R2** (or MinIO for local/staging testing).
- Transport is strictly over authenticated TLS (HTTPS).

### Retention Policy (Grandfather-Father-Son)
- **7 Daily Recovery Points:** Latest backup from each of the most recent 7 distinct calendar days.
- **4 Weekly Recovery Points:** Latest backup from each of the most recent 4 distinct ISO calendar weeks.
- **3 Monthly Recovery Points:** Latest backup from each of the most recent 3 distinct calendar months.

### Safety Boundaries
1. **Prefix Boundary:** Retention pruning strictly evaluates keys starting with `BACKUP_S3_PREFIX` (default: `db/`). Keys outside this prefix (e.g., user avatars, public turf photos) are **never** touched.
2. **Naming Validation:** Only objects strictly matching `^turff_db_(\d{8})_(\d{6})_utc\.dump\.enc$` are eligible for pruning.
3. **No Delete-Before-Replace:** Retention pruning runs **only after** the new backup has been confirmed uploaded.
4. **Newest-Backup Protection:** The newly created backup is unconditionally preserved.

---

## 8. Failure Alerting Behavior

The pipeline alerts on failure at any stage:
- `PREFLIGHT` (missing or weak encryption key)
- `LOCK` (concurrent job collision)
- `DUMP` (database failure or connection error)
- `VERIFY` (corrupt or 0-byte dump archive)
- `ENCRYPT` (OpenSSL failure or write error)
- `UPLOAD` (S3/R2 network abort or permission denial)
- `RETENTION` (remote bucket deletion failure)

### Credential Redaction Invariant
All alert messages and log outputs pass through `sanitize()`:
- `postgresql://postgres:password@...` $\to$ `postgresql://[REDACTED_USER_PASS]@...`
- `BACKUP_ENCRYPTION_KEY` and passphrases $\to$ `[REDACTED]`
- Telegram bot tokens $\to$ `bot[REDACTED_TOKEN]`
- AWS access/secret keys $\to$ `[REDACTED_SECRET]`

If the Telegram service is unavailable, the alert failure is logged to stderr but **does not mask the backup failure** or cause it to exit with false success.

---

## 9. Environment Variable Specification

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_HOST` | No | `db` | Database hostname inside Docker network |
| `POSTGRES_PORT` | No | `5432` | Database port |
| `POSTGRES_DB` | No | `turff_db` | Database name |
| `POSTGRES_USER` | No | `postgres` | Database user (or dedicated `backup_reader`) |
| `POSTGRES_PASSWORD` | **Yes** | â€” | Database user password |
| `BACKUP_ENCRYPTION_KEY` | **Yes** | â€” | Minimum 16-character AES-256 encryption key |
| `BACKUP_SCHEDULE` | No | `0 2 * * *` | Cron schedule expression |
| `BACKUP_S3_BUCKET` | Optional* | â€” | Dedicated backup bucket name |
| `BACKUP_S3_REGION` | No | `ap-south-1` | S3 region or `auto` for Cloudflare R2 |
| `BACKUP_S3_ACCESS_KEY_ID` | Optional* | â€” | IAM access key with S3 permissions |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Optional* | â€” | IAM secret access key |
| `BACKUP_S3_ENDPOINT` | No | â€” | Custom endpoint (e.g. `https://<id>.r2.cloudflarestorage.com`) |
| `BACKUP_S3_PREFIX` | No | `db/` | S3 key prefix boundary |
| `BACKUP_RETENTION_DAYS` | No | `7` | Daily retention count |
| `BACKUP_RETENTION_WEEKS` | No | `4` | Weekly retention count |
| `BACKUP_RETENTION_MONTHS` | No | `3` | Monthly retention count |
| `TELEGRAM_BOT_TOKEN` | No | â€” | Telegram Bot token for ops alerts |
| `TELEGRAM_ADMIN_CHAT_ID` | No | â€” | Telegram chat ID for ops alerts |

*\* Note: When S3 credentials are not yet supplied by the operator, the system operates in **Local Encrypted Staging Mode**, safely storing encrypted archives in the mounted `/backups` volume and logging `[PENDING ACTIVATION]`.*

---

## 10. Automated Tests & Verification Evidence

### 10.1 Unit Test Suite (`src/backup/backup.spec.ts`)
Run command: `npm run test -- src/backup/backup.spec.ts`
Result: **13 passed, 13 total** (Exit code: 0)

1. `âˆš should successfully encrypt and decrypt buffer with OpenSSL-compatible Salted__ header`
2. `âˆš should reject passphrase shorter than 16 characters`
3. `âˆš should fail decryption when using an incorrect passphrase`
4. `âˆš should reject invalid or truncated ciphertext without Salted__ header`
5. `âˆš should accurately preserve 7 daily, 4 weekly, and 3 monthly recovery points and prune expired items`
6. `âˆš should enforce safety boundaries: NEVER delete objects outside configured prefix or non-matching names`
7. `âˆš should sanitize credentials, connection strings, tokens, and keys from log messages`
8. `âˆš should handle unconfigured Telegram credentials gracefully without throwing`
9. `âˆš should throw immediately when credentials are missing or incomplete`
10. `âˆš should reject execution when encryption key is missing or shorter than 16 chars`
11. `âˆš should prevent overlapping executions via concurrency lockfile`
12. `âˆš should clean up plaintext temporary files when dump or verification fails`
13. `âˆš should complete successfully, encrypt dump, remove plaintext, record status, and release lock`

### 10.2 Regression Check Across Full Backend Test Suite
- **Unit Tests:** `npm run test` $\to$ **61 passed, 61 total (834 tests passed, 0 failures)**
- **E2E Tests:** `npm run test:e2e` $\to$ **30 passed, 30 total (720 tests passed, 0 failures)**
- **NestJS Build:** `npm run build` $\to$ **Success (Exit code: 0)**
- **Docker Compose Production Config:** `docker compose -f docker-compose.prod.yml config` $\to$ **Valid (Exit code: 0)**

### 10.3 Safe Local Dump Validation
Executed against live `turff-db-1` container:
- Output: `2.8M` custom compressed archive (`-Fc -Z6`) with 317 Table of Contents entries.
- Verified: `pg_restore -l` executed cleanly without errors.

---

## 11. Operational Activation & Operator Runbook

To activate automated production backups and remote sync, the production operator performs the following steps:

1. **Provision Offsite Storage Bucket:**
   - Create a dedicated private bucket on AWS S3 or Cloudflare R2: `turff-db-backups-prod`.
   - Ensure public access is completely blocked.
   - Configure IAM policy granting least-privilege permissions:
     - `s3:PutObject` on `arn:aws:s3:::turff-db-backups-prod/db/*`
     - `s3:ListBucket` on `arn:aws:s3:::turff-db-backups-prod`
     - `s3:DeleteObject` on `arn:aws:s3:::turff-db-backups-prod/db/*`
2. **Generate Strong Encryption Key:**
   - Generate a high-entropy passphrase (min 32 chars):
     `openssl rand -base64 32`
   - Store securely in the production password manager or AWS Secrets Manager.
3. **Configure Production `.env` File:**
   ```bash
   BACKUP_ENCRYPTION_KEY="<generated-passphrase>"
   BACKUP_S3_BUCKET="turff-db-backups-prod"
   BACKUP_S3_REGION="ap-south-1"
   BACKUP_S3_ACCESS_KEY_ID="<iam-access-key>"
   BACKUP_S3_SECRET_ACCESS_KEY="<iam-secret-key>"
   TELEGRAM_BOT_TOKEN="<bot-token>"
   TELEGRAM_ADMIN_CHAT_ID="<chat-id>"
   ```
4. **Deploy Backup Sidecar:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d db-backup
   ```
5. **Verify First Backup Run:**
   - Run manual trigger: `docker compose -f docker-compose.prod.yml exec db-backup /app/db-backup.sh`
   - Inspect status: `docker compose -f docker-compose.prod.yml exec db-backup cat /backups/latest-status.json`

---

## 12. Known Limitations & Strict Scope Boundaries

1. **Restore Verification Remains Incomplete (R7.2):** This phase establishes automated dump creation, encryption, and offsite sync. It does **not** perform an automated database restoration drill. That verification is the dedicated scope of Phase R7.2.
2. **Point-In-Time Recovery (PITR) Remains Incomplete (R7.3):** WAL continuous archiving (`archive_mode = on`) is not configured in this phase. Backups represent point-in-time logical snapshots taken at 02:00 UTC daily.
3. **Rollback Procedure:** If the `db-backup` container experiences issues, it can be stopped (`docker compose -f docker-compose.prod.yml stop db-backup`) without impacting the primary `db`, `redis`, `backend`, or `web` services.
