import { Injectable, Logger } from '@nestjs/common';

export interface ArchiverStatRow {
  archived_count: string | number;
  last_archived_wal: string | null;
  last_archived_time: string | Date | null;
  failed_count: string | number;
  last_failed_wal: string | null;
  last_failed_time: string | Date | null;
  stats_reset?: string | Date | null;
}

export interface ArchiverHealthResult {
  status: 'HEALTHY' | 'DEGRADED' | 'STALLED' | 'DISABLED';
  archivedCount: number;
  failedCount: number;
  lastArchivedWal: string | null;
  lastFailedWal: string | null;
  isStalled: boolean;
  message: string;
}

@Injectable()
export class WalArchiveService {
  private readonly logger = new Logger(WalArchiveService.name);

  // PostgreSQL WAL naming: 24 hex chars (8 chars timeline + 16 chars LSN offset)
  private static readonly WAL_REGEX = /^[0-9A-Fa-f]{24}(\.[0-9A-Fa-f]{8}\.backup)?$/;
  private static readonly HISTORY_REGEX = /^[0-9A-Fa-f]{8}\.history$/;

  /**
   * Validate whether a filename matches PostgreSQL WAL segment conventions.
   */
  isValidWalFilename(filename: string): boolean {
    if (!filename) return false;
    const clean = filename.replace(/\.enc$/, '');
    return WalArchiveService.WAL_REGEX.test(clean) || WalArchiveService.HISTORY_REGEX.test(clean);
  }

  /**
   * Determine whether a WAL segment is still required by an active base backup.
   * Golden Rule: A WAL segment MUST NOT be deleted if its segment index >= oldestBaseBackupStartWal.
   *
   * In PostgreSQL, WAL segment filenames are 24-character hexadecimal numbers:
   *   [Timeline: 8 hex][LogId: 8 hex][SegmentId: 8 hex]
   * Standard lexicographical comparison on the 24 hex characters strictly corresponds to LSN order.
   */
  isWalRequiredByBaseBackup(walFilename: string, oldestRequiredWal: string): boolean {
    const cleanWal = walFilename.replace(/\.enc$/, '');
    const cleanRequired = oldestRequiredWal.replace(/\.enc$/, '');

    // .backup label files associated with the base backup are always required
    if (cleanWal.endsWith('.backup')) {
      const associatedWal = cleanWal.substring(0, 24);
      return associatedWal >= cleanRequired;
    }

    if (!this.isValidWalFilename(cleanWal) || !this.isValidWalFilename(cleanRequired)) {
      // Safety failsafe: if format is unknown, assume required to prevent accidental data loss
      return true;
    }

    // Hex string comparison matches timeline and log segment order
    return cleanWal >= cleanRequired;
  }

  /**
   * Evaluate health of PostgreSQL archiver process from pg_stat_archiver.
   */
  evaluateArchiverHealth(
    stat: ArchiverStatRow,
    options: { stalledThresholdMinutes?: number; currentTime?: Date } = {},
  ): ArchiverHealthResult {
    const archivedCount = parseInt(String(stat.archived_count || '0'), 10);
    const failedCount = parseInt(String(stat.failed_count || '0'), 10);
    const lastArchivedTime = stat.last_archived_time ? new Date(stat.last_archived_time) : null;
    const lastFailedTime = stat.last_failed_time ? new Date(stat.last_failed_time) : null;
    const now = options.currentTime ?? new Date();
    const thresholdMs = (options.stalledThresholdMinutes ?? 15) * 60 * 1000;

    // Case 1: Archiving disabled or zero archives produced yet
    if (archivedCount === 0 && !stat.last_archived_wal) {
      if (failedCount > 0) {
        return {
          status: 'DEGRADED',
          archivedCount,
          failedCount,
          lastArchivedWal: null,
          lastFailedWal: stat.last_failed_wal,
          isStalled: true,
          message: `WAL Archiving failed at initial segment '${stat.last_failed_wal}' (failed count: ${failedCount})`,
        };
      }
      return {
        status: 'DISABLED',
        archivedCount: 0,
        failedCount: 0,
        lastArchivedWal: null,
        lastFailedWal: null,
        isStalled: false,
        message: 'WAL Archiving is inactive or has not archived any segments yet',
      };
    }

    // Case 2: Failed archiving detected
    if (lastFailedTime && lastArchivedTime && lastFailedTime > lastArchivedTime) {
      return {
        status: 'DEGRADED',
        archivedCount,
        failedCount,
        lastArchivedWal: stat.last_archived_wal,
        lastFailedWal: stat.last_failed_wal,
        isStalled: true,
        message: `WAL Archiving is failing on segment '${stat.last_failed_wal}' (failed count: ${failedCount})`,
      };
    }

    // Case 3: Check if archiving is stalled (time elapsed without successful archive)
    if (lastArchivedTime) {
      const elapsedMs = now.getTime() - lastArchivedTime.getTime();
      if (elapsedMs > thresholdMs) {
        return {
          status: 'STALLED',
          archivedCount,
          failedCount,
          lastArchivedWal: stat.last_archived_wal,
          lastFailedWal: stat.last_failed_wal,
          isStalled: true,
          message: `WAL Archiving stalled: no WAL segments archived in ${Math.round(elapsedMs / 60000)} minutes`,
        };
      }
    }

    return {
      status: 'HEALTHY',
      archivedCount,
      failedCount,
      lastArchivedWal: stat.last_archived_wal,
      lastFailedWal: stat.last_failed_wal,
      isStalled: false,
      message: `WAL Archiving is healthy (${archivedCount} segments archived)`,
    };
  }

  /**
   * Filter a list of WAL segments against a base backup boundary.
   * Returns { keep, prune } guaranteeing safety invariants.
   */
  filterWalRetention(walFiles: string[], oldestRequiredWal: string): { keep: string[]; prune: string[] } {
    const keep: string[] = [];
    const prune: string[] = [];

    for (const file of walFiles) {
      if (this.isWalRequiredByBaseBackup(file, oldestRequiredWal)) {
        keep.push(file);
      } else {
        prune.push(file);
      }
    }

    return { keep, prune };
  }
}
