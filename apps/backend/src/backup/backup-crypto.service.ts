import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * OpenSSL-interoperable AES-256-CBC encryption using PBKDF2 with SHA-256.
 * Format: 'Salted__' (8 bytes) + salt (8 bytes) + AES-256-CBC ciphertext.
 *
 * Compatible with standard OpenSSL CLI:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -in <artifact>.dump.enc -out <artifact>.dump -pass pass:<KEY>
 */
@Injectable()
export class BackupCryptoService {
  private readonly logger = new Logger(BackupCryptoService.name);
  private static readonly OPENSSL_MAGIC = Buffer.from('Salted__', 'utf8');
  private static readonly PBKDF2_ITERATIONS = 10000;
  private static readonly KEY_IV_LEN = 48; // 32 bytes key + 16 bytes IV

  encryptBuffer(plaintext: Buffer, passphrase: string): Buffer {
    if (!passphrase || passphrase.length < 16) {
      throw new Error('Encryption passphrase must be at least 16 characters long');
    }

    const salt = crypto.randomBytes(8);
    const keyAndIv = crypto.pbkdf2Sync(
      passphrase,
      salt,
      BackupCryptoService.PBKDF2_ITERATIONS,
      BackupCryptoService.KEY_IV_LEN,
      'sha256',
    );

    const key = keyAndIv.subarray(0, 32);
    const iv = keyAndIv.subarray(32, 48);

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return Buffer.concat([BackupCryptoService.OPENSSL_MAGIC, salt, encrypted]);
  }

  decryptBuffer(ciphertext: Buffer, passphrase: string): Buffer {
    if (ciphertext.length < 16) {
      throw new Error('Invalid ciphertext: buffer too short');
    }

    const magic = ciphertext.subarray(0, 8);
    if (!magic.equals(BackupCryptoService.OPENSSL_MAGIC)) {
      throw new Error('Invalid ciphertext: missing Salted__ header');
    }

    const salt = ciphertext.subarray(8, 16);
    const encryptedData = ciphertext.subarray(16);

    const keyAndIv = crypto.pbkdf2Sync(
      passphrase,
      salt,
      BackupCryptoService.PBKDF2_ITERATIONS,
      BackupCryptoService.KEY_IV_LEN,
      'sha256',
    );

    const key = keyAndIv.subarray(0, 32);
    const iv = keyAndIv.subarray(32, 48);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  }

  async encryptFile(inputPath: string, outputPath: string, passphrase: string): Promise<{ sizeBytes: number }> {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Plaintext file not found for encryption: ${inputPath}`);
    }

    const inputData = await fs.promises.readFile(inputPath);
    const encryptedData = this.encryptBuffer(inputData, passphrase);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      await fs.promises.mkdir(outputDir, { recursive: true });
    }

    await fs.promises.writeFile(outputPath, encryptedData, { mode: 0o600 });
    return { sizeBytes: encryptedData.length };
  }

  async decryptFile(inputPath: string, outputPath: string, passphrase: string): Promise<{ sizeBytes: number }> {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Encrypted file not found for decryption: ${inputPath}`);
    }

    const inputData = await fs.promises.readFile(inputPath);
    const decryptedData = this.decryptBuffer(inputData, passphrase);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      await fs.promises.mkdir(outputDir, { recursive: true });
    }

    await fs.promises.writeFile(outputPath, decryptedData, { mode: 0o600 });
    return { sizeBytes: decryptedData.length };
  }
}
