import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BackupCryptoService } from './backup-crypto.service';
import { BackupAlertService } from './backup-alert.service';

export interface RestoreOptions {
  backupFilePath: string;
  targetDatabase: string;
  confirmed: boolean;
  encryptionKey: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  prodDatabaseName?: string;
  workDir?: string;
}

export interface RestoreResult {
  status: 'SUCCESS' | 'FAILED';
  sourceArtifact: string;
  targetDatabase: string;
  durationMs: number;
  tocEntries?: number;
  error?: string;
}

@Injectable()
export class BackupRestoreService {
  private readonly logger = new Logger(BackupRestoreService.name);
  private static readonly FORBIDDEN_DATABASES = [
    'turff_db',
    'turff_prod',
    'turff_production',
    'postgres',
    'template0',
    'template1',
  ];

  constructor(
    private readonly cryptoService: BackupCryptoService,
    private readonly alertService: BackupAlertService,
  ) {}

  /**
   * Validate that destination database is NOT a production database.
   * Throws critical security error if target is forbidden.
   */
  validateTargetDatabase(targetDb: string, prodDbName: string = 'turff_db'): void {
    if (!targetDb || targetDb.trim() === '') {
      throw new Error('Target database name must be provided');
    }

    const normalized = targetDb.trim().toLowerCase();
    const forbidden = [...BackupRestoreService.FORBIDDEN_DATABASES, prodDbName.toLowerCase()];

    if (forbidden.includes(normalized)) {
      throw new Error(
        `SAFETY INTERVENTION: Target database '${targetDb}' is a forbidden production name. Refusing execution.`,
      );
    }

    if (!/^[a-zA-Z0-9_]+$/.test(targetDb)) {
      throw new Error('Invalid target database name. Must contain only alphanumeric characters and underscores.');
    }
  }

  /**
   * Validate that explicit confirmation is granted.
   */
  validateConfirmation(confirmed: boolean | string): void {
    if (confirmed !== true && confirmed !== '--confirm' && confirmed !== 'true') {
      throw new Error('SAFETY INTERVENTION: Restore requires explicit confirmation. Refusing execution.');
    }
  }

  /**
   * Execute safe restore workflow into an isolated database.
   */
  async runRestore(options: RestoreOptions): Promise<RestoreResult> {
    const startTime = Date.now();
    let tempDir: string | null = null;
    let decryptedDumpPath: string | null = null;

    try {
      // 1. Safety validation gates
      this.validateTargetDatabase(options.targetDatabase, options.prodDatabaseName);
      this.validateConfirmation(options.confirmed);

      if (!options.encryptionKey || options.encryptionKey.trim().length < 16) {
        throw new Error('BACKUP_ENCRYPTION_KEY must be provided and at least 16 characters long');
      }

      if (!fs.existsSync(options.backupFilePath)) {
        throw new Error(`Backup file not found at path: ${options.backupFilePath}`);
      }

      const fileStats = await fs.promises.stat(options.backupFilePath);
      if (fileStats.size === 0) {
        throw new Error(`Backup file at ${options.backupFilePath} is empty (0 bytes)`);
      }

      // 2. Prepare temporary isolated workspace
      tempDir = path.join(
        options.workDir ?? path.dirname(options.backupFilePath),
        `.tmp_restore_${Date.now()}_${process.pid}`,
      );
      await fs.promises.mkdir(tempDir, { recursive: true });
      decryptedDumpPath = path.join(tempDir, 'decrypted_archive.dump');

      // 3. Decrypt
      this.logger.log(`Decrypting backup archive: ${path.basename(options.backupFilePath)}...`);
      await this.cryptoService.decryptFile(options.backupFilePath, decryptedDumpPath, options.encryptionKey);

      // 4. Validate Table of Contents
      this.logger.log('Validating archive table of contents via pg_restore -l...');
      const tocEntries = await this.verifyArchiveToc(decryptedDumpPath);

      // 5. Execute restore into target
      this.logger.log(`Restoring schema and data into isolated '${options.targetDatabase}'...`);
      await this.executePgRestore(decryptedDumpPath, options);

      const durationMs = Date.now() - startTime;
      return {
        status: 'SUCCESS',
        sourceArtifact: path.basename(options.backupFilePath),
        targetDatabase: options.targetDatabase,
        durationMs,
        tocEntries,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const sanitizedError = this.alertService.sanitize(err.message || 'Unknown restore error');
      this.logger.error(`[RESTORE FAILED] ${sanitizedError}`);

      return {
        status: 'FAILED',
        sourceArtifact: path.basename(options.backupFilePath),
        targetDatabase: options.targetDatabase,
        durationMs,
        error: sanitizedError,
      };
    } finally {
      // Cleanup plaintext dump and temporary workspace
      if (decryptedDumpPath && fs.existsSync(decryptedDumpPath)) {
        await fs.promises.unlink(decryptedDumpPath).catch(() => {});
      }
      if (tempDir && fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private verifyArchiveToc(dumpPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn('pg_restore', ['-l', dumpPath]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn pg_restore: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0) {
          const lines = stdout.split('\n').filter((l) => l.trim().length > 0 && !l.startsWith(';'));
          resolve(lines.length);
        } else {
          reject(new Error(`Archive TOC validation failed with code ${code}: ${this.alertService.sanitize(stderr)}`));
        }
      });
    });
  }

  private executePgRestore(dumpPath: string, options: RestoreOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PGPASSWORD: options.password ?? '',
      };

      const args = [
        '-h',
        options.host ?? 'localhost',
        '-p',
        String(options.port ?? 5432),
        '-U',
        options.user ?? 'postgres',
        '-d',
        options.targetDatabase,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        dumpPath,
      ];

      const child = spawn('pg_restore', args, { env });
      let stderr = '';

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn pg_restore: ${err.message}`));
      });

      child.on('close', (code) => {
        // Exit code 0 or 1 is normal for pg_restore with notices/clean
        if (code === 0 || code === 1) {
          resolve();
        } else {
          reject(new Error(`pg_restore failed with exit code ${code}: ${this.alertService.sanitize(stderr)}`));
        }
      });
    });
  }
}
