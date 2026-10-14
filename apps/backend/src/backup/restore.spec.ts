import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackupCryptoService } from './backup-crypto.service';
import { BackupAlertService } from './backup-alert.service';
import { BackupRestoreService } from './backup-restore.service';

describe('TURFF Disaster Recovery & Database Restore (R7.2 / PRA-OPS-03)', () => {
  let restoreService: BackupRestoreService;
  let cryptoService: BackupCryptoService;
  let tempDir: string;
  const validKey = 'production-disaster-recovery-test-key-2026';

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turff-restore-test-'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [BackupCryptoService, BackupAlertService, BackupRestoreService],
    }).compile();

    restoreService = module.get<BackupRestoreService>(BackupRestoreService);
    cryptoService = module.get<BackupCryptoService>(BackupCryptoService);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Verification 1: Production Target Refusal (SAFETY GATE) ─────────────────
  describe('Safety Gate: Production Refusal', () => {
    const forbiddenTargets = [
      'turff_db',
      'TURFF_DB',
      'turff_prod',
      'turff_production',
      'postgres',
      'template0',
      'template1',
    ];

    test.each(forbiddenTargets)(
      'should strictly refuse to restore into forbidden production database name: %s',
      (target) => {
        expect(() => restoreService.validateTargetDatabase(target, 'turff_db')).toThrow(
          /SAFETY INTERVENTION: Target database '.*' is a forbidden production name/,
        );
      },
    );

    it('should reject invalid or dangerous database name characters', () => {
      expect(() => restoreService.validateTargetDatabase('turff_test; DROP TABLE User;', 'turff_db')).toThrow(
        /Invalid target database name/,
      );
      expect(() => restoreService.validateTargetDatabase('../../etc/passwd', 'turff_db')).toThrow(
        /Invalid target database name/,
      );
    });

    it('should accept valid isolated destination database names', () => {
      expect(() => restoreService.validateTargetDatabase('turff_test_restore', 'turff_db')).not.toThrow();
      expect(() => restoreService.validateTargetDatabase('turff_drill_20261015', 'turff_db')).not.toThrow();
    });
  });

  // ── Verification 2: Explicit Confirmation Gate ──────────────────────────────
  describe('Safety Gate: Explicit Confirmation', () => {
    it('should refuse to proceed when confirmation is false or omitted', () => {
      expect(() => restoreService.validateConfirmation(false)).toThrow(
        /SAFETY INTERVENTION: Restore requires explicit confirmation/,
      );
    });

    it('should allow execution when confirmation is explicitly true or --confirm', () => {
      expect(() => restoreService.validateConfirmation(true)).not.toThrow();
      expect(() => restoreService.validateConfirmation('--confirm')).not.toThrow();
      expect(() => restoreService.validateConfirmation('true')).not.toThrow();
    });
  });

  // ── Verification 3: Invalid Backup Paths & Missing/Wrong Keys ───────────────
  describe('Pre-Restore Artifact & Key Validation', () => {
    it('should fail with FAILED status when backup file does not exist', async () => {
      const result = await restoreService.runRestore({
        backupFilePath: path.join(tempDir, 'non_existent.dump.enc'),
        targetDatabase: 'turff_test_restore',
        confirmed: true,
        encryptionKey: validKey,
      });

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('Backup file not found');
    });

    it('should fail when encryption key is missing or shorter than 16 chars', async () => {
      const fakeFile = path.join(tempDir, 'empty.dump.enc');
      fs.writeFileSync(fakeFile, 'some-content');

      const result = await restoreService.runRestore({
        backupFilePath: fakeFile,
        targetDatabase: 'turff_test_restore',
        confirmed: true,
        encryptionKey: 'short',
      });

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('must be provided and at least 16 characters long');
    });

    it('should fail decryption when ciphertext is corrupt or key is incorrect', async () => {
      // Create a valid encrypted file with validKey
      const plainDump = Buffer.from('PGDMP-mock-header');
      const encryptedData = cryptoService.encryptBuffer(plainDump, validKey);
      const encFile = path.join(tempDir, 'valid.dump.enc');
      fs.writeFileSync(encFile, encryptedData);

      // Attempt restore with wrong key
      const result = await restoreService.runRestore({
        backupFilePath: encFile,
        targetDatabase: 'turff_test_restore',
        confirmed: true,
        encryptionKey: 'wrong-key-of-sufficient-length-here',
        workDir: tempDir,
      });

      expect(result.status).toBe('FAILED');
      expect(result.error).toBeDefined();

      // Ensure no decrypted plaintext dump lingers in directory
      const files = fs.readdirSync(tempDir);
      expect(files.some((f) => f.endsWith('.dump'))).toBe(false);
    });
  });

  // ── Verification 4: Plaintext Cleanup on Success & Failure ──────────────────
  describe('Cleanup Guarantees', () => {
    it('should immediately clean up plaintext decrypted dump when pg_restore fails', async () => {
      // Create a file with valid encryption but invalid pg_restore TOC
      const mockCorruptPayload = Buffer.from('NOT_A_VALID_PG_RESTORE_CUSTOM_ARCHIVE');
      const encrypted = cryptoService.encryptBuffer(mockCorruptPayload, validKey);
      const encFile = path.join(tempDir, 'corrupt_archive.dump.enc');
      fs.writeFileSync(encFile, encrypted);

      const result = await restoreService.runRestore({
        backupFilePath: encFile,
        targetDatabase: 'turff_test_restore',
        confirmed: true,
        encryptionKey: validKey,
        workDir: tempDir,
      });

      expect(result.status).toBe('FAILED');

      // Verify all plaintext temporary dump files are destroyed
      const remainingFiles = fs.readdirSync(tempDir);
      const plaintextFiles = remainingFiles.filter((f) => f.endsWith('.dump'));
      expect(plaintextFiles.length).toBe(0);
    });

    it('should successfully restore, return TOC count, and clean up temporary dump on success', async () => {
      const mockValidPayload = Buffer.from('MOCK_VALID_PG_RESTORE_STREAM');
      const encrypted = cryptoService.encryptBuffer(mockValidPayload, validKey);
      const encFile = path.join(tempDir, 'valid_archive.dump.enc');
      fs.writeFileSync(encFile, encrypted);

      // Mock verifyArchiveToc and executePgRestore
      jest.spyOn<any, any>(restoreService, 'verifyArchiveToc').mockResolvedValue(313);
      jest.spyOn<any, any>(restoreService, 'executePgRestore').mockResolvedValue(undefined);

      const result = await restoreService.runRestore({
        backupFilePath: encFile,
        targetDatabase: 'turff_test_restore',
        confirmed: true,
        encryptionKey: validKey,
        workDir: tempDir,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.targetDatabase).toBe('turff_test_restore');
      expect(result.tocEntries).toBe(313);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify plaintext decrypted dump is cleaned up
      const remainingFiles = fs.readdirSync(tempDir);
      expect(remainingFiles.some((f) => f.endsWith('.dump'))).toBe(false);
    });
  });
});
