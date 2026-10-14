export const BACKUP_CONSTANTS = {
  DEFAULT_SCHEDULE: '0 2 * * *', // 02:00 UTC daily
  DEFAULT_RETENTION_DAYS: 7,
  DEFAULT_RETENTION_WEEKS: 4,
  DEFAULT_RETENTION_MONTHS: 3,
  DEFAULT_S3_PREFIX: 'db/',
  DEFAULT_PORT: 5432,
  DEFAULT_TIMEOUT_MS: 300000, // 5 minutes
  STATUS_FILE: 'latest-status.json',
  LOCK_FILE: 'backup.lock',
  BACKUP_FILE_REGEX: /^turff_db_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_utc\.dump\.enc$/,
  PLAINTEXT_FILE_REGEX: /^turff_db_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_utc\.dump$/,
} as const;

export type BackupStage =
  | 'PREFLIGHT'
  | 'LOCK'
  | 'DUMP'
  | 'VERIFY'
  | 'ENCRYPT'
  | 'UPLOAD'
  | 'RETENTION'
  | 'STATUS_RECORD'
  | 'ALERT';

export interface BackupExecutionStatus {
  timestamp: string;
  status: 'SUCCESS' | 'FAILED';
  stage: BackupStage;
  artifactId?: string;
  sizeBytes?: number;
  durationMs: number;
  offsiteUploaded: boolean;
  retentionSummary?: {
    keptCount: number;
    prunedCount: number;
  };
  error?: string;
}

export interface BackupConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  encryptionKey?: string;
  workDir: string;
  statusDir: string;
  s3?: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    prefix: string;
  };
  retention: {
    days: number;
    weeks: number;
    months: number;
  };
  telegram?: {
    botToken: string;
    chatId: string;
  };
}
