import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaterialStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Receiving (Step 6 of the workflow): scan a unit on arrival.
 *
 * WEIGHING WAS REMOVED HERE. A truckload can be ~2,500 sacks; stopping to type a
 * weight per sack made receiving take days. A unit's opening stock balance now comes
 * from the PO's per-package weight, applied at registration
 * (see MaterialService.registerUnits), so scanning is the only action on the floor:
 * scan → the unit is received and ready.
 *
 * `weigh()` is retained below for corrections only — it is no longer part of the
 * receiving flow, and it now keeps balanceKg in step with receivedWeight (it
 * previously did not, which stranded any unit weighed after the Phase 2 migration).
 *
 * Both operations stay idempotent so the frontend's offline queue can safely re-send
 * on reconnect without losing or duplicating data (invariant I9).
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Scan on receiving → READY_FOR_PRODUCTION in one step.
   *
   * There is no weigh step any more, so SCANNED would be a state nothing ever leaves.
   * The unit goes straight to ready and its balance is already set from the PO weight.
   * Re-scanning is an idempotent no-op (offline re-send / double trigger from a
   * hardware scanner).
   *
   * `needsWeight` is returned so the operator sees immediately that this particular
   * sack has no usable PO weight and will be blocked from issue until it is fixed —
   * visible at the moment of scanning, not discovered later at the issue desk.
   */
  async scan(uniqueId: string, actorId: string, device?: string) {
    const m = await this.prisma.material.findUnique({ where: { uniqueId } });
    if (!m) throw new NotFoundException(`No unit with ID ${uniqueId}`);

    const needsWeight = m.balanceKg == null;

    const scannable =
      m.status === MaterialStatus.REGISTERED ||
      m.status === MaterialStatus.ARRIVED ||
      // A unit left in SCANNED by the old two-step flow is completed by this scan.
      m.status === MaterialStatus.SCANNED;
    if (!scannable) {
      // Already received — idempotent success.
      return { material: m, changed: false, alreadyScanned: true, needsWeight };
    }

    const now = new Date();
    const material = await this.prisma.material.update({
      where: { id: m.id },
      data: {
        status: MaterialStatus.READY_FOR_PRODUCTION,
        scannedAt: m.scannedAt ?? now,
        arrivedAt: m.arrivedAt ?? now,
      },
    });
    await this.audit.log({
      entityType: 'Material',
      entityId: m.id,
      action: 'RECEIVED',
      actorId,
      device,
      before: { status: m.status },
      after: {
        status: MaterialStatus.READY_FOR_PRODUCTION,
        // Recorded so the trail shows where this unit's stock came from.
        balanceKg: material.balanceKg,
        balanceSource: material.balanceKg != null ? 'PO_WEIGHT' : null,
      },
    });
    return { material, changed: true, alreadyScanned: false, needsWeight };
  }

  /**
   * The most recently received units, newest first.
   *
   * Used to seed the receiving screen's running log, so an operator opening it mid-shift
   * (or after a reload) sees recent context instead of an empty list — the in-page log
   * otherwise only holds what THIS browser session scanned. Read-only; only units that
   * have actually been scanned in appear.
   */
  async recent(take = 12) {
    const n = Math.min(50, Math.max(1, Math.floor(take)));
    const rows = await this.prisma.material.findMany({
      where: { scannedAt: { not: null } },
      orderBy: { scannedAt: 'desc' },
      take: n,
      select: { uniqueId: true, materialName: true, balanceKg: true, stockUnit: true, scannedAt: true },
    });
    return rows.map((m) => ({
      uniqueId: m.uniqueId,
      materialName: m.materialName,
      balanceKg: m.balanceKg,
      stockUnit: m.stockUnit,
      needsWeight: m.balanceKg == null,
      scannedAt: m.scannedAt,
    }));
  }

  /**
   * Set/correct a unit's received weight.
   *
   * NO LONGER PART OF THE RECEIVING FLOW — receiving is scan-only. This remains as the
   * correction path for a unit whose PO weight was missing or wrong (e.g. a bulk
   * invoice like "2,300 KG" with no pack size).
   *
   * BUG FIX: this used to set `receivedWeight` but NOT `balanceKg`. Every live balance
   * came from a one-time backfill in the Phase 2 migration, so any unit weighed after
   * that migration got a weight but no stock balance and was silently blocked from
   * issue. The two are now written together.
   *
   * Balance is only RESET to the new weight when the unit has not moved yet. Once stock
   * has been issued against it, overwriting the balance would silently erase that
   * consumption, so the correction adjusts by the delta instead and never goes negative.
   * A weight on an already-weighed unit is an audited CORRECTION, never a silent
   * overwrite (invariant I4).
   */
  async weigh(uniqueId: string, weight: number, actorId: string, device?: string) {
    if (!(weight > 0)) throw new BadRequestException('Weight must be greater than 0.');
    const m = await this.prisma.material.findUnique({ where: { uniqueId } });
    if (!m) throw new NotFoundException(`No unit with ID ${uniqueId}`);

    const isCorrection =
      m.status === MaterialStatus.WEIGHED ||
      m.status === MaterialStatus.READY_FOR_PRODUCTION;

    // Idempotent: identical weight re-sent (offline retry) — no new correction.
    if (isCorrection && m.receivedWeight === weight) {
      return { material: m, changed: false, corrected: false };
    }

    // Has any stock already moved on this unit? If so we must not clobber the balance.
    const movements = await this.prisma.stockTransaction.count({
      where: { materialId: m.id },
    });
    const previous = m.receivedWeight ?? m.balanceKg ?? null;
    let nextBalance: number;
    if (movements === 0 || m.balanceKg == null) {
      // Untouched unit (or one that never had a balance) — the new weight IS the balance.
      nextBalance = weight;
    } else {
      // Already consumed against: shift the balance by how much the weight changed, so
      // the correction does not erase recorded consumption.
      const delta = weight - (previous ?? weight);
      nextBalance = Math.max(0, Number((m.balanceKg + delta).toFixed(6)));
    }

    const material = await this.prisma.material.update({
      where: { id: m.id },
      data: {
        receivedWeight: weight,
        balanceKg: nextBalance,
        weighedById: actorId,
        weighedAt: new Date(),
        status: MaterialStatus.READY_FOR_PRODUCTION,
      },
    });
    await this.audit.log({
      entityType: 'Material',
      entityId: m.id,
      action: isCorrection ? 'WEIGHT_CORRECTED' : 'WEIGHT_ENTERED',
      actorId,
      device,
      before: isCorrection
        ? { receivedWeight: m.receivedWeight, balanceKg: m.balanceKg }
        : { status: m.status, balanceKg: m.balanceKg },
      after: {
        receivedWeight: weight,
        balanceKg: nextBalance,
        status: MaterialStatus.READY_FOR_PRODUCTION,
      },
    });
    return { material, changed: true, corrected: isCorrection };
  }
}
