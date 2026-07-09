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
import { CreateProductionRequestDto } from './dto/create-production-request.dto';

const requestInclude = {
  requestedBy: { select: { id: true, name: true, department: true } },
  reviewedBy: { select: { id: true, name: true } },
  items: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProductionRequestInclude;

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
}
