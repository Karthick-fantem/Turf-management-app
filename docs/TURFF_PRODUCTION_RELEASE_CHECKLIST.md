# TURFF — PRODUCTION RELEASE CHECKLIST
**Companion Verification Checklist to PRA-01**  
**Document**: `docs/TURFF_PRODUCTION_RELEASE_CHECKLIST.md`  
**Purpose**: Define the exact verification evidence and sign-off procedures required to close all P0 and P1 launch blockers before production deployment.

---

## 1. P0 Launch Blockers (Must Close Before Any Production Release)

### ☐ Blocker 1: Production Nginx Reverse Proxy Configuration (`PRA-OPS-01`)
- **Problem**: `docker-compose.prod.yml` runs Nginx without reverse proxy configuration. All API calls fail with 404, and the backend has zero reachable external ports.
- **Required Action**:
  1. Create `apps/web/nginx.conf` (or `/nginx/turff.conf`) configuring:
     - `root /usr/share/nginx/html` for static web portals (`admin.html`, `owner.html`, `index.html`).
     - `location /api/` forwarding to `http://backend:3000/`.
     - `location /health/` forwarding to `http://backend:3000/health/`.
     - `location /socket.io/` proxying WebSockets with `Upgrade` and `Connection` headers.
  2. Mount configuration file in `docker-compose.prod.yml` under `web` service.
- **Required Verification Evidence**:
  - [ ] Start production container: `docker-compose -f docker-compose.prod.yml up -d`
  - [ ] Execute `curl -I http://localhost/health/ready` $\to$ Returns `HTTP/1.1 200 OK`
  - [ ] Open browser at `http://localhost/admin.html` and verify login screen successfully authenticates against `/api/admin/auth/login`.

---

### ☐ Blocker 2: Android Production Release Keystore Signing (`PRA-OPS-02`)
- **Problem**: Mobile and Owner Android configurations sign release builds with debug keys (`signingConfig = signingConfigs.getByName("debug")`), which cannot be published to Google Play.
- **Required Action**:
  1. Generate production upload keystore (`turff-release-key.jks`).
  2. Configure `android/key.properties` for both `apps/mobile` and `apps/owner-app`.
  3. Update `build.gradle.kts` to load `key.properties` and assign `signingConfig = signingConfigs.getByName("release")` for `buildTypes.release`.
  4. Ensure `.gitignore` ignores `*.jks` and `key.properties`.
- **Required Verification Evidence**:
  - [ ] Run `flutter build appbundle --release` in `apps/mobile`
  - [ ] Run `flutter build appbundle --release` in `apps/owner-app`
  - [ ] Inspect build signature using `apksigner verify --verbose --print-certs <path-to-apk>`:
    - [ ] Signer certificate is production release certificate (not `CN=Android Debug`).
    - [ ] `Verified using v1 scheme (JAR signing): true`
    - [ ] `Verified using v2 scheme (APK Signature Scheme v2): true`

---

### ☑ Blocker 3: Asynchronous Razorpay Webhook Handler & Idempotent Crediting (`PRA-FIN-01`) — REMEDIATED (R3)
- **Problem**: Payment credits rely solely on client-side requests (`POST /wallet/verify-payment`). Lost network or killed apps result in permanent money loss for users without wallet crediting.
- **Required Action**:
  1. Implement `@Post('webhook')` in `apps/backend/src/wallet/wallet.controller.ts`.
  2. Verify Razorpay webhook signature header (`x-razorpay-signature`) against raw request payload using `RAZORPAY_WEBHOOK_SECRET`.
  3. Handle `payment.captured` and `order.paid` events.
  4. Atomically credit user wallet inside `$transaction` if `Payment` record is in `PENDING` state using row-level locking (`SELECT ... FOR UPDATE`).
- **Required Verification Evidence**:
  - [x] Create pending payment order via `POST /wallet/create-order`.
  - [x] Simulate Razorpay webhook delivery directly to `POST /wallet/webhook` with computed HMAC signature.
  - [x] Verify HTTP response is `200 OK`.
  - [x] Verify `Payment.status` transitions to `SUCCESS`.
  - [x] Verify `Wallet.balance` is incremented.
  - [x] Re-send duplicate webhook payload $\to$ Verify idempotent response without double-crediting.
