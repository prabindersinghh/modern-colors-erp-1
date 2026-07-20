import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
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
  /** Why R2 was not used, when it was asked for. Surfaced by the health probe. */
  private misconfigured: string[] = [];
  private endpointHost?: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.diskRoot = path.resolve(process.cwd(), '.storage');
    const wantR2 = this.config.get<string>('STORAGE_DRIVER') === 'r2';
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('R2_ENDPOINT');
    this.bucket = this.config.get<string>('R2_BUCKET');

    // Record exactly which R2 settings are missing. A silent fallback to disk on a
    // container with an ephemeral filesystem loses uploaded invoices on the next
    // deploy, so this must be visible rather than a one-line warning nobody reads.
    if (wantR2) {
      if (!accessKeyId) this.misconfigured.push('R2_ACCESS_KEY_ID');
      if (!secretAccessKey) this.misconfigured.push('R2_SECRET_ACCESS_KEY');
      if (!endpoint) this.misconfigured.push('R2_ENDPOINT');
      if (!this.bucket) this.misconfigured.push('R2_BUCKET');
    }
    try {
      this.endpointHost = endpoint ? new URL(endpoint).host : undefined;
    } catch {
      this.misconfigured.push('R2_ENDPOINT (not a valid URL)');
    }

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
        this.logger.error(
          `STORAGE_DRIVER=r2 but these are missing: ${this.misconfigured.join(', ')}. ` +
            'Falling back to local disk — on a container host, uploaded files will be ' +
            'LOST on the next deploy. Set them in the host environment.',
        );
      }
      this.logger.log(`Storage driver: disk (${this.diskRoot})`);
    }
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<string> {
    try {
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
    } catch (err) {
      throw this.describe(err, 'save', key);
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      if (this.driver === 'r2' && this.s3) {
        const res = await this.s3.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        const bytes = await res.Body!.transformToByteArray();
        return Buffer.from(bytes);
      }
      return await fs.readFile(this.diskPath(key));
    } catch (err) {
      throw this.describe(err, 'read', key);
    }
  }

  /**
   * Turn a raw driver error into something the operator and the maintainer can both
   * act on.
   *
   * This previously bubbled up as a bare 500 "Internal server error", which told the
   * storekeeper nothing and cost real diagnosis time when uploads broke in production.
   * The full error is logged server-side; the client gets a specific, non-leaky
   * explanation and a 503 (the service is unavailable, the request was not malformed).
   */
  private describe(err: unknown, op: 'save' | 'read', key: string): Error {
    // The path-traversal guard is a security check, not a backend outage. Let it
    // through untouched: relabelling it as "storage unavailable" would hide the real
    // reason and wrongly imply the caller should retry.
    if (err instanceof Error && err.message === 'Invalid storage key') {
      this.logger.error(`Rejected unsafe storage key on ${op}: ${key}`);
      throw err;
    }

    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const code = e?.Code ?? e?.name ?? 'unknown';
    const status = e?.$metadata?.httpStatusCode;

    this.logger.error(
      `Storage ${op} FAILED [driver=${this.driver} bucket=${this.bucket ?? '-'} ` +
        `endpoint=${this.endpointHost ?? '-'} key=${key} code=${code}` +
        `${status ? ` httpStatus=${status}` : ''}]`,
      err instanceof Error ? err.stack : String(err),
    );

    if (this.driver === 'r2') {
      // Map the R2/S3 failures that actually happen in practice to a cause the
      // maintainer can fix, rather than a generic "something went wrong".
      const hint =
        code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || status === 401 || status === 403
          ? 'the R2 API token is wrong, expired or lacks Object Read & Write on this bucket'
          : code === 'NoSuchBucket' || status === 404
            ? `the R2 bucket "${this.bucket}" does not exist or the endpoint is wrong`
            : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
              ? `the R2 endpoint "${this.endpointHost ?? '?'}" could not be reached`
              : `R2 returned ${code}${status ? ` (HTTP ${status})` : ''}`;
      return new ServiceUnavailableException(
        `Could not ${op} the document — file storage is unavailable: ${hint}. ` +
          'The rest of the system is unaffected; you can still enter this invoice manually.',
      );
    }

    return new ServiceUnavailableException(
      `Could not ${op} the document — local file storage failed (${code}).`,
    );
  }

  /**
   * Round-trip probe: writes a tiny object, reads it back, compares.
   *
   * Cheap enough to expose on the health endpoint, and it is the only check that
   * proves credentials, bucket and permissions all actually work — which is exactly
   * what a "500 on upload" incident needs to answer in seconds rather than hours.
   */
  async healthCheck(): Promise<{
    driver: 'disk' | 'r2';
    ok: boolean;
    bucket?: string;
    endpoint?: string;
    misconfigured?: string[];
    error?: string;
    ms: number;
  }> {
    const started = Date.now();
    const base = {
      driver: this.driver,
      bucket: this.bucket,
      endpoint: this.endpointHost,
      ...(this.misconfigured.length ? { misconfigured: this.misconfigured } : {}),
    };
    const key = `_healthcheck/${Date.now()}.txt`;
    try {
      const payload = Buffer.from('ok');
      await this.put(key, payload, 'text/plain');
      const back = await this.get(key);
      const ok = back.toString() === 'ok';
      return { ...base, ok, ms: Date.now() - started };
    } catch (err) {
      return {
        ...base,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      };
    }
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
