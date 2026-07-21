import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

/**
 * Handover readiness — READ-ONLY.
 *
 * The flush itself deliberately stays a guarded script (prisma/flush.ts): its safety
 * comes from the friction of a shell, an env flag and a typed phrase. This panel only
 * answers "are we ready for that day?" — it can inspect everything and cause nothing.
 */
@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async readiness() {
    const [storage, logins, catalogue, flush] = await Promise.all([
      this.storageCheck(),
      this.passwordCheck(),
      this.catalogueCheck(),
      this.flushPreview(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      storage,
      logins,
      catalogue,
      flush,
      // One line the owner can read: what still stands between now and handover.
      blockers: [
        !storage.ok ? 'File storage is not healthy' : null,
        logins.usingDefaults > 0
          ? `${logins.usingDefaults} login(s) still use a default password`
          : null,
      ].filter((b): b is string => b !== null),
    };
  }

  /** Real write→read round-trip against the live bucket, no identifiers leaked. */
  private async storageCheck() {
    try {
      const res = await this.storage.healthCheck();
      return { ok: res.ok, driver: res.driver };
    } catch {
      return { ok: false, driver: 'unknown' as const };
    }
  }

  /**
   * Which logins still use a KNOWN seed password. Compares hashes against the seed
   * defaults (and their env overrides); no password is ever returned — only a boolean
   * per login. `ChangeMe123!` is published in the UAT doc, so shipping it live is the
   * single most likely handover-day mistake.
   */
  private async passwordCheck() {
    const candidates = [
      'ChangeMe123!',
      process.env.SEED_ADMIN_PASSWORD,
      process.env.SEED_PHASE2_PASSWORD,
      process.env.SEED_PHASE3_PASSWORD,
    ].filter((p): p is string => !!p);

    const users = await this.prisma.user.findMany({
      where: { active: true },
      select: { email: true, role: true, passwordHash: true },
      orderBy: { email: 'asc' },
    });

    const accounts = await Promise.all(
      users.map(async (u) => {
        let usingDefault = false;
        for (const c of candidates) {
          // eslint-disable-next-line no-await-in-loop
          if (await bcrypt.compare(c, u.passwordHash)) {
            usingDefault = true;
            break;
          }
        }
        return { email: u.email, role: u.role, usingDefaultPassword: usingDefault };
      }),
    );

    return {
      accounts,
      total: accounts.length,
      usingDefaults: accounts.filter((a) => a.usingDefaultPassword).length,
    };
  }

  /**
   * The catalogue DECISION cannot be detected — it is the owner's call whether the
   * current catalogue is demo data (flush with --flush-catalogue) or the real SKU list
   * (keep it). This reports the facts that inform that call.
   */
  private async catalogueCheck() {
    const [total, active, provisional, withThresholds] = await Promise.all([
      this.prisma.masterCatalogueItem.count(),
      this.prisma.masterCatalogueItem.count({ where: { active: true } }),
      this.prisma.masterCatalogueItem.count({ where: { sku: { startsWith: 'TMP-' } } }),
      this.prisma.masterCatalogueItem.count({
        where: { OR: [{ minLevel: { not: null } }, { maxLevel: { not: null } }] },
      }),
    ]);
    return { total, active, provisional, withThresholds };
  }

  /** What prisma/flush.ts would delete vs keep, as counts. Mirrors its DELETE_ORDER. */
  private async flushPreview() {
    const [
      finishedGoodQrs,
      finishedGoods,
      productionOutputs,
      stockTransactions,
      requestItems,
      requests,
      batches,
      qrCodes,
      materials,
      poLineItems,
      purchaseOrders,
      auditEntries,
      users,
      settings,
      catalogueItems,
    ] = await Promise.all([
      this.prisma.finishedGoodQr.count(),
      this.prisma.finishedGood.count(),
      this.prisma.productionOutput.count(),
      this.prisma.stockTransaction.count(),
      this.prisma.productionRequestItem.count(),
      this.prisma.productionRequest.count(),
      this.prisma.batch.count(),
      this.prisma.qrCode.count(),
      this.prisma.material.count(),
      this.prisma.pOLineItem.count(),
      this.prisma.purchaseOrder.count(),
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.setting.count(),
      this.prisma.masterCatalogueItem.count(),
    ]);
    return {
      wouldDelete: {
        finishedGoodQrs,
        finishedGoods,
        productionOutputs,
        stockTransactions,
        requestItems,
        requests,
        batches,
        qrCodes,
        materials,
        poLineItems,
        purchaseOrders,
        auditEntries,
      },
      wouldKeep: {
        users,
        settings,
        // Kept by default; deleted only with an explicit --flush-catalogue.
        catalogueItems,
      },
    };
  }
}
