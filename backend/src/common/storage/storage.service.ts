import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * File storage for PO documents and QR label PDFs.
 * Production = Cloudflare R2 (S3 API). When R2 credentials are absent, falls back
 * to local disk (backend/.storage/) so development is never blocked. The interface
 * is identical either way, so callers don't care which driver is active.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private driver: 'disk' | 'r2' = 'disk';
  private s3?: S3Client;
  private bucket?: string;
  private diskRoot!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.diskRoot = path.resolve(process.cwd(), '.storage');
    const wantR2 = this.config.get<string>('STORAGE_DRIVER') === 'r2';
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('R2_ENDPOINT');
    this.bucket = this.config.get<string>('R2_BUCKET');

    if (wantR2 && accessKeyId && secretAccessKey && endpoint && this.bucket) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.driver = 'r2';
      this.logger.log(`Storage driver: R2 (bucket=${this.bucket})`);
    } else {
      this.driver = 'disk';
      if (wantR2) {
        this.logger.warn(
          'STORAGE_DRIVER=r2 but R2 credentials are incomplete — falling back to local disk.',
        );
      }
      this.logger.log(`Storage driver: disk (${this.diskRoot})`);
    }
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<string> {
    if (this.driver === 'r2' && this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } else {
      const full = this.diskPath(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, body);
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (this.driver === 'r2' && this.s3) {
      const res = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    }
    return fs.readFile(this.diskPath(key));
  }

  // Confine disk keys to the storage root (defense against path traversal).
  private diskPath(key: string): string {
    const full = path.resolve(this.diskRoot, key);
    if (!full.startsWith(this.diskRoot + path.sep) && full !== this.diskRoot) {
      throw new Error('Invalid storage key');
    }
    return full;
  }
}
