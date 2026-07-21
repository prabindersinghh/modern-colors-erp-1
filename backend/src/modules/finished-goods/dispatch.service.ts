import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FgStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isFinishedGoodId } from './finished-goods.service';

const fgInclude = {
  batch: { select: { id: true, batchNumber: true, department: true } },
  output: { select: { productName: true, productionDate: true } },
  dispatchedBy: { select: { id: true, name: true } },
} satisfies Prisma.FinishedGoodInclude;

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everything still awaiting dispatch, newest batch first — the Dispatch home list. */
  async ready(params: { search?: string; take?: number } = {}) {
    const take = Math.min(500, Math.max(1, params.take ?? 200));
    const units = await this.prisma.finishedGood.findMany({
      where: {
        status: { in: [FgStatus.GENERATED, FgStatus.READY] },
        ...(params.search
          ? {
              OR: [
                { uniqueId: { contains: params.search, mode: 'insensitive' } },
                { productName: { contains: params.search, mode: 'insensitive' } },
                { batch: { batchNumber: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: fgInclude,
      orderBy: [{ createdAt: 'desc' }, { uniqueId: 'asc' }],
      take,
    });

    // Group by batch so the dispatcher can ship a whole pallet at once.
    const byBatch = new Map<
      string,
      {
        batchId: string
        batchNumber: string
        department: string
        productName: string
        pending: number
        dispatched: number
        total: number
        pct: number
        units: typeof units
      }
    >();
    for (const u of units) {
      const g = byBatch.get(u.batchId) ?? {
        batchId: u.batchId,
        batchNumber: u.batch.batchNumber,
        department: u.batch.department,
        productName: u.productName,
        pending: 0,
        dispatched: 0,
        total: 0,
        pct: 0,
        units: [] as typeof units,
      };
      g.pending += 1;
      g.units.push(u);
      byBatch.set(u.batchId, g);
    }

    // Per-batch progress: dispatched vs total, so Dispatch can stop mid-batch and
    // resume knowing exactly where they left off. Scrapped/refurbished originals are
    // excluded from both sides — they are no longer part of what this batch ships.
    if (byBatch.size > 0) {
      const counts = await this.prisma.finishedGood.groupBy({
        by: ['batchId', 'status'],
        where: { batchId: { in: [...byBatch.keys()] } },
        _count: { _all: true },
      });
      for (const c of counts) {
        const g = byBatch.get(c.batchId);
        if (!g) continue;
        if (c.status === FgStatus.DISPATCHED) g.dispatched += c._count._all;
      }
      for (const g of byBatch.values()) {
        g.total = g.dispatched + g.pending;
        g.pct = g.total > 0 ? Math.round((g.dispatched / g.total) * 100) : 0;
      }
    }
    return { total: units.length, batches: [...byBatch.values()] };
  }

  /**
   * Scan one FG QR to dispatch it. Rejects raw-material codes with a clear message and
   * refuses to double-dispatch. Records who + when, append-only audited.
   */
  async dispatchUnit(user: AuthUser, uniqueId: string, note?: string, device?: string) {
    const id = uniqueId.trim();
    if (!isFinishedGoodId(id)) {
      throw new BadRequestException(
        `${id} is not a finished-goods code. This screen only dispatches FG- units.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the row so a double-scan can't dispatch the same drum twice.
      const locked = await tx.$queryRaw<{ id: string; status: FgStatus }[]>`
        SELECT "id", "status" FROM "FinishedGood" WHERE "uniqueId" = ${id} FOR UPDATE`;
      const row = locked[0];
      if (!row) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
      if (row.status === FgStatus.DISPATCHED) {
        throw new ConflictException(`${id} was already dispatched.`);
      }

      const unit = await tx.finishedGood.update({
        where: { id: row.id },
        data: {
          status: FgStatus.DISPATCHED,
          dispatchedAt: new Date(),
          dispatchedById: user.id,
          dispatchNote: note?.trim() || null,
        },
        include: fgInclude,
      });

      await this.audit.log(
        {
          entityType: 'FinishedGood',
          entityId: unit.id,
          action: 'FG_DISPATCHED',
          actorId: user.id,
          device: device ?? null,
          before: { status: row.status },
          after: {
            uniqueId: unit.uniqueId,
            status: FgStatus.DISPATCHED,
            batchNumber: unit.batch.batchNumber,
            productName: unit.productName,
            note: note?.trim() || null,
          },
        },
        tx,
      );

      return unit;
    });
  }

  /**
   * Bulk-dispatch the remaining undispatched units of one batch (a full pallet ships).
   * Audited distinctly from per-unit scans so Admin can tell them apart.
   */
  async dispatchBatch(user: AuthUser, batchId: string, note?: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const pending = await this.prisma.finishedGood.findMany({
      where: { batchId, status: { in: [FgStatus.GENERATED, FgStatus.READY] } },
      select: { id: true, uniqueId: true },
      orderBy: { uniqueId: 'asc' },
    });
    if (pending.length === 0) {
      throw new ConflictException('No undispatched units remain in this batch.');
    }

    const now = new Date();
    await this.prisma.finishedGood.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: {
        status: FgStatus.DISPATCHED,
        dispatchedAt: now,
        dispatchedById: user.id,
        dispatchNote: note?.trim() || null,
      },
    });

    await this.audit.log({
      entityType: 'Batch',
      entityId: batchId,
      action: 'FG_DISPATCHED_BULK',
      actorId: user.id,
      after: {
        batchNumber: batch.batchNumber,
        department: batch.department,
        unitCount: pending.length,
        firstId: pending[0].uniqueId,
        lastId: pending.at(-1)!.uniqueId,
        note: note?.trim() || null,
      },
    });

    return { dispatched: pending.length, units: pending.map((p) => p.uniqueId) };
  }

  /** This dispatcher's recent history + today's count. */
  async history(user: AuthUser, take = 50) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [recent, todayCount, totalPending] = await Promise.all([
      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.DISPATCHED },
        include: fgInclude,
        orderBy: { dispatchedAt: 'desc' },
        take: Math.min(200, take),
      }),
      this.prisma.finishedGood.count({
        where: { status: FgStatus.DISPATCHED, dispatchedAt: { gte: startOfDay } },
      }),
      this.prisma.finishedGood.count({
        where: { status: { in: [FgStatus.GENERATED, FgStatus.READY] } },
      }),
    ]);
    return { recent, todayCount, totalPending };
  }
}
