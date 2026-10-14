import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackupCryptoService } from './backup-crypto.service';
import { BackupRetentionService } from './backup-retention.service';
import { BackupS3Service } from './backup-s3.service';
import { BackupAlertService } from './backup-alert.service';
import { BackupOrchestratorService } from './backup-orchestrator.service';
import { BackupConfig } from './backup.constants';

describe('TURFF Backup & Disaster Recovery (R7.1 / PRA-OPS-03)', () => {
  let cryptoService: BackupCryptoService;
  let retentionService: BackupRetentionService;
  let s3Service: BackupS3Service;
  let alertService: BackupAlertService;
  let orchestratorService: BackupOrchestratorService;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turff-backup-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupCryptoService,
        BackupRetentionService,
        BackupS3Service,
        BackupAlertService,
        BackupOrchestratorService,
      ],
    }).compile();

    cryptoService = module.get<BackupCryptoService>(BackupCryptoService);
    retentionService = module.get<BackupRetentionService>(BackupRetentionService);
    s3Service = module.get<BackupS3Service>(BackupS3Service);
    alertService = module.get<BackupAlertService>(BackupAlertService);
    orchestratorService = module.get<BackupOrchestratorService>(BackupOrchestratorService);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Verification 1 & 3: Encryption Roundtrip & Validation ──────────────────
  describe('BackupCryptoService', () => {
    const validKey = 'very-strong-production-encryption-passphrase-2026';

    it('should successfully encrypt and decrypt buffer with OpenSSL-compatible Salted__ header', () => {
      const plaintext = Buffer.from('CREATE TABLE test_data (id INT, name TEXT); INSERT INTO test_data VALUES (1, "ok");');
      const encrypted = cryptoService.encryptBuffer(plaintext, validKey);

      expect(encrypted.subarray(0, 8).toString('utf8')).toBe('Salted__');
      expect(encrypted.length).toBeGreaterThan(plaintext.length);

      const decrypted = cryptoService.decryptBuffer(encrypted, validKey);
      expect(decrypted.toString('utf8')).toBe(plaintext.toString('utf8'));
    });

    it('should reject passphrase shorter than 16 characters', () => {
      const plaintext = Buffer.from('test data');
      expect(() => cryptoService.encryptBuffer(plaintext, 'short-pass')).toThrow(
        /must be at least 16 characters/,
      );
    });

    it('should fail decryption when using an incorrect passphrase', () => {
      const plaintext = Buffer.from('confidential database payload');
      const encrypted = cryptoService.encryptBuffer(plaintext, validKey);

      expect(() => cryptoService.decryptBuffer(encrypted, 'wrong-password-that-is-long-enough')).toThrow();
    });

    it('should reject invalid or truncated ciphertext without Salted__ header', () => {
      const badBuffer = Buffer.from('Not_OpenSSL_Formatted_At_All_Payload');
      expect(() => cryptoService.decryptBuffer(badBuffer, validKey)).toThrow(/missing Salted__ header/);
    });
  });

  // ── Verification 7 & 8: Grandfather-Father-Son Retention & Safety Boundaries
  describe('BackupRetentionService', () => {
    it('should accurately preserve 7 daily, 4 weekly, and 3 monthly recovery points and prune expired items', () => {
      const prefix = 'db/';
      const keys: string[] = [];

      // Generate 45 days of synthetic daily backups
      // Starting from 2026-10-15 working backwards to 2026-09-01
      const baseDate = new Date('2026-10-15T02:00:00Z');
      for (let i = 0; i < 45; i++) {
        const d = new Date(baseDate.getTime() - i * 86400000);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        keys.push(`${prefix}turff_db_${y}${m}${day}_020000_utc.dump.enc`);
      }

      const decision = retentionService.evaluateRetention(keys, {
        prefix,
        days: 7,
        weeks: 4,
        months: 3,
      });

      expect(decision.stats.totalEvaluated).toBe(45);
      // Daily: 7 days
      expect(decision.stats.dailyKept).toBe(7);
      // Weekly: 4 weeks
      expect(decision.stats.weeklyKept).toBe(4);
      // Monthly: at least 2 distinct months (October, September)
      expect(decision.stats.monthlyKept).toBeGreaterThanOrEqual(2);

      // Total kept must be distinct union
      expect(decision.keep.length).toBeGreaterThanOrEqual(7);
      expect(decision.prune.length).toBe(45 - decision.keep.length);

      // The absolute newest backup must ALWAYS be kept
      expect(decision.keep).toContain(`${prefix}turff_db_20261015_020000_utc.dump.enc`);

      // Very old backups not falling on weekly/monthly boundary must be pruned
      expect(decision.prune.length).toBeGreaterThan(0);
    });

    it('should enforce safety boundaries: NEVER delete objects outside configured prefix or non-matching names', () => {
      const prefix = 'db/';
      const mixedKeys = [
        'db/turff_db_20261015_020000_utc.dump.enc',
        'db/turff_db_20261014_020000_utc.dump.enc',
        'media/avatars/user123.jpg',                 // Foreign prefix
        'db/unrelated_manual_export.sql',           // Wrong extension/format
        'db/temporary_scratch.txt',                 // Unrelated file
        'turff_db_20261015_020000_utc.dump.enc',    // Missing prefix
      ];

      const decision = retentionService.evaluateRetention(mixedKeys, { prefix, days: 1 });

      // Only the 2 valid matching keys under db/ should be evaluated
      expect(decision.stats.totalEvaluated).toBe(2);
      expect(decision.prune).not.toContain('media/avatars/user123.jpg');
      expect(decision.prune).not.toContain('db/unrelated_manual_export.sql');
      expect(decision.prune).not.toContain('db/temporary_scratch.txt');
      expect(decision.prune).not.toContain('turff_db_20261015_020000_utc.dump.enc');
    });
  });

  // ── Verification 9, 10 & 11: Alerting, Missing Config & Secret Redaction ────
  describe('BackupAlertService', () => {
    it('should sanitize credentials, connection strings, tokens, and keys from log messages', () => {
      const dangerousMessage =
        'Error at postgresql://postgres:SuperSecretP@ssw0rd!@db:5432/turff_db with key="a1b2c3d4e5f60718293a4b5c6d7e8f90" and bot123456:ABC-DEF1234ghIkl-zyx';

      const sanitized = alertService.sanitize(dangerousMessage);

      expect(sanitized).not.toContain('SuperSecretP@ssw0rd!');
      expect(sanitized).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
      expect(sanitized).not.toContain('ABC-DEF1234ghIkl-zyx');
      expect(sanitized).toContain('[REDACTED_USER_PASS]');
    });

    it('should handle unconfigured Telegram credentials gracefully without throwing', async () => {
      const result = await alertService.sendStatusAlert(
        {
          timestamp: new Date().toISOString(),
          status: 'SUCCESS',
          stage: 'STATUS_RECORD',
          durationMs: 1200,
          offsiteUploaded: false,
        },
        {},
      );

      expect(result.sent).toBe(false);
      expect(result.error).toContain('not configured');
    });
  });

  // ── Verification 4 & 10: S3 Service Credential Checks & SigV4 Construction ──
  describe('BackupS3Service', () => {
    it('should throw immediately when credentials are missing or incomplete', async () => {
      await expect(
        s3Service.uploadObject({
          bucket: '',
          region: 'ap-south-1',
          accessKeyId: '',
          secretAccessKey: '',
          key: 'db/test.dump.enc',
          body: Buffer.from('test'),
        }),
      ).rejects.toThrow(/S3 credentials incomplete/);
    });
  });

  // ── Verification 2, 5, 6: Orchestration, Lock, Failures & Cleanup ──────────
  describe('BackupOrchestratorService', () => {
    const validConfig: BackupConfig = {
      host: 'localhost',
      port: 5432,
      database: 'turff_db',
      user: 'postgres',
      password: 'password',
      encryptionKey: 'long-enough-test-encryption-key-32ch',
      workDir: '',
      statusDir: '',
      retention: { days: 7, weeks: 4, months: 3 },
    };

    beforeEach(() => {
      validConfig.workDir = path.join(tempDir, 'work');
      validConfig.statusDir = path.join(tempDir, 'status');
    });

    it('should reject execution when encryption key is missing or shorter than 16 chars', async () => {
      const invalidConfig = { ...validConfig, encryptionKey: 'short' };
      await expect(orchestratorService.runBackup(invalidConfig)).rejects.toThrow(
        /BACKUP_ENCRYPTION_KEY must be configured and at least 16 characters/,
      );
    });

    it('should prevent overlapping executions via concurrency lockfile', async () => {
      fs.mkdirSync(validConfig.workDir, { recursive: true });
      const lockPath = path.join(validConfig.workDir, 'backup.lock');
      fs.writeFileSync(lockPath, '99999');

      await expect(orchestratorService.runBackup(validConfig)).rejects.toThrow(
        /Backup lock already held/,
      );

      // Ensure existing lockfile was NOT wiped by the failing invocation
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it('should clean up plaintext temporary files when dump or verification fails', async () => {
      // Mock executePgDump to simulate a failing pg_dump
      jest.spyOn<any, any>(orchestratorService, 'executePgDump').mockImplementation(async (_cfg, targetFile) => {
        fs.writeFileSync(targetFile, 'corrupt unverified plaintext data');
        throw new Error('Simulated pg_dump network failure');
      });

      await expect(orchestratorService.runBackup(validConfig)).rejects.toThrow(
        /Backup failed at stage DUMP/,
      );

      // Verify no plaintext dump files linger in work directory
      const files = fs.readdirSync(validConfig.workDir);
      const plaintextDumps = files.filter((f) => f.endsWith('.dump'));
      expect(plaintextDumps.length).toBe(0);

      // Verify lockfile was released
      expect(fs.existsSync(path.join(validConfig.workDir, 'backup.lock'))).toBe(false);

      // Verify status record was written recording FAILED status
      const statusFile = path.join(validConfig.statusDir, 'latest-status.json');
      expect(fs.existsSync(statusFile)).toBe(true);
      const recorded = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expect(recorded.status).toBe('FAILED');
      expect(recorded.stage).toBe('DUMP');
    });

    it('should complete successfully, encrypt dump, remove plaintext, record status, and release lock', async () => {
      // Mock successful pg_dump creating mock valid binary file
      jest.spyOn<any, any>(orchestratorService, 'executePgDump').mockImplementation(async (_cfg, targetFile) => {
        fs.writeFileSync(targetFile, Buffer.from('mock-pg-dump-custom-format-data-header-TOC-bytes'));
      });

      // Mock successful pg_restore -l verification
      jest.spyOn<any, any>(orchestratorService, 'verifyArchive').mockResolvedValue(undefined);

      const status = await orchestratorService.runBackup(validConfig);

      expect(status.status).toBe('SUCCESS');
      expect(status.stage).toBe('STATUS_RECORD');
      expect(status.sizeBytes).toBeGreaterThan(0);
      expect(status.durationMs).toBeGreaterThanOrEqual(0);

      // Verify plaintext .dump is GONE
      const files = fs.readdirSync(validConfig.workDir);
      expect(files.some((f) => f.endsWith('.dump'))).toBe(false);

      // Verify encrypted .dump.enc EXISTS locally (pending offsite config)
      const encFiles = files.filter((f) => f.endsWith('.dump.enc'));
      expect(encFiles.length).toBe(1);

      // Verify lockfile is released
      expect(fs.existsSync(path.join(validConfig.workDir, 'backup.lock'))).toBe(false);

      // Verify latest-status.json contents
      const statusFile = path.join(validConfig.statusDir, 'latest-status.json');
      const recorded = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expect(recorded.status).toBe('SUCCESS');
      expect(recorded.artifactId).toBe(encFiles[0]);
    });
  });
});
