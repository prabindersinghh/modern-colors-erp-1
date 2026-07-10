import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  assertDepartmentAccess,
  departmentFilter,
  ownDepartment,
} from '../../common/auth/department-scope';
import { StockService } from '../stock/stock.service';
import { CreateProductionRequestDto } from './dto/create-production-request.dto';
import { ReviewRequestItemDto } from './dto/review-request-item.dto';

const requestInclude = {
  requestedBy: { select: { id: true, name: true, department: true } },
  reviewedBy: { select: { id: true, name: true } },
  items: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProductionRequestInclude;

/**
 * Derive a request's OVERALL status from its line statuses:
 *  - no lines reviewed              → PENDING
 *  - some reviewed, some pending     → IN_PROGRESS
 *  - all reviewed & all APPROVED     → APPROVED
 *  - all reviewed & all REJECTED     → REJECTED
 *  - all reviewed, otherwise (mix)   → PARTIAL
 */
export function computeParentStatus(items: { status: RequestStatus }[]): RequestStatus {
  if (items.length === 0) return RequestStatus.PENDING;
  const reviewed = items.filter((i) => i.status !== RequestStatus.PENDING);
  if (reviewed.length === 0) return RequestStatus.PENDING;
  if (reviewed.length < items.length) return RequestStatus.IN_PROGRESS;
  if (items.every((i) => i.status === RequestStatus.APPROVED)) return RequestStatus.APPROVED;
  if (items.every((i) => i.status === RequestStatus.REJECTED)) return RequestStatus.REJECTED;
  return RequestStatus.PARTIAL;
}

const AUDIT_ACTION: Record<ReviewRequestItemDto['action'], string> = {
  APPROVE: 'REQUEST_ITEM_APPROVED',
  PARTIAL: 'REQUEST_ITEM_PARTIAL',
  REJECT: 'REQUEST_ITEM_REJECTED',
};

const emptyByStatus = (): Record<RequestStatus, number> => ({
  PENDING: 0,
  IN_PROGRESS: 0,
  APPROVED: 0,
  PARTIAL: 0,
  REJECTED: 0,
});

@Injectable()
export class ProductionRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  /**
   * A production head raises ONE request with many material lines. Department is forced
   * to the head's own (client value ignored). Each line starts PENDING; the parent
   * status is PENDING until Store reviews lines.
   */
  async create(dto: CreateProductionRequestDto, user: AuthUser) {
    const department = ownDepartment(user); // 403 unless a head with a department
    if (!dto.items?.length) {
      throw new BadRequestException('A request must have at least one material line.');
    }
    for (const it of dto.items) {
      if (!it.materialName?.trim()) throw new BadRequestException('Each line needs a material.');
      if (!(it.requestedKg > 0)) {
        throw new BadRequestException('Each line quantity (KG) must be greater than 0.');
      }
    }

    // Validate any referenced catalogue items exist (best-effort integrity).
    const catIds = [...new Set(dto.items.map((i) => i.catalogueItemId).filter(Boolean))] as string[];
    if (catIds.length) {
      const found = await this.prisma.masterCatalogueItem.count({ where: { id: { in: catIds } } });
      if (found !== catIds.length) {
        throw new BadRequestException('A selected catalogue item no longer exists.');
      }
    }

    const req = await this.prisma.productionRequest.create({
      data: {
        department,
        requestedById: user.id,
        note: dto.note?.trim() || null,
        status: RequestStatus.PENDING,
        items: {
          create: dto.items.map((it) => ({
            materialName: it.materialName.trim(),
            sku: it.sku?.trim() || null,
            catalogueItemId: it.catalogueItemId || null,
            requestedKg: it.requestedKg,
            status: RequestStatus.PENDING,
          })),
        },
      },
      include: requestInclude,
    });

    await this.audit.log({
      entityType: 'ProductionRequest',
      entityId: req.id,
      action: 'PRODUCTION_REQUEST_CREATED',
      actorId: user.id,
      after: {
        department,
        itemCount: req.items.length,
        totalRequestedKg: req.items.reduce((s, i) => s + i.requestedKg, 0),
      },
    });

    return req;
  }

  /** List requests visible to the caller — a head sees ONLY their own department. */
  async list(user: AuthUser, params: { status?: RequestStatus; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.ProductionRequestWhereInput = {
      ...departmentFilter(user),
      status: params.status,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.productionRequest.findMany({
        where,
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.productionRequest.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Single request (with its lines) — 403 if it belongs to a department the caller may not see. */
  async findOne(user: AuthUser, id: string) {
    const req = await this.prisma.productionRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!req) throw new NotFoundException('Request not found');
    assertDepartmentAccess(user, req.department);
    return req;
  }

  /** Rollup scoped to what the caller may see — request counts + line KG totals. */
  async summary(user: AuthUser) {
    const reqWhere = departmentFilter(user);
    const itemWhere: Prisma.ProductionRequestItemWhereInput = { request: reqWhere };

    const [reqGrouped, itemGrouped, itemSum] = await Promise.all([
      this.prisma.productionRequest.groupBy({ by: ['status'], where: reqWhere, _count: { _all: true } }),
      this.prisma.productionRequestItem.groupBy({ by: ['status'], where: itemWhere, _count: { _all: true } }),
      this.prisma.productionRequestItem.aggregate({
        where: itemWhere,
        _sum: { requestedKg: true, issuedKg: true },
      }),
    ]);

    const reqByStatus = emptyByStatus();
    for (const g of reqGrouped) reqByStatus[g.status] = g._count._all;
    const itemByStatus = emptyByStatus();
    for (const g of itemGrouped) itemByStatus[g.status] = g._count._all;

    return {
      requests: {
        total: Object.values(reqByStatus).reduce((a, b) => a + b, 0),
        byStatus: reqByStatus,
      },
      items: {
        total: Object.values(itemByStatus).reduce((a, b) => a + b, 0),
        byStatus: itemByStatus,
        totalRequestedKg: itemSum._sum.requestedKg ?? 0,
        totalIssuedKg: itemSum._sum.issuedKg ?? 0,
      },
    };
  }

  /**
   * Factory-wide oversight rollup for the Admin dashboard (Step 8). Read-only, spans
   * every department. Composes request aggregates (this module) with stock aggregates
   * (StockService) so the Admin sees the whole Phase 2 picture on one screen.
   */
  async overview() {
    const [reqByDeptStatus, recentReviews, stockLevels, movements, recentMovements] =
      await Promise.all([
      // Requests by department × overall status — "where are things stuck".
      this.prisma.productionRequest.groupBy({
        by: ['department', 'status'],
        _count: { _all: true },
      }),
      // Last few request reviews for the activity feed.
      this.prisma.productionRequest.findMany({
        where: { reviewedAt: { not: null } },
        select: {
          id: true,
          department: true,
          status: true,
          reviewedAt: true,
          reviewedBy: { select: { name: true } },
        },
        orderBy: { reviewedAt: 'desc' },
        take: 8,
      }),
      this.stock.levels({}),
      this.stock.movementTotals(30),
      this.stock.recentMovements(8),
      ]);

    // Department × status matrix (requests).
    const departments = ['PU', 'ENAMEL', 'POWDER'] as const;
    const matrix: Record<string, Record<RequestStatus, number>> = {};
    for (const d of departments) matrix[d] = emptyByStatus();
    for (const g of reqByDeptStatus) {
      matrix[g.department][g.status] = g._count._all;
    }

    // Per-department fulfilment (requested / approved / issued KG). Done with a scoped
    // aggregate per department (small N: 3 departments).
    const fulfilment: Record<
      string,
      { requestedKg: number; approvedKg: number; issuedKg: number }
    > = {};
    await Promise.all(
      departments.map(async (d) => {
        const agg = await this.prisma.productionRequestItem.aggregate({
          where: { request: { department: d } },
          _sum: { requestedKg: true, approvedKg: true, issuedKg: true },
        });
        fulfilment[d] = {
          requestedKg: Number((agg._sum.requestedKg ?? 0).toFixed(6)),
          approvedKg: Number((agg._sum.approvedKg ?? 0).toFixed(6)),
          issuedKg: Number((agg._sum.issuedKg ?? 0).toFixed(6)),
        };
      }),
    );

    return {
      requestMatrix: matrix,
      fulfilment,
      stock: {
        grandTotalKg: stockLevels.grandTotalKg,
        unitCount: stockLevels.unitCount,
        materialCount: stockLevels.materials.length,
      },
      movements,
      recentActivity: {
        reviews: recentReviews,
        movements: recentMovements,
      },
    };
  }

  /**
   * Store reviews ONE line — accept (full), partial (lower KG) or reject (with reason).
   * The line is updated and the parent's overall status is recomputed atomically. A line
   * that has already been (partly) issued cannot be re-decided.
   */
  async reviewItem(user: AuthUser, reqId: string, itemId: string, dto: ReviewRequestItemDto) {
    const req = await this.prisma.productionRequest.findUnique({
      where: { id: reqId },
      include: { items: true },
    });
    if (!req) throw new NotFoundException('Request not found');
    assertDepartmentAccess(user, req.department); // Store (ADMIN) passes; defense in depth

    const item = req.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Request line not found');
    if (item.issuedKg > 0) {
      throw new BadRequestException('This line has already been issued and cannot be re-decided.');
    }

    let data: Prisma.ProductionRequestItemUpdateInput;
    if (dto.action === 'APPROVE') {
      data = {
        status: RequestStatus.APPROVED,
        approvedKg: item.requestedKg,
        rejectionReason: null,
        reviewedAt: new Date(),
      };
    } else if (dto.action === 'PARTIAL') {
      const kg = dto.approvedKg;
      if (kg == null || !(kg > 0) || !(kg < item.requestedKg)) {
        throw new BadRequestException(
          `Partial quantity must be greater than 0 and less than the requested ${item.requestedKg} kg.`,
        );
      }
      data = { status: RequestStatus.PARTIAL, approvedKg: kg, rejectionReason: null, reviewedAt: new Date() };
    } else {
      const reason = dto.reason?.trim();
      if (!reason) throw new BadRequestException('A rejection reason is required.');
      data = { status: RequestStatus.REJECTED, approvedKg: null, rejectionReason: reason, reviewedAt: new Date() };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.productionRequestItem.update({ where: { id: itemId }, data });
      const items = await tx.productionRequestItem.findMany({
        where: { requestId: reqId },
        select: { status: true },
      });
      const parentStatus = computeParentStatus(items);
      await tx.productionRequest.update({
        where: { id: reqId },
        data: { status: parentStatus, reviewedById: user.id, reviewedAt: new Date() },
      });
      await this.audit.log(
        {
          entityType: 'ProductionRequestItem',
          entityId: itemId,
          action: AUDIT_ACTION[dto.action],
          actorId: user.id,
          before: { status: item.status, approvedKg: item.approvedKg },
          after: {
            requestId: reqId,
            status: data.status as string,
            approvedKg: (data.approvedKg as number | null) ?? null,
            rejectionReason: (data.rejectionReason as string | null) ?? null,
          },
        },
        tx,
      );
      return tx.productionRequest.findUnique({ where: { id: reqId }, include: requestInclude });
    });
  }
}
