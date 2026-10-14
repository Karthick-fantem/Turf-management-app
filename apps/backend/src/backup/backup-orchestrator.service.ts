import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  BACKUP_CONSTANTS,
  BackupConfig,
  BackupExecutionStatus,
  BackupStage,
} from './backup.constants';
import { BackupCryptoService } from './backup-crypto.service';
import { BackupRetentionService } from './backup-retention.service';
import { BackupS3Service } from './backup-s3.service';
import { BackupAlertService } from './backup-alert.service';

@Injectable()
export class BackupOrchestratorService {
  private readonly logger = new Logger(BackupOrchestratorService.name);

  constructor(
    private readonly cryptoService: BackupCryptoService,
    private readonly retentionService: BackupRetentionService,
    private readonly s3Service: BackupS3Service,
    private readonly alertService: BackupAlertService,
  ) {}

  /**
   * Execute full end-to-end backup pipeline:
   *   1. Lock acquisition
   *   2. pg_dump in custom format (-Fc -Z6)
   *   3. pg_restore -l archive verification
   *   4. OpenSSL-compatible AES-256 encryption
   *   5. Plaintext cleanup
   *   6. S3/R2 Offsite upload (or local fallback if credentials pending)
   *   7. GFS Retention pruning
   *   8. Status recording (/backups/latest-status.json)
   *   9. Alerting & lock release
   */
  async runBackup(config: BackupConfig): Promise<BackupExecutionStatus> {
    const startTime = Date.now();
    let currentStage: BackupStage = 'PREFLIGHT';
    let lockAcquired = false;
    let dumpPath: string | null = null;
    let encPath: string | null = null;
    let artifactId: string | null = null;
    let sizeBytes = 0;
    let offsiteUploaded = false;
    let retentionSummary: { keptCount: number; prunedCount: number } | undefined;

    const lockFilePath = path.join(config.workDir, BACKUP_CONSTANTS.LOCK_FILE);
    const statusFilePath = path.join(config.statusDir, BACKUP_CONSTANTS.STATUS_FILE);

    try {
      // ── Stage 1: PREFLIGHT ─────────────────────────────────────────────────
      currentStage = 'PREFLIGHT';
      await fs.promises.mkdir(config.workDir, { recursive: true });
      await fs.promises.mkdir(config.statusDir, { recursive: true });

      if (!config.encryptionKey || config.encryptionKey.trim().length < 16) {
        throw new Error('BACKUP_ENCRYPTION_KEY must be configured and at least 16 characters long');
      }

      // ── Stage 2: LOCK ──────────────────────────────────────────────────────
      currentStage = 'LOCK';
      if (fs.existsSync(lockFilePath)) {
        const existingPid = await fs.promises.readFile(lockFilePath, 'utf8').catch(() => 'unknown');
        throw new Error(`Backup lock already held by PID or previous job: ${existingPid.trim()}`);
      }
      await fs.promises.writeFile(lockFilePath, String(process.pid), { flag: 'wx' });
      lockAcquired = true;

      // Generate timestamped artifact ID
      const now = new Date();
      const datePart = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15); // YYYYMMDD_HHMMSS
      const baseFilename = `turff_db_${datePart}_utc`;
      dumpPath = path.join(config.workDir, `${baseFilename}.dump`);
      encPath = path.join(config.workDir, `${baseFilename}.dump.enc`);
      artifactId = `${baseFilename}.dump.enc`;

      // ── Stage 3: DUMP ──────────────────────────────────────────────────────
      currentStage = 'DUMP';
      this.logger.log(`[DUMP] Starting pg_dump for database ${config.database}...`);
      await this.executePgDump(config, dumpPath);

      if (!fs.existsSync(dumpPath) || (await fs.promises.stat(dumpPath)).size === 0) {
        throw new Error(`pg_dump produced missing or 0-byte archive file at ${dumpPath}`);
      }

      // ── Stage 4: VERIFY ────────────────────────────────────────────────────
      currentStage = 'VERIFY';
      this.logger.log(`[VERIFY] Validating archive table-of-contents via pg_restore...`);
      await this.verifyArchive(dumpPath);

      // ── Stage 5: ENCRYPT ───────────────────────────────────────────────────
      currentStage = 'ENCRYPT';
      this.logger.log(`[ENCRYPT] Encrypting archive with AES-256...`);
      const encResult = await this.cryptoService.encryptFile(dumpPath, encPath, config.encryptionKey);
      sizeBytes = encResult.sizeBytes;

      // Immediately shred/unlink unencrypted dump file
      await this.safeUnlink(dumpPath);
      dumpPath = null;

      // ── Stage 6: UPLOAD ────────────────────────────────────────────────────
      currentStage = 'UPLOAD';
      if (config.s3 && config.s3.bucket && config.s3.accessKeyId && config.s3.secretAccessKey) {
        this.logger.log(`[UPLOAD] Uploading encrypted archive to offsite S3/R2 (${config.s3.bucket})...`);
        const encBuffer = await fs.promises.readFile(encPath);
        const s3Key = `${config.s3.prefix}${artifactId}`;
        await this.s3Service.uploadObject({
          bucket: config.s3.bucket,
          region: config.s3.region,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
          endpoint: config.s3.endpoint,
          key: s3Key,
          body: encBuffer,
        });
        offsiteUploaded = true;
      } else {
        this.logger.warn(`[UPLOAD] S3 credentials not provisioned. Storing encrypted artifact locally at ${encPath}`);
        offsiteUploaded = false;
      }

      // ── Stage 7: RETENTION ─────────────────────────────────────────────────
      currentStage = 'RETENTION';
      if (offsiteUploaded && config.s3) {
        this.logger.log(`[RETENTION] Evaluating offsite S3 retention policy...`);
        const remoteKeys = await this.s3Service.listObjects({
          bucket: config.s3.bucket,
          region: config.s3.region,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
          endpoint: config.s3.endpoint,
          prefix: config.s3.prefix,
        });

        const decision = this.retentionService.evaluateRetention(remoteKeys, {
          prefix: config.s3.prefix,
          days: config.retention.days,
          weeks: config.retention.weeks,
          months: config.retention.months,
        });

        for (const pruneKey of decision.prune) {
          this.logger.log(`[RETENTION] Pruning expired remote backup: ${pruneKey}`);
          await this.s3Service.deleteObject({
            bucket: config.s3.bucket,
            region: config.s3.region,
            accessKeyId: config.s3.accessKeyId,
            secretAccessKey: config.s3.secretAccessKey,
            endpoint: config.s3.endpoint,
            key: pruneKey,
          });
        }

        retentionSummary = {
          keptCount: decision.stats.totalKept,
          prunedCount: decision.stats.totalPruned,
        };
      } else {
        // Local retention
        const localFiles = await fs.promises.readdir(config.workDir).catch(() => []);
        const decision = this.retentionService.evaluateRetention(localFiles, {
          prefix: '',
          days: config.retention.days,
          weeks: config.retention.weeks,
          months: config.retention.months,
        });

        for (const pruneFile of decision.prune) {
          await this.safeUnlink(path.join(config.workDir, pruneFile));
        }

        retentionSummary = {
          keptCount: decision.stats.totalKept,
          prunedCount: decision.stats.totalPruned,
        };
      }

      // ── Stage 8: STATUS_RECORD ─────────────────────────────────────────────
      currentStage = 'STATUS_RECORD';
      const durationMs = Date.now() - startTime;
      const successStatus: BackupExecutionStatus = {
        timestamp: now.toISOString(),
        status: 'SUCCESS',
        stage: 'STATUS_RECORD',
        artifactId: artifactId ?? undefined,
        sizeBytes,
        durationMs,
        offsiteUploaded,
        retentionSummary,
      };

      await fs.promises.writeFile(statusFilePath, JSON.stringify(successStatus, null, 2));

      // ── Stage 9: ALERT ─────────────────────────────────────────────────────
      currentStage = 'ALERT';
      await this.alertService.sendStatusAlert(successStatus, config.telegram);

      return successStatus;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = this.alertService.sanitize(err.message || 'Unknown backup error');

      this.logger.error(`[BACKUP FAILED] Stage: ${currentStage} - Error: ${errorMsg}`);

      const failureStatus: BackupExecutionStatus = {
        timestamp: new Date().toISOString(),
        status: 'FAILED',
        stage: currentStage,
        artifactId: artifactId ?? undefined,
        sizeBytes,
        durationMs,
        offsiteUploaded,
        error: errorMsg,
      };

      try {
        await fs.promises.writeFile(statusFilePath, JSON.stringify(failureStatus, null, 2));
      } catch {
        // ignore status file write error during failure
      }

      try {
        await this.alertService.sendStatusAlert(failureStatus, config.telegram);
      } catch {
        // ignore alert error during failure
      }

      throw new Error(`Backup failed at stage ${currentStage}: ${errorMsg}`);
    } finally {
      // Cleanup plaintext dump if still exists
      if (dumpPath) {
        await this.safeUnlink(dumpPath);
      }
      // Release lock
      if (lockAcquired) {
        await this.safeUnlink(lockFilePath);
      }
    }
  }

  private executePgDump(config: BackupConfig, targetFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PGPASSWORD: config.password ?? '',
      };

      const args = [
        '-h',
        config.host,
        '-p',
        String(config.port),
        '-U',
        config.user,
        '-d',
        config.database,
        '-Fc', // custom compressed archive format
        '-Z6', // compression level 6
        '-f',
        targetFile,
      ];

      const child = spawn('pg_dump', args, { env });
      let stderr = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn pg_dump binary: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump exited with code ${code}: ${this.alertService.sanitize(stderr)}`));
        }
      });
    });
  }

  private verifyArchive(dumpFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['-l', dumpFile];
      const child = spawn('pg_restore', args);
      let stderr = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn pg_restore binary for verification: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_restore archive TOC check failed with code ${code}: ${this.alertService.sanitize(stderr)}`));
        }
      });
    });
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (e: any) {
      this.logger.warn(`Could not delete temporary file ${filePath}: ${e.message}`);
    }
  }
}
