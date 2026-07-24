import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CartonStatus, FgStatus, Prisma, ScanKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanSessionService } from '../scan-session/scan-session.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isFinishedGoodId } from './finished-goods.service';
import { isCartonId } from '../packing/carton-id';

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
    private readonly sessions: ScanSessionService,
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
    // Server-side gate: no scan-out without an open dispatch session.
    await this.sessions.assertOpen(user.id, ScanKind.DISPATCH);
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
      // Gap A — a unit a packer has taken into a carton cannot be shipped out from under
      // him by a direct scan. This holds REGARDLESS of the PACKING_STAGE flag: once a unit
      // is UNDER_PACKING or PACKED it ships as part of its carton (scan the PG), never
      // alone. Only GENERATED/READY (grandfathered) stock dispatches directly.
      if (row.status === FgStatus.UNDER_PACKING) {
        throw new ConflictException(
          `${id} is being packed into a carton — dispatch the carton (PG-…), not the unit.`,
        );
      }
      if (row.status === FgStatus.PACKED) {
        throw new ConflictException(
          `${id} is packed into a carton — scan the carton's PG- code to dispatch it.`,
        );
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
    await this.sessions.assertOpen(user.id, ScanKind.DISPATCH);
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

  /** PACKED cartons awaiting dispatch — the PG cards shown when PACKING_STAGE is ON. */
  async readyCartons(params: { search?: string; take?: number } = {}) {
    const take = Math.min(200, Math.max(1, params.take ?? 100));
    const cartons = await this.prisma.carton.findMany({
      where: {
        status: CartonStatus.PACKED,
        ...(params.search ? { uniqueId: { contains: params.search, mode: 'insensitive' } } : {}),
      },
      include: {
        packedBy: { select: { name: true } },
        items: {
          include: {
            finishedGood: {
              select: { uniqueId: true, family: true, productName: true, batch: { select: { batchNumber: true } } },
            },
          },
        },
      },
      orderBy: { packedAt: 'asc' },
      take,
    });
    return { total: cartons.length, cartons };
  }

  /**
   * Scan a carton's PG to dispatch it — the carton AND every unit inside go DISPATCHED in
   * one transaction, double-scan guarded under FOR UPDATE. A voided PG is refused (its
   * printed label no longer describes a shippable carton); a still-draft/unpacked carton
   * is refused too. Session-gated like the unit scan.
   */
  async dispatchCarton(user: AuthUser, uniqueId: string, note?: string, device?: string) {
    await this.sessions.assertOpen(user.id, ScanKind.DISPATCH);
    const id = uniqueId.trim();
    if (!isCartonId(id)) {
      throw new BadRequestException(`${id} is not a carton (PG-) code. Scan the carton's mega label.`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Carton" WHERE "uniqueId" = ${id} FOR UPDATE`;
      const carton = await tx.carton.findUnique({
        where: { uniqueId: id },
        include: { items: { select: { finishedGoodId: true, finishedGood: { select: { uniqueId: true } } } } },
      });
      if (!carton) throw new NotFoundException(`No carton with ID ${id}`);
      if (carton.status === CartonStatus.VOIDED) {
        throw new ConflictException(`${id} was voided and cannot be dispatched. Scan the repacked carton instead.`);
      }
      if (carton.status === CartonStatus.DISPATCHED) {
        throw new ConflictException(`${id} was already dispatched.`);
      }
      if (carton.status !== CartonStatus.PACKED) {
        throw new ConflictException(`${id} is not yet marked packed — the packer must seal it first.`);
      }

      const now = new Date();
      await tx.carton.update({
        where: { id: carton.id },
        data: { status: CartonStatus.DISPATCHED, dispatchedAt: now, dispatchedById: user.id, dispatchNote: note?.trim() || null },
      });
      await tx.finishedGood.updateMany({
        where: { id: { in: carton.items.map((i) => i.finishedGoodId) } },
        data: { status: FgStatus.DISPATCHED, dispatchedAt: now, dispatchedById: user.id, dispatchNote: note?.trim() || null },
      });
      await this.audit.log(
        {
          entityType: 'Carton',
          entityId: carton.id,
          action: 'CARTON_DISPATCHED',
          actorId: user.id,
          device: device ?? null,
          before: { status: CartonStatus.PACKED },
          after: {
            pg: id,
            unitCount: carton.items.length,
            units: carton.items.map((i) => i.finishedGood.uniqueId),
            note: note?.trim() || null,
          },
        },
        tx,
      );
      return { pg: id, dispatched: carton.items.length };
    });
  }

  /**
   * PG BATCH CARDS — one card per confirmed packing list: its contents summary (straights,
   * combos, per-family totals with size+unit) and a 0–100% progress bar = PGs dispatched /
   * PGs in the list. Every number is SERVER-computed. Voided entries are excluded from the
   * count (they were retired and repacked). A fully-dispatched list is flagged `done`.
   */
  async pgLists() {
    const familyLabel: Record<string, string> = { FINISHED_GOOD: 'Paint', HARDENER: 'Hardener', THINNER: 'Thinner' };
    const lists = await this.prisma.packingList.findMany({
      where: { status: 'CONFIRMED' },
      include: {
        packedBy: { select: { name: true } },
        cartons: {
          include: { items: { include: { finishedGood: { select: { family: true, sizePerPackage: true, sizeUnit: true } } } } },
        },
      },
      orderBy: { confirmedAt: 'desc' },
      take: 100,
    });
    const summarised = lists.map((l) => {
      const live = l.cartons.filter((c) => c.status !== CartonStatus.VOIDED);
      const straights = live.filter((c) => c.items.length === 1).length;
      const combos = live.filter((c) => c.items.length > 1).length;
      const dispatched = live.filter((c) => c.status === CartonStatus.DISPATCHED).length;
      const fam = new Map<string, { family: string; label: string; count: number; size: number; unit: string }>();
      for (const c of live) {
        for (const it of c.items) {
          const f = it.finishedGood.family;
          const e = fam.get(f) ?? { family: f, label: familyLabel[f] ?? f, count: 0, size: it.finishedGood.sizePerPackage, unit: it.finishedGood.sizeUnit };
          e.count += 1;
          fam.set(f, e);
        }
      }
      return {
        listId: l.id,
        packedBy: l.packedBy?.name ?? null,
        confirmedAt: l.confirmedAt,
        straights, combos,
        totalPgs: live.length,
        dispatched,
        progress: live.length > 0 ? Math.round((dispatched / live.length) * 100) : 0,
        done: live.length > 0 && dispatched === live.length,
        families: [...fam.values()].sort((a, b) => ['FINISHED_GOOD', 'HARDENER', 'THINNER'].indexOf(a.family) - ['FINISHED_GOOD', 'HARDENER', 'THINNER'].indexOf(b.family)),
      };
    });
    return { lists: summarised.sort((a, b) => Number(a.done) - Number(b.done)) };
  }

  /** A packing list's PG-level detail — each carton, its status and contents. */
  async pgList(listId: string) {
    const list = await this.prisma.packingList.findUnique({
      where: { id: listId },
      include: {
        cartons: {
          orderBy: { createdAt: 'asc' },
          include: { items: { include: { finishedGood: { select: { uniqueId: true, family: true, productName: true, sizePerPackage: true, sizeUnit: true } } } } },
        },
      },
    });
    if (!list) throw new NotFoundException('Packing list not found');
    return {
      listId: list.id,
      cartons: list.cartons.map((c) => ({
        pg: c.uniqueId,
        status: c.status,
        items: c.items.map((it) => ({
          uniqueId: it.finishedGood.uniqueId, family: it.finishedGood.family, productName: it.finishedGood.productName,
          size: `${it.finishedGood.sizePerPackage} ${it.finishedGood.sizeUnit}`,
        })),
      })),
    };
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