- **Remediation Report**: [`TURFF_R3_RAZORPAY_WEBHOOK_PAYMENT_RECOVERY_IMPLEMENTATION.md`](file:///c:/projects/turff/docs/TURFF_R3_RAZORPAY_WEBHOOK_PAYMENT_RECOVERY_IMPLEMENTATION.md)

---

## 2. P1 High Priority Blockers (Must Close Before General Availability)

### ☑ Blocker 4: Resolve Critical & High Dependency Vulnerabilities (`PRA-SEC-01`) — REMEDIATED (R4)
- **Problem**: Critical vulnerability in `proxy-addr` (CVSS 9.1) allows client IP spoofing, bypassing rate limits.
- **Required Action**:
  1. Add npm overrides in `apps/backend/package.json`:
     ```json
     "overrides": {
       "proxy-addr": "^2.0.8",
       "handlebars": "^4.7.10",
       "source-map-js": "^1.2.2",
       "qs": "^6.16.0"
     }
     ```
  2. Run `npm install` and update minor safe dependencies.
  3. Configure `expressApp.set('trust proxy', 1)` in `main.ts` for authoritative 1-hop Nginx reverse proxy.
- **Required Verification Evidence**:
  - [x] Run `npm audit --audit-level=critical` in `apps/backend` $\to$ Returns 0 critical vulnerabilities.
  - [x] Run `npm test` and `npm run test:e2e` $\to$ All 1,498 backend tests pass (794 unit + 704 e2e).
- **Remediation Report**: [`TURFF_R4_DEPENDENCY_SECURITY_REMEDIATION.md`](file:///c:/projects/turff/docs/TURFF_R4_DEPENDENCY_SECURITY_REMEDIATION.md)

---

### ☑ Blocker 5: Global ValidationPipe Whitelist Stripping (`PRA-SEC-02`) — RESOLVED
- **Problem**: `ValidationPipe` in `main.ts` lacked `whitelist: true`, allowing extraneous fields to pass unstripped.
- **Remediation**:
  1. Updated `apps/backend/src/main.ts`:
     ```typescript
     app.useGlobalPipes(
       new ValidationPipe({
         whitelist: true,              // Strip unvalidated/extraneous properties from request DTOs (PRA-SEC-02)
         transform: true,              // Auto-transform types
         transformOptions: { enableImplicitConversion: true },
       }),
     );
     ```
- **Required Verification Evidence**:
  - [x] Send payload with extra fields to DTO endpoint (`POST /wallet/create-order` with `{ amount: 500, status: 'SUCCESS', isAdmin: true, bonusCredits: 10000 }`).
  - [x] Verify handler receives only validated DTO fields (`amount: 500`), and database record retains `status: 'PENDING'`.
  - [x] Added unit tests (`apps/backend/src/common/pipes/validation-security.spec.ts`: 16/16 passed).
  - [x] Added E2E tests (`apps/backend/test/validation-hardening.e2e-spec.ts`: 8/8 passed).
  - [x] Full backend unit test suite passed: **59 suites, 810 passed, 0 failed**.
  - [x] Full backend E2E test suite passed: **29 suites, 712 passed, 0 failed**.
  - [x] TypeScript build typecheck exited 0 (`npx tsc --noEmit -p tsconfig.build.json`).
  - [x] Production build exited 0 (`npm run build`).
  - [x] Webhook processing (`POST /wallet/webhook`) verified intact with HMAC signature validation.
- **Remediation Report**: [`TURFF_R5_GLOBAL_VALIDATIONPIPE_HARDENING.md`](file:///c:/projects/turff/docs/TURFF_R5_GLOBAL_VALIDATIONPIPE_HARDENING.md)

---

### ☑ Blocker 6: Global Rate Limiting across Sensitive Endpoints (`PRA-SEC-03`) — RESOLVED
- **Problem**: Only 4 authentication routes were rate-limited. Search, media upload, slot booking/hold, and wallet order creation were vulnerable to denial-of-service, inventory hoarding, and brute force.
- **Remediation**:
  1. Updated `apps/backend/src/common/guards/rate-limit.guard.ts` with standardized policies, explicit actor keying (`user:<userId>` for authenticated requests, `ip:<clientIp>` for public endpoints), single-hop trusted-proxy client IP derivation, and runtime environment variable overrides.
  2. Applied `@UseGuards(JwtAuthGuard, RateLimitGuard)` and `@RateLimit` policies across:
     - `POST /slots/:slotId/book`: 10 req / 60s (`category: 'slot_booking'`)
     - `POST /slots/:slotId/hold`: 10 req / 60s (`category: 'slot_hold'`)
     - `POST /media/upload-url`: 10 req / 60s (`category: 'media_upload_url'`)
     - `POST /wallet/create-order`: 5 req / 60s (`category: 'wallet_create_order'`)
  3. Applied `@UseGuards(RateLimitGuard)` and `@RateLimit` across:
     - `GET /search`: 30 req / 60s (`category: 'search_public'`)
- **Required Verification Evidence**:
  - [x] Send requests exceeding limit to `POST /media/upload-url` (3 allowed, 4th throttled).
  - [x] Verify throttled requests return `HTTP 429 Too Many Requests` with `Retry-After` header.
  - [x] Added unit tests (`apps/backend/src/common/guards/rate-limit.guard.spec.ts`: 11/11 passed).
  - [x] Added E2E tests (`apps/backend/test/sensitive-rate-limiting.e2e-spec.ts`: 8/8 passed).
  - [x] Full backend unit test suite passed: **60 suites, 821 passed, 0 failed**.
  - [x] Full backend E2E test suite passed: **30 suites, 720 passed, 0 failed**.
  - [x] TypeScript build typecheck exited 0 (`npx tsc --noEmit -p tsconfig.build.json`).
  - [x] Production build exited 0 (`npm run build`).
  - [x] Anti-spoofing verified: forged `X-Forwarded-For` headers cannot bypass single-hop proxy rate limiting.
- **Remediation Report**: [`TURFF_R6_SENSITIVE_ENDPOINT_RATE_LIMITING.md`](file:///c:/projects/turff/docs/TURFF_R6_SENSITIVE_ENDPOINT_RATE_LIMITING.md)

---

### ☐ Blocker 7: Tournament Entry Fee Collection & Prize Settlement (`PRA-FIN-02`)
- **Problem**: Teams register with `isConfirmed: true` even when `entryFeeInr > 0` without collecting funds.
- **Required Action**:
  1. In `TournamentsService.registerTeam`:
     - If `tournament.entryFeeInr > 0`, deduct entry fee from captain's wallet or require payment reference.
     - Only grant `isConfirmed: true` once payment is settled.
  2. Implement `TournamentsService.concludeTournament` distributing prizes to winning teams.
- **Required Verification Evidence**:
  - [ ] Register team in a tournament with `entryFeeInr: 500` with insufficient wallet balance $\to$ Rejected with `Insufficient wallet balance`.
  - [ ] Register with sufficient wallet balance $\to$ Verified wallet debit and confirmed registration.

---

### 🔄 Blocker 8: PostgreSQL Automated Backup, WAL Archiving & PITR (`PRA-OPS-03`)
- **Status:** **PARTIAL** (R7.1 Backup Engine, R7.2 Recovery Drill & R7.3 PITR Verified — `PRA-OPS-03` remains **OPEN** pending operator offsite bucket credentials)
- **Problem**: PostgreSQL data previously had no scheduled backup, encryption, retention, WAL archiving, or tested restore procedure.
- **Remediation Action (R7.1, R7.2 & R7.3 Complete)**:
  1. Created standalone backup script [`scripts/db-backup.sh`](file:///c:/projects/turff/scripts/db-backup.sh) and Docker sidecar [`docker/backup/Dockerfile`](file:///c:/projects/turff/docker/backup/Dockerfile) executing scheduled daily `pg_dump -Fc -Z6` as unprivileged non-root user (`postgres`).
  2. Implemented OpenSSL-interoperable AES-256-CBC PBKDF2 encryption (10,000 iterations, 8-byte salt) and immediate plaintext cleanup traps.
  3. Integrated AWS S3 / Cloudflare R2 SigV4 offsite upload engine with GFS retention (7 daily, 4 weekly, 3 monthly) and strict prefix safety boundaries (`db/`, `base/`, `wal/`).
  4. Added Telegram failure notification and local status tracking (`/backups/latest-status.json` and `/wal_archive/archive-status.json`).
  5. Created disaster recovery playbook [`docs/TURFF_DISASTER_RECOVERY_PLAYBOOK.md`](file:///c:/projects/turff/docs/TURFF_DISASTER_RECOVERY_PLAYBOOK.md) and safe restore tool [`scripts/db-restore.sh`](file:///c:/projects/turff/scripts/db-restore.sh) with production target refusal gates.
  6. **R7.2 Recovery Drill into Isolated Database (`turff_test_restore`)**:
     - Restored all 53 base tables (100% schema match).
     - Restored all 53,235 records across all 53 tables with 0 mismatches (100.0% exact match).
     - Restored all 115 indexes and 58 foreign key constraints.
     - Confirmed `npx prisma migrate status` $\to$ `Database schema is up to date!` (17 migrations synchronized).
     - Restore duration: 3.0 seconds elapsed.
  7. **R7.3 WAL Archiving & Point-In-Time Recovery (PITR)**:
     - Implemented atomic, idempotent WAL archive command ([`scripts/wal-archive.sh`](file:///c:/projects/turff/scripts/wal-archive.sh)) and PITR restore command ([`scripts/wal-restore.sh`](file:///c:/projects/turff/scripts/wal-restore.sh)).
     - Configured PostgreSQL 15 with `archive_mode = on`, `wal_level = replica`, `archive_timeout = 300s` and isolated shared volume `turff_wal_archive`.
     - Built [`WalArchiveService`](file:///c:/projects/turff/apps/backend/src/backup/wal-archive.service.ts) enforcing the Golden Rule of WAL Retention (never prune WAL required by retained base backups) and stalled-archive health alerts.
     - **Executed Real Isolated PITR Disaster Recovery Drill (`scripts/test-pitr-drill.sh`)**:
       - Took physical base backup via `pg_basebackup -Ft -z`.
       - Executed legitimate transaction `T1_CONFIRMED_SLOT_BOOKING` and captured timestamp `2026-10-14 21:57:30.691321+00`.
       - Shipped WAL segments to archive; simulated corrupting transaction `T2_MALICIOUS_OR_CORRUPT_TRANSACTION` 2 seconds later.
       - Replayed WAL archive in isolated recovery instance to target timestamp.
       - Observed recovery and promotion completed in **6 seconds**.
       - Verified records: `T0_OPENING_BALANCE` present, `T1_CONFIRMED_SLOT_BOOKING` present, `T2_MALICIOUS_OR_CORRUPT_TRANSACTION` completely absent.
       - Reduced RPO from 24 hours to $\le 5$ minutes.
  8. Automated test suites passing: 39 unit tests in `src/backup/` (850 unit + 720 e2e tests passing, build clean).
- **Pending Operator Activation**:
  - [ ] Provision production private S3/R2 bucket credentials (`BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`) to enable live offsite sync. Full closure of `PRA-OPS-03` requires verified live offsite cloud upload.
- **Reports**: [`TURFF_R7_1_AUTOMATED_BACKUP_IMPLEMENTATION.md`](file:///c:/projects/turff/docs/TURFF_R7_1_AUTOMATED_BACKUP_IMPLEMENTATION.md), [`TURFF_R7_2_RESTORE_DRILL_REPORT.md`](file:///c:/projects/turff/docs/TURFF_R7_2_RESTORE_DRILL_REPORT.md), [`TURFF_R7_3_WAL_PITR_IMPLEMENTATION_REPORT.md`](file:///c:/projects/turff/docs/TURFF_R7_3_WAL_PITR_IMPLEMENTATION_REPORT.md).

---

### ☐ Blocker 9: CI Pipeline Inclusion of Owner App & Production API URL (`PRA-OPS-04`)
- **Problem**: CI neglects `apps/owner-app` and builds mobile APK with non-routable default URL `10.0.2.2:3000`.
- **Required Action**:
  1. Add `owner-app` job to `.github/workflows/ci.yml` running `flutter analyze` and `flutter test`.
  2. Update `build-apk` job to include `--dart-define=API_BASE_URL=${{ secrets.PROD_API_URL }}`.
- **Required Verification Evidence**:
  - [ ] Push commit to test branch $\to$ GitHub Actions runs tests for backend, mobile, and owner-app.
  - [ ] Verified compiled APK connects to specified `API_BASE_URL`.

---

## 3. Final Sign-Off Gate

All items above must be checked and signed off prior to deploying TURFF to public production environments:

| Role | Sign-Off Requirement | Status | Date |
|---|---|---|---|
| **Security Engineer** | Blockers 4, 5, 6 verified | Pending | — |
| **Financial Controller / Backend Lead** | Blockers 3, 7 verified | Pending | — |
| **DevOps / Infrastructure Lead** | Blockers 1, 8, 9 verified | Pending | — |
| **Mobile Lead** | Blocker 2 verified | Pending | — |
| **Lead Auditor** | Final Production Release Authorization | Pending | — |
