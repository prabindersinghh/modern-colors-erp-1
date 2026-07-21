import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BatchStatus, Department, Prisma, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  assertDepartmentAccess,
  departmentFilter,
  ownDepartment,
} from '../../common/auth/department-scope';
import { CreateBatchDto } from './dto/create-batch.dto';
import { unitTotals } from '../../common/unit-total';

/** A batch whose output is already confirmed/closed — extra requests warn, never block. */
export function isBatchLocked(status: BatchStatus): boolean {
  return status === BatchStatus.CONFIRMED || status === BatchStatus.CLOSED;
}

@Injectable()
export class BatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a batch. Department forced to the acting head's own; the batch number is
   * unique WITHIN that department (PU "B-001" and ENAMEL "B-001" may coexist).
   */
  async create(user: AuthUser, dto: CreateBatchDto) {
    const department = ownDepartment(user); // 403 unless a head with a department
    const batchNumber = dto.batchNumber.trim();
    if (!batchNumber) throw new BadRequestException('Batch number is required.');

    const existing = await this.prisma.batch.findUnique({
      where: { department_batchNumber: { department, batchNumber } },
    });
    if (existing) {
      throw new ConflictException(
        `Batch "${batchNumber}" already exists for ${department}. Pick it from the list instead of creating a duplicate.`,
      );
    }

    const batch = await this.prisma.batch.create({
      data: {
        batchNumber,
        department,
        note: dto.note?.trim() || null,
        createdById: user.id,
        status: BatchStatus.OPEN,
      },
    });

    await this.audit.log({
      entityType: 'Batch',
      entityId: batch.id,
      action: 'BATCH_CREATED',
      actorId: user.id,
      after: { batchNumber, department },
    });

    return batch;
  }

  /**
   * Batches visible to the caller — a head sees ONLY their own department's, Store and
   * Admin see all. Newest first. Each row carries the accumulated totals so the picker
   * can show "3 requests · 120 kg issued" and the batch's status.
   */
  async list(user: AuthUser, params: { search?: string; take?: number } = {}) {
    const take = Math.min(200, Math.max(1, params.take ?? 50));
    const where: Prisma.BatchWhereInput = {
      ...departmentFilter(user), // 403 for roles with no legitimate scope
      ...(params.search
        ? { batchNumber: { contains: params.search, mode: 'insensitive' } }
        : {}),
    };

    const batches = await this.prisma.batch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { requestItems: true, productionOutputs: true, finishedGoods: true } },
      },
    });

    return Promise.all(batches.map((b) => this.withTotals(b)));
  }

  /** One batch (dept-checked) with its totals. */
  async findOne(user: AuthUser, id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { requestItems: true, productionOutputs: true, finishedGoods: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    assertDepartmentAccess(user, batch.department);
    return this.withTotals(batch);
  }

  /**
   * Accumulated consumption for a batch: the sum of everything ISSUED against every
   * line pointing at it, across ALL requests (including later top-ups). This is why
   * batches are a record rather than free text — top-ups add, never duplicate.
   */
  private async withTotals<T extends { id: string; status: BatchStatus }>(batch: T) {
    // Grouped by the line's unit throughout: a batch can consume pigment (kg) and
    // solvent (L), and those must never be added into one figure.
    const [lineByUnit, issuedRows] = await Promise.all([
      this.prisma.productionRequestItem.groupBy({
        by: ['unit'],
        where: { batchId: batch.id },
        _sum: { requestedKg: true, approvedKg: true, issuedKg: true },
        _count: { _all: true },
      }),
      // Authoritative consumed figure straight from the append-only ledger.
      this.prisma.stockTransaction.findMany({
        where: { type: StockTxnType.DEDUCT, requestItem: { batchId: batch.id } },
        select: { quantityKg: true, requestItem: { select: { unit: true } } },
      }),
    ]);

    // Distinct parent requests that have touched this batch.
    const reqs = await this.prisma.productionRequestItem.findMany({
      where: { batchId: batch.id },
      select: { requestId: true },
      distinct: ['requestId'],
    });

    // Dispatch visibility for the head: of this batch's FG units, how many shipped.
    const fgCounts = await this.prisma.finishedGood.groupBy({
      by: ['status'],
      where: { batchId: batch.id },
      _count: { _all: true },
    });
    const fgN = (s: string) => fgCounts.find((c) => c.status === s)?._count._all ?? 0;
    const fgDispatched = fgN('DISPATCHED');
    const fgAwaiting = fgN('GENERATED') + fgN('READY');

    return {
      ...batch,
      // Dispatch visibility for the head — active units only; scrapped/refurbished
      // originals are excluded from both sides of the progress figure.
      fg: {
        total: fgDispatched + fgAwaiting,
        dispatched: fgDispatched,
        awaiting: fgAwaiting,
        scrapped: fgN('SCRAPPED'),
        refurbished: fgN('REFURBISHED'),
        pct:
          fgDispatched + fgAwaiting > 0
            ? Math.round((fgDispatched / (fgDispatched + fgAwaiting)) * 100)
            : 0,
      },
      totals: {
        lineCount: lineByUnit.reduce((s, r) => s + r._count._all, 0),
        requestCount: reqs.length,
        requested: unitTotals(lineByUnit.map((r) => ({ unit: r.unit, qty: r._sum.requestedKg ?? 0 }))),
        approved: unitTotals(lineByUnit.map((r) => ({ unit: r.unit, qty: r._sum.approvedKg ?? 0 }))),
        issued: unitTotals(issuedRows.map((r) => ({ unit: r.requestItem?.unit ?? 'kg', qty: r.quantityKg }))),
      },
      locked: isBatchLocked(batch.status),
    };
  }

  /**
   * FULL TRACEABILITY CHAIN — the point of Phase 3.
   * Backwards: FG unit → batch → request lines → stock issues → material units → PO →
   * supplier. Forwards: batch → outputs → FG units → dispatch state.
   */
  async trace(user: AuthUser, id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    assertDepartmentAccess(user, batch.department);

    // ── What went IN: every line pointing at this batch (across ALL requests, incl.
    // later top-ups), each with the actual issues and the source units/POs/suppliers.
    const lines = await this.prisma.productionRequestItem.findMany({
      where: { batchId: id },
      include: {
        request: {
          select: {
            id: true,
            createdAt: true,
            requestedBy: { select: { id: true, name: true } },
          },
        },
        transactions: {
          where: { type: StockTxnType.DEDUCT },
          include: {
            actor: { select: { id: true, name: true } },
            material: {
              select: {
                uniqueId: true,
                materialName: true,
                sku: true,
                supplier: true,
                arrivedAt: true,
                po: { select: { id: true, poNumber: true, supplier: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const materialsIn = lines.map((l) => ({
      lineId: l.id,
      requestId: l.requestId,
      requestedAt: l.request.createdAt,
      requestedBy: l.request.requestedBy,
      materialName: l.materialName,
      sku: l.sku,
      requestedKg: l.requestedKg,
      approvedKg: l.approvedKg,
      issuedKg: l.issuedKg,
      unit: l.unit, // measure of the three figures above — "kg" or "L"
      status: l.status,
      issues: l.transactions.map((t) => ({
        transactionId: t.id,
        quantityKg: t.quantityKg,
        at: t.createdAt,
        by: t.actor,
        unit: t.material
          ? {
              uniqueId: t.material.uniqueId,
              materialName: t.material.materialName,
              sku: t.material.sku,
              arrivedAt: t.material.arrivedAt,
              supplier: t.material.po?.supplier ?? t.material.supplier,
              poNumber: t.material.po?.poNumber ?? null,
              poId: t.material.po?.id ?? null,
            }
          : null,
      })),
    }));

    // Distinct suppliers/POs that fed this batch — the top of the chain.
    const sources = new Map<string, { poId: string | null; poNumber: string | null; supplier: string | null; unitIds: string[] }>();
    for (const l of materialsIn) {
      for (const iss of l.issues) {
        if (!iss.unit) continue;
        const key = `${iss.unit.poId ?? 'none'}`;
        const s = sources.get(key) ?? {
          poId: iss.unit.poId,
          poNumber: iss.unit.poNumber,
          supplier: iss.unit.supplier ?? null,
          unitIds: [],
        };
        if (!s.unitIds.includes(iss.unit.uniqueId)) s.unitIds.push(iss.unit.uniqueId);
        sources.set(key, s);
      }
    }

    // ── What came OUT: outputs and their finished-goods units.
    const outputs = await this.prisma.productionOutput.findMany({
      where: { batchId: id },
      include: {
        recordedBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
        finishedGoods: {
          select: {
            id: true,
            uniqueId: true,
            status: true,
            dispatchedAt: true,
            dispatchedBy: { select: { id: true, name: true } },
          },
          orderBy: { uniqueId: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const allFg = outputs.flatMap((o) => o.finishedGoods);
    // Grouped by the line's unit — a batch fed by both pigment (kg) and solvent (L) must
    // never report one blended "total issued".
    const totalIssuedByUnit = unitTotals(
      materialsIn.map((l) => ({
        unit: l.unit,
        qty: l.issues.reduce((a, i) => a + i.quantityKg, 0),
      })),
    );

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        department: batch.department,
        status: batch.status,
        note: batch.note,
        createdAt: batch.createdAt,
        createdBy: batch.createdBy,
      },
      in: {
        lineCount: materialsIn.length,
        requestCount: new Set(materialsIn.map((l) => l.requestId)).size,
        totalIssuedByUnit,
        materials: materialsIn,
        sources: [...sources.values()],
      },
      out: {
        outputCount: outputs.length,
        confirmedCount: outputs.filter((o) => o.confirmed).length,
        fgTotal: allFg.length,
        fgDispatched: allFg.filter((f) => f.status === 'DISPATCHED').length,
        outputs,
      },
    };
  }

  /**
   * Move a batch's status forward. Used by the output/FG flows. Never moves backwards
   * except the explicit top-up path, which only WARNS (handled by the caller).
   */
  async setStatus(batchId: string, status: BatchStatus, actorId: string, action: string) {
    const before = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!before) throw new NotFoundException('Batch not found');
    const batch = await this.prisma.batch.update({ where: { id: batchId }, data: { status } });
    await this.audit.log({
      entityType: 'Batch',
      entityId: batchId,
      action,
      actorId,
      before: { status: before.status },
      after: { status },
    });
    return batch;
  }
}

const round = (n: number) => Number(n.toFixed(6));
