import { Test, TestingModule } from '@nestjs/testing';
import { WalArchiveService, ArchiverStatRow } from './wal-archive.service';

describe('TURFF WAL Archiving & Point-In-Time Recovery (R7.3 / PRA-OPS-03)', () => {
  let walService: WalArchiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WalArchiveService],
    }).compile();

    walService = module.get<WalArchiveService>(WalArchiveService);
  });

  // ── Verification 1: WAL Filename Format & Validation ───────────────────────
  describe('WAL Filename Validation', () => {
    it('should accept valid 24-hex-character WAL filenames', () => {
      expect(walService.isValidWalFilename('000000010000000000000001')).toBe(true);
      expect(walService.isValidWalFilename('0000000200000001000000FF')).toBe(true);
      expect(walService.isValidWalFilename('000000010000000000000001.enc')).toBe(true);
    });

    it('should accept valid .backup label filenames and .history files', () => {
      expect(walService.isValidWalFilename('000000010000000000000001.00000028.backup')).toBe(true);
      expect(walService.isValidWalFilename('000000010000000000000001.00000028.backup.enc')).toBe(true);
      expect(walService.isValidWalFilename('00000002.history')).toBe(true);
    });

    it('should reject invalid, dangerous, or malformed filenames', () => {
      expect(walService.isValidWalFilename('../../../etc/passwd')).toBe(false);
      expect(walService.isValidWalFilename('invalid_wal_file.txt')).toBe(false);
      expect(walService.isValidWalFilename('00000001_short')).toBe(false);
      expect(walService.isValidWalFilename('')).toBe(false);
    });
  });

  // ── Verification 2: Retention Safety (Golden Rule) ─────────────────────────
  describe('WAL Retention Safety (Golden Rule: Never Delete Required WAL)', () => {
    const baseBackupStartWal = '000000010000000000000010';

    it('should strictly PRESERVE all WAL segments >= oldest base backup start WAL', () => {
      // Exactly at boundary
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000010', baseBackupStartWal)).toBe(true);
      // Newer segment
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000011', baseBackupStartWal)).toBe(true);
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000020', baseBackupStartWal)).toBe(true);
      // Newer timeline
      expect(walService.isWalRequiredByBaseBackup('000000020000000000000001', baseBackupStartWal)).toBe(true);
      // Encrypted variant
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000015.enc', baseBackupStartWal)).toBe(true);
    });

    it('should identify strictly OLDER WAL segments as eligible for pruning', () => {
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000009', baseBackupStartWal)).toBe(false);
      expect(walService.isWalRequiredByBaseBackup('000000010000000000000001', baseBackupStartWal)).toBe(false);
      expect(walService.isWalRequiredByBaseBackup('00000001000000000000000F', baseBackupStartWal)).toBe(false);
    });

    it('should correctly partition a stream of WAL segments into keep and prune sets', () => {
      const stream = [
        '000000010000000000000008',
        '000000010000000000000009',
        '000000010000000000000010', // base backup checkpoint
        '000000010000000000000011',
        '000000010000000000000012',
      ];

      const { keep, prune } = walService.filterWalRetention(stream, baseBackupStartWal);

      expect(keep).toEqual([
        '000000010000000000000010',
        '000000010000000000000011',
        '000000010000000000000012',
      ]);
      expect(prune).toEqual([
        '000000010000000000000008',
        '000000010000000000000009',
      ]);
    });
  });

  // ── Verification 3: Archiver Health & Stalled Archive Detection ─────────────
  describe('Archiver Health & Stalled Archive Detection', () => {
    it('should report HEALTHY when archiver is successfully processing segments', () => {
      const healthyStat: ArchiverStatRow = {
        archived_count: 42,
        last_archived_wal: '00000001000000000000002A',
        last_archived_time: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago
        failed_count: 0,
        last_failed_wal: null,
        last_failed_time: null,
      };

      const health = walService.evaluateArchiverHealth(healthyStat, { stalledThresholdMinutes: 15 });

      expect(health.status).toBe('HEALTHY');
      expect(health.isStalled).toBe(false);
      expect(health.archivedCount).toBe(42);
      expect(health.failedCount).toBe(0);
    });

    it('should report DEGRADED when an archive failure occurred after the last successful archive', () => {
      const now = Date.now();
      const failingStat: ArchiverStatRow = {
        archived_count: 10,
        last_archived_wal: '00000001000000000000000A',
        last_archived_time: new Date(now - 10 * 60 * 1000), // 10 mins ago
        failed_count: 3,
        last_failed_wal: '00000001000000000000000B',
        last_failed_time: new Date(now - 1 * 60 * 1000), // 1 min ago (after success)
      };

      const health = walService.evaluateArchiverHealth(failingStat);

      expect(health.status).toBe('DEGRADED');
      expect(health.isStalled).toBe(true);
      expect(health.lastFailedWal).toBe('00000001000000000000000B');
      expect(health.failedCount).toBe(3);
      expect(health.message).toContain('failing on segment');
    });

    it('should report STALLED when no segments have been archived within the threshold', () => {
      const now = Date.now();
      const stalledStat: ArchiverStatRow = {
        archived_count: 5,
        last_archived_wal: '000000010000000000000005',
        last_archived_time: new Date(now - 35 * 60 * 1000), // 35 mins ago
        failed_count: 0,
        last_failed_wal: null,
        last_failed_time: null,
      };

      const health = walService.evaluateArchiverHealth(stalledStat, {
        stalledThresholdMinutes: 15,
        currentTime: new Date(now),
      });

      expect(health.status).toBe('STALLED');
      expect(health.isStalled).toBe(true);
      expect(health.message).toContain('stalled: no WAL segments archived');
    });

    it('should report DISABLED when zero archives have been produced and no failures exist', () => {
      const zeroStat: ArchiverStatRow = {
        archived_count: '0',
        last_archived_wal: null,
        last_archived_time: null,
        failed_count: '0',
        last_failed_wal: null,
        last_failed_time: null,
      };

      const health = walService.evaluateArchiverHealth(zeroStat);

      expect(health.status).toBe('DISABLED');
      expect(health.isStalled).toBe(false);
    });
  });
});
