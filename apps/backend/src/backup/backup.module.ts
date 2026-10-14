import { Module } from '@nestjs/common';
import { BackupCryptoService } from './backup-crypto.service';
import { BackupRetentionService } from './backup-retention.service';
import { BackupS3Service } from './backup-s3.service';
import { BackupAlertService } from './backup-alert.service';
import { BackupOrchestratorService } from './backup-orchestrator.service';
import { BackupRestoreService } from './backup-restore.service';
import { WalArchiveService } from './wal-archive.service';

@Module({
  providers: [
    BackupCryptoService,
    BackupRetentionService,
    BackupS3Service,
    BackupAlertService,
    BackupOrchestratorService,
    BackupRestoreService,
    WalArchiveService,
  ],
  exports: [
    BackupCryptoService,
    BackupRetentionService,
    BackupS3Service,
    BackupAlertService,
    BackupOrchestratorService,
    BackupRestoreService,
    WalArchiveService,
  ],
})
export class BackupModule {}
