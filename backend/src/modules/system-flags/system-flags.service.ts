import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const STORE_INWARD_ACCESS = 'STORE_INWARD_ACCESS';
/**
 * Packing-stage cutover. OFF (default): dispatch ships FG drums directly, packing routes
 * exist but nothing forces them. ON: dispatch's home shows carton (PG) cards. Unlike the
 * inward flag this one defaults OFF — deploying it changes nothing until the owner flips
 * it. The safety guard (Gap A: a packed/under-packing unit never dispatches alone) is
 * enforced independently of this flag.
 */
export const PACKING_STAGE = 'PACKING_STAGE';
/** Absent row reads as ON, so deploying the flag changes nobody's access. */
export const FLAG_ON = 'on';
export const FLAG_OFF = 'off';
/** Short enough that a flip feels immediate; long enough that the guard is not a query. */
export const FLAG_TTL_MS = 10_000;

/**
 * Operational flags — today, exactly one: whether the Store desk still reaches the
 * inward flow.
 *
 * This is what makes the segregation-of-duties cutover reversible in seconds. An env
 * var would need a Railway redeploy, and with build times observed between 28 seconds
 * and 30 minutes, "instantly reversible" would have been a lie.
 *
 * Reads are cached for FLAG_TTL_MS and the cache is invalidated on write, so a flip by
 * the owner takes effect at once for him and within ten seconds everywhere else.
 */
@Injectable()
export class SystemFlagsService {
  private cache = new Map<string, { value: string; expires: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(key: string, fallback: string): Promise<string> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    // A database hiccup must never revoke access: fall back to the permissive default
    // rather than locking the factory out of receiving.
    const row = await this.prisma.systemFlag.findUnique({ where: { key } }).catch(() => null);
    const value = row?.value ?? fallback;
    this.cache.set(key, { value, expires: Date.now() + FLAG_TTL_MS });
    return value;
  }

  /** Set a flag. Both directions are audited — turning access back ON is history too. */
  async set(key: string, value: string, actorId: string) {
    const before = await this.prisma.systemFlag.findUnique({ where: { key } });
    const row = await this.prisma.systemFlag.upsert({
      where: { key },
      create: { key, value, updatedById: actorId },
      update: { value, updatedById: actorId },
    });
    this.cache.delete(key); // the person who flipped it sees it immediately
    await this.audit.log({
      entityType: 'SystemFlag',
      entityId: key,
      action: `${key}_CHANGED`,
      actorId,
      before: { value: before?.value ?? null },
      after: { value },
    });
    return row;
  }

  /** Test seam — the guard's cache must not leak between cases. */
  clearCache() {
    this.cache.clear();
  }
}
