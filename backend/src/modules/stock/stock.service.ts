import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Department, Prisma, RequestStatus, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateStockTransactionDto } from './dto/create-stock-transaction.dto';
import { AGEING, ageDays, ageingLevel as ageingLevelFor, fifoSort, olderUnitsThan } from './fifo.util';

const unitSelect = {
  id: true,
  uniqueId: true,
  materialName: true,
  sku: true,
  status: true,
  receivedWeight: true,
  balanceKg: true,
  stockUnit: true, // "kg" or "L" — the measure balanceKg is in (labels the movement UI)
  arrivedAt: true,
  po: { select: { poNumber: true, supplier: true } },
} satisfies Prisma.MaterialSelect;

/** Same material? Compare by SKU when both have one, else by normalized name. */
function sameMaterial(
  a: { sku: string | null; materialName: string },
  b: { sku: string | null; materialName: string },
): boolean {
  if (a.sku && b.sku) return a.sku.trim().toLowerCase() === b.sku.trim().toLowerCase();
  return a.materialName.trim().toLowerCase() === b.materialName.trim().toLowerCase();
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Look up a scanned unit for the movement panel. 409 if it has no confirmed weight. */
  async getUnit(uniqueId: string) {
    const unit = await this.prisma.material.findUnique({
      where: { uniqueId },
      select: unitSelect,
    });
    if (!unit) throw new NotFoundException(`No unit with ID ${uniqueId}`);
    if (unit.balanceKg == null) {
      throw new ConflictException(
        `Unit ${uniqueId} has no pack weight from its invoice, so its stock balance is unknown. Set the pack weight for this material on the purchase order, then it can be issued.`,
      );
    }
    const fifo = await this.fifoContextFor(unit);
    return { ...unit, fifo };
  }

  /**
   * FIFO context for a scanned unit: is it the oldest in-stock unit of its material, or
   * are there OLDER units still holding stock (which the Store should ideally use first)?
   * Never blocks — this is a soft advisory shown at scan time. `arrivedAt` is the basis,
   * uniqueId the same-day tiebreak.
   */
  private async fifoContextFor(unit: {
    uniqueId: string;
    materialName: string;
    sku: string | null;
    arrivedAt: Date | null;
    balanceKg: number | null;
  }) {
    const now = new Date();
    // All in-stock units that are the SAME material (sku-first, else name).
    const candidates = await this.prisma.material.findMany({
      where: {
        balanceKg: { gt: 0 },
        ...(unit.sku
          ? { sku: unit.sku }
          : { materialName: unit.materialName, sku: null }),
      },
      select: { uniqueId: true, arrivedAt: true, balanceKg: true },
    });
    const older = olderUnitsThan(unit, candidates).map((u) => ({
      uniqueId: u.uniqueId,
      arrivedAt: u.arrivedAt,
      balanceKg: u.balanceKg ?? 0,
      ageDays: ageDays(u.arrivedAt, now),
    }));
    return {
      isOldest: older.length === 0,
      ageDays: ageDays(unit.arrivedAt, now),
      olderUnits: older, // oldest-first; [0] is the FIFO-recommended alternative
      recommended: older[0] ?? null,
    };
  }

  /** The append-only movement history for one unit (newest first). */
  async unitTransactions(uniqueId: string) {
    const unit = await this.prisma.material.findUnique({
      where: { uniqueId },
      select: { id: true, uniqueId: true, materialName: true, sku: true, balanceKg: true },
    });
    if (!unit) throw new NotFoundException(`No unit with ID ${uniqueId}`);
    const transactions = await this.prisma.stockTransaction.findMany({
      where: { materialId: unit.id },
      include: {
        actor: { select: { id: true, name: true } },
        requestItem: { select: { id: true, requestId: true, materialName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { unit, transactions };
  }

  /**
   * Stock ageing view (Store / Admin) — every in-stock unit bucketed by how long it has
   * been held, oldest first. This is the plain "how old is my stock" answer, surfaced in
   * its own tab rather than only inside the FIFO advisory panels.
   * Buckets use the shared AGEING thresholds (amber ≥30d, red ≥60d).
   */
  async ageing(params: { q?: string } = {}) {
    const now = new Date();
    const units = await this.prisma.material.findMany({
      where: {
        balanceKg: { gt: 0 },
        ...(params.q
          ? {
              OR: [
                { materialName: { contains: params.q, mode: 'insensitive' } },
                { sku: { contains: params.q, mode: 'insensitive' } },
                { uniqueId: { contains: params.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        uniqueId: true,
        materialName: true,
        sku: true,
        balanceKg: true,
        stockUnit: true,
        arrivedAt: true,
        po: { select: { poNumber: true, supplier: true } },
      },
    });

    const rows = fifoSort(units).map((u) => {
      const days = ageDays(u.arrivedAt, now);
      return {
        uniqueId: u.uniqueId,
        materialName: u.materialName,
        sku: u.sku,
        balanceKg: u.balanceKg ?? 0,
        stockUnit: u.stockUnit,
        arrivedAt: u.arrivedAt,
        ageDays: days,
        level: ageingLevelFor(days),
        supplier: u.po?.supplier ?? null,
        poNumber: u.po?.poNumber ?? null,
      };
    });

    const sumKg = (f: (d: number) => boolean) =>
      Number(rows.filter((r) => f(r.ageDays)).reduce((s, r) => s + r.balanceKg, 0).toFixed(6));

    return {
      thresholds: { amberDays: AGEING.AMBER_DAYS, redDays: AGEING.RED_DAYS },
      units: rows, // oldest first
      buckets: {
        fresh: {
          label: `Under ${AGEING.AMBER_DAYS} days`,
          unitCount: rows.filter((r) => r.level === 'FRESH').length,
          totalKg: sumKg((d) => d < AGEING.AMBER_DAYS),
        },
        amber: {
          label: `${AGEING.AMBER_DAYS}–${AGEING.RED_DAYS - 1} days`,
          unitCount: rows.filter((r) => r.level === 'AMBER').length,
          totalKg: sumKg((d) => d >= AGEING.AMBER_DAYS && d < AGEING.RED_DAYS),
        },
        red: {
          label: `${AGEING.RED_DAYS}+ days`,
          unitCount: rows.filter((r) => r.level === 'RED').length,
          totalKg: sumKg((d) => d >= AGEING.RED_DAYS),
        },
      },
      oldestAgeDays: rows[0]?.ageDays ?? 0,
      totalUnits: rows.length,
    };
  }

  /**
   * Live stock levels (Store / Admin, factory-wide). Aggregates each weighed unit's
   * balanceKg by material (sku when present, else name) and lists the contributing
   * units. Reads Material.balanceKg directly — it's the running total the ledger keeps
   * consistent, so no re-summing of transactions is needed.
   */
  async levels(params: { q?: string }) {
    const where: Prisma.MaterialWhereInput = {
      balanceKg: { not: null }, // only weighed units participate in stock
      OR: params.q
        ? [
            { materialName: { contains: params.q, mode: 'insensitive' } },
            { sku: { contains: params.q, mode: 'insensitive' } },
            { uniqueId: { contains: params.q, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const units = await this.prisma.material.findMany({
      where,
      select: { uniqueId: true, materialName: true, sku: true, status: true, balanceKg: true, stockUnit: true, arrivedAt: true },
    });
    const now = new Date();

    // Group by sku (fallback to normalized name) so units of the same material roll up.
    type LevelUnit = {
      uniqueId: string;
      balanceKg: number;
      status: string;
      arrivedAt: Date | null;
      ageDays: number;
      ageingLevel: string;
    };
    const groups = new Map<
      string,
      {
        materialName: string;
        sku: string | null;
        stockUnit: string;
        totalBalanceKg: number;
        unitCount: number;
        units: LevelUnit[];
      }
    >();
    for (const u of units) {
      const key = (u.sku?.trim().toLowerCase() || u.materialName.trim().toLowerCase());
      const g =
        groups.get(key) ??
        // Missing stockUnit is treated as kg (the column default) — defensive, so a legacy
        // row can never create an "undefined" unit bucket.
        { materialName: u.materialName, sku: u.sku, stockUnit: u.stockUnit || 'kg', totalBalanceKg: 0, unitCount: 0, units: [] };
      g.totalBalanceKg = Number((g.totalBalanceKg + (u.balanceKg ?? 0)).toFixed(6));
      g.unitCount += 1;
      const days = ageDays(u.arrivedAt, now);
      g.units.push({
        uniqueId: u.uniqueId,
        balanceKg: u.balanceKg ?? 0,
        status: u.status,
        arrivedAt: u.arrivedAt,
        ageDays: days,
        ageingLevel: ageingLevelFor(days),
      });
      groups.set(key, g);
    }

    // Sort each material's units OLDEST-FIRST (FIFO order) so the pick order is obvious.
    for (const g of groups.values()) g.units = fifoSort(g.units);

    const materials = [...groups.values()].sort((a, b) =>
      a.materialName.localeCompare(b.materialName),
    );

    // Factory-wide totals are split BY UNIT — kilograms and litres are never added into
    // one number (the same rule the dispatch analytics enforce). Each entry is one
    // measure's total across all materials in it.
    const byUnit = new Map<string, { totalBalance: number; unitCount: number }>();
    for (const m of materials) {
      const t = byUnit.get(m.stockUnit) ?? { totalBalance: 0, unitCount: 0 };
      t.totalBalance = Number((t.totalBalance + m.totalBalanceKg).toFixed(6));
      t.unitCount += m.unitCount;
      byUnit.set(m.stockUnit, t);
    }
    const totalsByUnit = [...byUnit.entries()]
      .map(([unit, t]) => ({ unit, ...t }))
      .sort((a, b) => (a.unit === 'kg' ? -1 : b.unit === 'kg' ? 1 : a.unit.localeCompare(b.unit)));

    // grandTotalKg is retained for compatibility but is now the kilogram-only total, so
    // it can never silently include litres.
    const grandTotalKg = totalsByUnit.find((t) => t.unit === 'kg')?.totalBalance ?? 0;
    return { materials, totalsByUnit, grandTotalKg, unitCount: units.length };
  }

  /**
   * The append-only movement ledger (Store / Admin). Read-only + filterable — this is
   * the immutable audit trail of every Add/Deduct/Discard (I4 pattern). Never mutated;
   * corrections are new entries.
   */
  async ledger(params: {
    type?: StockTxnType;
    department?: Department;
    uniqueId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));

    const createdAt =
      params.startDate || params.endDate
        ? {
            gte: params.startDate ? new Date(params.startDate) : undefined,
            lte: params.endDate ? new Date(params.endDate) : undefined,
          }
        : undefined;

    const where: Prisma.StockTransactionWhereInput = {
      type: params.type,
      department: params.department,
      material: params.uniqueId ? { uniqueId: params.uniqueId } : undefined,
      createdAt,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.stockTransaction.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true } },
          material: { select: { uniqueId: true, materialName: true, sku: true, stockUnit: true } },
          requestItem: { select: { id: true, requestId: true, materialName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockTransaction.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Movement totals for the oversight dashboard (Step 8). Sums quantityKg by type
   * both all-time and for a recent window (default 30 days), and the DEDUCT/ADD split
   * per department. Read-only.
   */
  async movementTotals(sinceDays = 30) {
    const since = new Date();
    since.setDate(since.getDate() - sinceDays);

    const [allByType, recentByType, byDeptType] = await Promise.all([
      this.prisma.stockTransaction.groupBy({ by: ['type'], _sum: { quantityKg: true } }),
      this.prisma.stockTransaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: since } },
        _sum: { quantityKg: true },
      }),
      this.prisma.stockTransaction.groupBy({
        by: ['department', 'type'],
        where: { department: { not: null } },
        _sum: { quantityKg: true },
      }),
    ]);

    const emptyTotals = (): Record<StockTxnType, number> => ({ ADD: 0, DEDUCT: 0, DISCARD: 0 });
    const allTime = emptyTotals();
    for (const g of allByType) allTime[g.type] = Number((g._sum.quantityKg ?? 0).toFixed(6));
    const recent = emptyTotals();
    for (const g of recentByType) recent[g.type] = Number((g._sum.quantityKg ?? 0).toFixed(6));

    // Per-department ADD/DEDUCT rollup (DISCARD is dept-less, excluded here).
    const byDepartment: Record<string, { ADD: number; DEDUCT: number }> = {};
    for (const g of byDeptType) {
      if (!g.department) continue;
      const d = (byDepartment[g.department] ??= { ADD: 0, DEDUCT: 0 });
      if (g.type === StockTxnType.ADD) d.ADD = Number((g._sum.quantityKg ?? 0).toFixed(6));
      if (g.type === StockTxnType.DEDUCT) d.DEDUCT = Number((g._sum.quantityKg ?? 0).toFixed(6));
    }

    return { allTime, recent, sinceDays, byDepartment };
  }

  /** The most recent movements for the oversight activity feed. */
  async recentMovements(take = 8) {
    return this.prisma.stockTransaction.findMany({
      include: {
        actor: { select: { id: true, name: true } },
        material: { select: { uniqueId: true, materialName: true, sku: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Record ONE Add / Deduct / Discard on a scanned unit. The ledger row and the
   * unit's balanceKg are written in the SAME DB transaction so they never drift.
   * DEDUCT/DISCARD can never take the unit below zero (over-deduction blocked).
   */
  async createTransaction(user: AuthUser, dto: CreateStockTransactionDto) {
    if (!(dto.quantityKg > 0)) {
      throw new BadRequestException('Quantity (KG) must be greater than 0.');
    }

    const isDiscard = dto.type === StockTxnType.DISCARD;
    // ADD / DEDUCT go to/from a department; DISCARD is dept-less.
    const department = isDiscard ? null : dto.department ?? null;
    if (!isDiscard && !department) {
      throw new BadRequestException('Select a department for an Add or Deduct movement.');
    }
    if (dto.requestItemId && dto.type !== StockTxnType.DEDUCT) {
      throw new BadRequestException('A request line can only be linked to a Deduct.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the unit row so concurrent scans of the same unit can't both pass the
      // balance check and drive it negative.
      const locked = await tx.$queryRaw<
        {
          id: string;
          balanceKg: number | null;
          materialName: string;
          sku: string | null;
          arrivedAt: Date | null;
        }[]
      >`SELECT "id", "balanceKg", "materialName", "sku", "arrivedAt" FROM "Material" WHERE "uniqueId" = ${dto.uniqueId} FOR UPDATE`;
      const row = locked[0];
      if (!row) throw new NotFoundException(`No unit with ID ${dto.uniqueId}`);
      if (row.balanceKg == null) {
        throw new ConflictException(
          `Unit ${dto.uniqueId} has no pack weight from its invoice, so its stock balance is unknown. Set the pack weight for this material on the purchase order, then it can be issued.`,
        );
      }

      const before = row.balanceKg;
      let requestItem: {
        id: string;
        requestId: string;
        status: RequestStatus;
        approvedKg: number | null;
        issuedKg: number;
        department: Department | null;
        materialName: string;
        sku: string | null;
      } | null = null;

      // Request-driven deduction: validate the line, its department, material match,
      // and the approved cap BEFORE moving any stock.
      if (dto.requestItemId) {
        // Lock the request line FOR UPDATE so two concurrent deducts against the SAME
        // line (via different physical units) can't both read a stale issuedKg and
        // jointly exceed approvedKg. The lock is held until this transaction commits.
        const lockedItem = await tx.$queryRaw<{ issuedKg: number; approvedKg: number | null }[]>`
          SELECT "issuedKg", "approvedKg" FROM "ProductionRequestItem" WHERE "id" = ${dto.requestItemId} FOR UPDATE`;
        if (!lockedItem[0]) throw new NotFoundException('Request line not found.');

        const item = await tx.productionRequestItem.findUnique({
          where: { id: dto.requestItemId },
          select: {
            id: true,
            status: true,
            approvedKg: true,
            issuedKg: true,
            materialName: true,
            sku: true,
            request: { select: { id: true, department: true } },
          },
        });
        if (!item) throw new NotFoundException('Request line not found.');
        if (item.status !== RequestStatus.APPROVED && item.status !== RequestStatus.PARTIAL) {
          throw new BadRequestException('Only an approved or partially-approved line can be issued.');
        }
        // Hard QR-verify: the scanned unit must be the requested material.
        if (!sameMaterial(row, item)) {
          throw new BadRequestException(
            `Scanned unit is ${row.materialName}${row.sku ? ` (${row.sku})` : ''}, but this line requested ${item.materialName}${item.sku ? ` (${item.sku})` : ''}.`,
          );
        }
        // The chosen department must match the request's department.
        if (department !== item.request.department) {
          throw new BadRequestException(
            `This line belongs to ${item.request.department}; deduct against that department.`,
          );
        }
        const approved = item.approvedKg ?? 0;
        if (item.issuedKg + dto.quantityKg > approved + 1e-9) {
          const remaining = Math.max(0, approved - item.issuedKg);
          throw new BadRequestException(
            `Cannot issue ${dto.quantityKg} kg — only ${remaining} kg of the approved ${approved} kg remain on this line.`,
          );
        }
        requestItem = {
          id: item.id,
          requestId: item.request.id,
          status: item.status,
          approvedKg: item.approvedKg,
          issuedKg: item.issuedKg,
          department: item.request.department,
          materialName: item.materialName,
          sku: item.sku,
        };
      }

      // FIFO advisory (consumption only): if an OLDER in-stock unit of the same material
      // exists, this deduct/discard is a FIFO override. We never block — but we record
      // which older unit was skipped so Admin can see whether FIFO is followed.
      let fifoOverride: { skipped: { uniqueId: string; arrivedAt: Date | null; balanceKg: number }; olderCount: number } | null = null;
      if (dto.type === StockTxnType.DEDUCT || dto.type === StockTxnType.DISCARD) {
        const candidates = await tx.material.findMany({
          where: {
            balanceKg: { gt: 0 },
            ...(row.sku ? { sku: row.sku } : { materialName: row.materialName, sku: null }),
          },
          select: { uniqueId: true, arrivedAt: true, balanceKg: true },
        });
        const older = olderUnitsThan(
          { uniqueId: dto.uniqueId, arrivedAt: row.arrivedAt, balanceKg: row.balanceKg },
          candidates,
        );
        if (older.length > 0) {
          fifoOverride = {
            skipped: { uniqueId: older[0].uniqueId, arrivedAt: older[0].arrivedAt, balanceKg: older[0].balanceKg ?? 0 },
            olderCount: older.length,
          };
        }
      }

      // Compute the new balance and block anything that would go negative.
      let balanceAfter: number;
      if (dto.type === StockTxnType.ADD) {
        balanceAfter = before + dto.quantityKg;
      } else {
        // DEDUCT or DISCARD — cannot exceed what's on the unit.
        if (dto.quantityKg > before + 1e-9) {
          const verb = isDiscard ? 'discard' : 'deduct';
          throw new BadRequestException(
            `Cannot ${verb} ${dto.quantityKg} kg — only ${before} kg remain on ${dto.uniqueId}.`,
          );
        }
        balanceAfter = before - dto.quantityKg;
      }
      // Guard against float drift landing just under zero.
      balanceAfter = Math.max(0, Number(balanceAfter.toFixed(6)));

      const txn = await tx.stockTransaction.create({
        data: {
          materialId: row.id,
          type: dto.type,
          quantityKg: dto.quantityKg,
          department,
          requestItemId: requestItem?.id ?? null,
          actorId: user.id,
          balanceAfter,
          note: dto.note?.trim() || null,
        },
      });

      await tx.material.update({
        where: { id: row.id },
        data: { balanceKg: balanceAfter },
      });

      // Advance the request line's issued total (and fulfilment) when this was a
      // request-driven deduction.
      if (requestItem) {
        const newIssued = Number((requestItem.issuedKg + dto.quantityKg).toFixed(6));
        const approved = requestItem.approvedKg ?? 0;
        const fulfilled = newIssued + 1e-9 >= approved;
        await tx.productionRequestItem.update({
          where: { id: requestItem.id },
          data: {
            issuedKg: newIssued,
            fulfilledAt: fulfilled ? new Date() : undefined,
          },
        });
      }

      await this.audit.log(
        {
          entityType: 'StockTransaction',
          entityId: txn.id,
          action: `STOCK_${dto.type}`,
          actorId: user.id,
          device: dto.device ?? null,
          before: { uniqueId: dto.uniqueId, balanceKg: before },
          after: {
            uniqueId: dto.uniqueId,
            type: dto.type,
            quantityKg: dto.quantityKg,
            department,
            balanceKg: balanceAfter,
            requestItemId: requestItem?.id ?? null,
            requestId: requestItem?.requestId ?? null,
          },
        },
        tx,
      );

      // Record the FIFO override (older stock skipped) as its own append-only entry, so
      // Admin can trace whether FIFO is being followed — without blocking the operator.
      if (fifoOverride) {
        const now = new Date();
        await this.audit.log(
          {
            entityType: 'StockTransaction',
            entityId: txn.id,
            action: 'FIFO_OVERRIDE',
            actorId: user.id,
            device: dto.device ?? null,
            before: {
              skippedUniqueId: fifoOverride.skipped.uniqueId,
              skippedArrivedAt: fifoOverride.skipped.arrivedAt?.toISOString() ?? null,
              skippedBalanceKg: fifoOverride.skipped.balanceKg,
              skippedAgeDays: ageDays(fifoOverride.skipped.arrivedAt, now),
              olderUnitsInStock: fifoOverride.olderCount,
            },
            after: {
              usedUniqueId: dto.uniqueId,
              usedArrivedAt: row.arrivedAt?.toISOString() ?? null,
              usedAgeDays: ageDays(row.arrivedAt, now),
              type: dto.type,
              quantityKg: dto.quantityKg,
              department,
              requestItemId: requestItem?.id ?? null,
            },
          },
          tx,
        );
      }

      const unit = await tx.material.findUnique({ where: { id: row.id }, select: unitSelect });
      return { transaction: txn, unit, fifoOverride: fifoOverride ? { skipped: fifoOverride.skipped.uniqueId, olderCount: fifoOverride.olderCount } : null };
    });
  }
}
