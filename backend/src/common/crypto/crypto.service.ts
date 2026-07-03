import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

/**
 * AES-256-GCM encryption for secrets at rest (invariant I2 — the Claude API key).
 * Key comes from ENCRYPTION_KEY (64 hex chars / 32 bytes), validated at startup.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const hex = this.config.getOrThrow<string>('ENCRYPTION_KEY').trim();
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to 32 bytes (64 hex chars)');
    }
  }

  encrypt(plaintext: string): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /** Mask a secret for safe display: "sk-ant-a...x9f2" — never the full value (I2). */
  mask(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 12) return `${secret.slice(0, 2)}…${secret.slice(-2)}`;
    return `${secret.slice(0, 8)}…${secret.slice(-4)}`;
  }
}
