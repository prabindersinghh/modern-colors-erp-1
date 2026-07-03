import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';

export const CLAUDE_API_KEY = 'CLAUDE_API_KEY';

export interface ApiKeyStatus {
  configured: boolean;
  masked: string | null;
  updatedAt: Date | null;
}

export interface KeyValidation {
  valid: boolean;
  reason?: 'invalid' | 'quota' | 'network' | 'unknown';
  message?: string;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lightweight live check that the key works (PRD §8.1): a 1-token Claude call.
   * Distinguishes invalid key (401/403) from quota/rate-limit so Settings can
   * surface a clear error.
   */
  async validateKey(apiKey: string): Promise<KeyValidation> {
    const client = new Anthropic({ apiKey });
    const model = this.config.get<string>('CLAUDE_MODEL') ?? 'claude-opus-4-8';
    try {
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { valid: true };
    } catch (err) {
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      ) {
        return { valid: false, reason: 'invalid', message: 'API key is invalid or lacks access.' };
      }
      if (err instanceof Anthropic.RateLimitError) {
        return {
          valid: false,
          reason: 'quota',
          message: 'API key is rate-limited or out of quota.',
        };
      }
      if (err instanceof Anthropic.APIConnectionError) {
        return { valid: false, reason: 'network', message: 'Could not reach the Claude API.' };
      }
      const message = err instanceof Anthropic.APIError ? err.message : 'Unknown error';
      return { valid: false, reason: 'unknown', message };
    }
  }

  /** Save (validate → encrypt → store masked). Never returns the full key (I2). */
  async setApiKey(apiKey: string, actorId?: string): Promise<ApiKeyStatus> {
    const validation = await this.validateKey(apiKey);
    if (!validation.valid) {
      throw new BadRequestException({
        message: validation.message ?? 'API key validation failed',
        code: `CLAUDE_KEY_${(validation.reason ?? 'unknown').toUpperCase()}`,
      });
    }

    const enc = this.crypto.encrypt(apiKey);
    const masked = this.crypto.mask(apiKey);

    await this.prisma.setting.upsert({
      where: { key: CLAUDE_API_KEY },
      create: {
        key: CLAUDE_API_KEY,
        valueEncrypted: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        valueMasked: masked,
        updatedById: actorId ?? null,
      },
      update: {
        valueEncrypted: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        valueMasked: masked,
        updatedById: actorId ?? null,
      },
    });

    await this.audit.log({
      entityType: 'Setting',
      entityId: CLAUDE_API_KEY,
      action: 'CLAUDE_API_KEY_SET',
      actorId,
      after: { masked }, // never log the plaintext key
    });

    return { configured: true, masked, updatedAt: new Date() };
  }

  async getStatus(): Promise<ApiKeyStatus> {
    const row = await this.prisma.setting.findUnique({ where: { key: CLAUDE_API_KEY } });
    if (!row) return { configured: false, masked: null, updatedAt: null };
    return { configured: true, masked: row.valueMasked, updatedAt: row.updatedAt };
  }

  async removeApiKey(actorId?: string): Promise<{ configured: false }> {
    await this.prisma.setting
      .delete({ where: { key: CLAUDE_API_KEY } })
      .catch(() => undefined); // idempotent
    await this.audit.log({
      entityType: 'Setting',
      entityId: CLAUDE_API_KEY,
      action: 'CLAUDE_API_KEY_REMOVED',
      actorId,
    });
    return { configured: false };
  }

  /**
   * INTERNAL ONLY — decrypts the stored key for server-side Claude calls
   * (AI extraction). Never exposed via any controller (I2).
   * Returns null when no key is stored OR the ciphertext cannot be decrypted
   * (e.g. ENCRYPTION_KEY changed since the key was saved) — callers then surface
   * "No Claude API key configured" so the admin simply re-enters it in Settings.
   */
  async getDecryptedKey(): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: CLAUDE_API_KEY } });
    if (!row) return null;
    try {
      return this.crypto.decrypt({
        ciphertext: row.valueEncrypted,
        iv: row.iv,
        authTag: row.authTag,
      });
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        'Stored Claude API key could not be decrypted (ENCRYPTION_KEY changed?). ' +
          'Treating as not configured — re-enter the key in Settings.',
      );
      return null;
    }
  }
}
