import { Injectable, Logger } from '@nestjs/common';
import { BackupExecutionStatus } from './backup.constants';

@Injectable()
export class BackupAlertService {
  private readonly logger = new Logger(BackupAlertService.name);

  async sendStatusAlert(
    status: BackupExecutionStatus,
    telegramConfig?: { botToken?: string; chatId?: string },
  ): Promise<{ sent: boolean; error?: string }> {
    const isSuccess = status.status === 'SUCCESS';
    const icon = isSuccess ? '✅' : '🚨';
    const title = isSuccess
      ? `PostgreSQL Backup Successful (${status.artifactId ?? 'snapshot'})`
      : `PostgreSQL Backup FAILED at Stage: ${status.stage}`;

    const sanitizedError = status.error ? this.sanitize(status.error) : 'None';
    const sizeMb = status.sizeBytes ? (status.sizeBytes / (1024 * 1024)).toFixed(2) : '0';

    const message = [
      `${icon} *TURFF OPS: ${title}*`,
      '',
      `• *Status:* ${status.status}`,
      `• *Stage:* ${status.stage}`,
      `• *Artifact:* \`${status.artifactId ?? 'N/A'}\``,
      `• *Size:* ${sizeMb} MB`,
      `• *Duration:* ${(status.durationMs / 1000).toFixed(1)}s`,
      `• *Offsite Stored:* ${status.offsiteUploaded ? 'Yes (S3/R2)' : 'No (Local/Pending)'}`,
      status.retentionSummary
        ? `• *Retention:* Kept ${status.retentionSummary.keptCount}, Pruned ${status.retentionSummary.prunedCount}`
        : '',
      !isSuccess ? `• *Error:* \`${sanitizedError}\`` : '',
      `• *Timestamp:* ${status.timestamp}`,
    ]
      .filter(Boolean)
      .join('\n');

    const botToken = telegramConfig?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = telegramConfig?.chatId || process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      this.logger.log(`[Backup Alert Simulation - No Telegram Config] ${title}`);
      return { sent: false, error: 'Telegram credentials not configured' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Failed to dispatch Telegram backup alert: ${this.sanitize(errorText)}`);
        return { sent: false, error: errorText };
      }

      return { sent: true };
    } catch (err: any) {
      this.logger.error(`Error sending Telegram backup alert: ${this.sanitize(err.message)}`);
      return { sent: false, error: err.message };
    }
  }

  sanitize(text: string): string {
    return text
      .replace(/postgres(?:ql)?:\/\/[^@]+@/gi, 'postgresql://[REDACTED_USER_PASS]@')
      .replace(/password=['"][^'"]*['"]/gi, 'password="[REDACTED]"')
      .replace(/key=['"][^'"]*['"]/gi, 'key="[REDACTED]"')
      .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED_SECRET]')
      .replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[REDACTED_TOKEN]');
  }
}
