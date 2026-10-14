import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';

export interface S3UploadOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface S3ListOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  prefix?: string;
}

export interface S3DeleteOptions {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  key: string;
}

@Injectable()
export class BackupS3Service {
  private readonly logger = new Logger(BackupS3Service.name);

  /**
   * Upload an object to S3 / Cloudflare R2 using AWS Signature V4.
   */
  async uploadObject(options: S3UploadOptions): Promise<{ key: string; sizeBytes: number }> {
    this.validateCredentials(options);

    const { host, baseUrl } = this.resolveHostAndUrl(options.bucket, options.region, options.endpoint);
    const path = `/${options.key}`;
    const url = `${baseUrl}${path}`;
    const contentType = options.contentType ?? 'application/octet-stream';
    const payloadHash = crypto.createHash('sha256').update(options.body).digest('hex');

    const headers: Record<string, string> = {
      host,
      'content-type': contentType,
      'content-length': options.body.length.toString(),
      'x-amz-content-sha256': payloadHash,
    };

    const signedHeaders = this.signRequest('PUT', path, '', headers, payloadHash, options);

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: signedHeaders,
        body: new Uint8Array(options.body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`S3 PUT failed with status ${response.status}: ${this.sanitizeMessage(errorText)}`);
      }

      return { key: options.key, sizeBytes: options.body.length };
    } catch (err: any) {
      throw new Error(`S3 upload error: ${this.sanitizeMessage(err.message)}`);
    }
  }

  /**
   * List object keys matching a prefix.
   */
  async listObjects(options: S3ListOptions): Promise<string[]> {
    this.validateCredentials(options);

    const { host, baseUrl } = this.resolveHostAndUrl(options.bucket, options.region, options.endpoint);
    const query = options.prefix ? `list-type=2&prefix=${encodeURIComponent(options.prefix)}` : 'list-type=2';
    const path = '/';
    const url = `${baseUrl}${path}?${query}`;
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
    };

    const signedHeaders = this.signRequest('GET', path, query, headers, payloadHash, options);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: signedHeaders,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`S3 LIST failed with status ${response.status}: ${this.sanitizeMessage(errorText)}`);
      }

      const xml = await response.text();
      return this.parseListObjectsXml(xml);
    } catch (err: any) {
      throw new Error(`S3 list error: ${this.sanitizeMessage(err.message)}`);
    }
  }

  /**
   * Delete an object by key.
   */
  async deleteObject(options: S3DeleteOptions): Promise<void> {
    this.validateCredentials(options);

    const { host, baseUrl } = this.resolveHostAndUrl(options.bucket, options.region, options.endpoint);
    const path = `/${options.key}`;
    const url = `${baseUrl}${path}`;
    const payloadHash = crypto.createHash('sha256').update('').digest('hex');

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
    };

    const signedHeaders = this.signRequest('DELETE', path, '', headers, payloadHash, options);

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: signedHeaders,
      });

      if (!response.ok && response.status !== 204 && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`S3 DELETE failed with status ${response.status}: ${this.sanitizeMessage(errorText)}`);
      }
    } catch (err: any) {
      throw new Error(`S3 delete error: ${this.sanitizeMessage(err.message)}`);
    }
  }

  // ── AWS SigV4 Signing Core ──────────────────────────────────────────────────

  private signRequest(
    method: string,
    canonicalUri: string,
    canonicalQuery: string,
    headers: Record<string, string>,
    payloadHash: string,
    creds: { accessKeyId: string; secretAccessKey: string; region: string },
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const service = 's3';

    headers['x-amz-date'] = amzDate;

    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v.trim();
    }

    const sortedHeaderKeys = Object.keys(lowerHeaders).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${lowerHeaders[k]}\n`).join('');
    const signedHeadersStr = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeadersStr,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = this.getSignatureKey(creds.secretAccessKey, dateStamp, creds.region, service);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    return {
      ...headers,
      Authorization: authorizationHeader,
    };
  }

  private getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }

  private resolveHostAndUrl(
    bucket: string,
    region: string,
    endpoint?: string,
  ): { host: string; baseUrl: string } {
    if (endpoint) {
      const u = new URL(endpoint);
      // For custom endpoints like R2 or MinIO
      if (u.hostname.includes('r2.cloudflarestorage.com')) {
        const host = `${bucket}.${u.host}`;
        return { host, baseUrl: `https://${host}` };
      }
      return { host: u.host, baseUrl: `${endpoint}/${bucket}` };
    }

    const host = `${bucket}.s3.${region}.amazonaws.com`;
    return { host, baseUrl: `https://${host}` };
  }

  private parseListObjectsXml(xml: string): string[] {
    const keys: string[] = [];
    const regex = /<Key>([^<]+)<\/Key>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      keys.push(match[1]);
    }
    return keys;
  }

  private validateCredentials(creds: { bucket: string; accessKeyId: string; secretAccessKey: string }) {
    if (!creds.bucket || !creds.accessKeyId || !creds.secretAccessKey) {
      throw new Error('S3 credentials incomplete: bucket, accessKeyId, and secretAccessKey are required');
    }
  }

  private sanitizeMessage(msg: string): string {
    return msg
      .replace(/[A-Za-z0-9+/=]{40,}/g, '[REDACTED_SECRET]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_ACCESS_KEY]');
  }
}
