import { Injectable, Logger } from '@nestjs/common';
import { BACKUP_CONSTANTS } from './backup.constants';

export interface RetentionDecision {
  keep: string[];
  prune: string[];
  stats: {
    totalEvaluated: number;
    dailyKept: number;
    weeklyKept: number;
    monthlyKept: number;
    totalKept: number;
    totalPruned: number;
  };
}

export interface BackupItem {
  key: string;
  filename: string;
  date: Date;
  dateKey: string; // YYYY-MM-DD
  weekKey: string; // YYYY-Www
  monthKey: string; // YYYY-MM
}

@Injectable()
export class BackupRetentionService {
  private readonly logger = new Logger(BackupRetentionService.name);

  /**
   * Evaluates a list of artifact keys against Grandfather-Father-Son retention rules:
   *   - 7 Daily recovery points (newest snapshot per distinct day)
   *   - 4 Weekly recovery points (newest snapshot per distinct ISO week)
   *   - 3 Monthly recovery points (newest snapshot per distinct calendar month)
   *
   * Safety guarantees:
   *   1. The newest backup is ALWAYS kept.
   *   2. Objects that do not match the expected naming pattern are IGNORED (never pruned).
   *   3. Objects that do not start with the configured prefix are IGNORED.
   *   4. Idempotent evaluation.
   */
  evaluateRetention(
    keys: string[],
    options: {
      prefix?: string;
      days?: number;
      weeks?: number;
      months?: number;
    } = {},
  ): RetentionDecision {
    const prefix = options.prefix ?? BACKUP_CONSTANTS.DEFAULT_S3_PREFIX;
    const maxDays = options.days ?? BACKUP_CONSTANTS.DEFAULT_RETENTION_DAYS;
    const maxWeeks = options.weeks ?? BACKUP_CONSTANTS.DEFAULT_RETENTION_WEEKS;
    const maxMonths = options.months ?? BACKUP_CONSTANTS.DEFAULT_RETENTION_MONTHS;

    const parsedItems: BackupItem[] = [];

    for (const key of keys) {
      // Safety rule: ignore keys outside prefix
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }

      const filename = prefix ? key.substring(prefix.length) : key;
      const match = filename.match(BACKUP_CONSTANTS.BACKUP_FILE_REGEX);
      if (!match) {
        // Safety rule: never touch unrecognized files in bucket
        continue;
      }

      const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr] = match;
      const date = new Date(
        Date.UTC(
          parseInt(yearStr, 10),
          parseInt(monthStr, 10) - 1,
          parseInt(dayStr, 10),
          parseInt(hourStr, 10),
          parseInt(minStr, 10),
          parseInt(secStr, 10),
        ),
      );

      const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
      const weekKey = this.getIsoWeekKey(date);
      const monthKey = `${yearStr}-${monthStr}`;

      parsedItems.push({
        key,
        filename,
        date,
        dateKey,
        weekKey,
        monthKey,
      });
    }

    if (parsedItems.length === 0) {
      return {
        keep: [],
        prune: [],
        stats: {
          totalEvaluated: 0,
          dailyKept: 0,
          weeklyKept: 0,
          monthlyKept: 0,
          totalKept: 0,
          totalPruned: 0,
        },
      };
    }

    // Sort descending (newest first)
    parsedItems.sort((a, b) => b.date.getTime() - a.date.getTime());

    const keepSet = new Set<string>();

    // Always protect the absolute newest backup
    keepSet.add(parsedItems[0].key);

    // 1. Select Daily (latest snapshot per distinct day, up to maxDays)
    const dailyMap = new Map<string, BackupItem>();
    for (const item of parsedItems) {
      if (!dailyMap.has(item.dateKey) && dailyMap.size < maxDays) {
        dailyMap.set(item.dateKey, item);
        keepSet.add(item.key);
      }
    }

    // 2. Select Weekly (latest snapshot per distinct ISO week, up to maxWeeks)
    const weeklyMap = new Map<string, BackupItem>();
    for (const item of parsedItems) {
      if (!weeklyMap.has(item.weekKey) && weeklyMap.size < maxWeeks) {
        weeklyMap.set(item.weekKey, item);
        keepSet.add(item.key);
      }
    }

    // 3. Select Monthly (latest snapshot per distinct month, up to maxMonths)
    const monthlyMap = new Map<string, BackupItem>();
    for (const item of parsedItems) {
      if (!monthlyMap.has(item.monthKey) && monthlyMap.size < maxMonths) {
        monthlyMap.set(item.monthKey, item);
        keepSet.add(item.key);
      }
    }

    const keepList: string[] = [];
    const pruneList: string[] = [];

    for (const item of parsedItems) {
      if (keepSet.has(item.key)) {
        keepList.push(item.key);
      } else {
        pruneList.push(item.key);
      }
    }

    return {
      keep: keepList,
      prune: pruneList,
      stats: {
        totalEvaluated: parsedItems.length,
        dailyKept: dailyMap.size,
        weeklyKept: weeklyMap.size,
        monthlyKept: monthlyMap.size,
        totalKept: keepList.length,
        totalPruned: pruneList.length,
      },
    };
  }

  private getIsoWeekKey(date: Date): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}
