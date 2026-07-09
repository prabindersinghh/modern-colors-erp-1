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
} satisfies Prisma.ProductionRequestInclude;

@Injectable()
export class ProductionRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A production head raises a per-material request. Department is forced server-side. */
  async create(dto: CreateProductionRequestDto, user: AuthUser) {
    const department = ownDepartment(user); // 403 unless the caller is a head with a dept
    if (!(dto.requestedKg > 0)) {
      throw new BadRequestException('Requested quantity (KG) must be greater than 0.');
    }

    // If a catalogue item was referenced, make sure it exists (best-effort integrity).
    if (dto.catalogueItemId) {
      const item = await this.prisma.masterCatalogueItem.findUnique({
        where: { id: dto.catalogueItemId },
      });
      if (!item) throw new BadRequestException('Selected catalogue item no longer exists.');
    }

    const req = await this.prisma.productionRequest.create({
      data: {
        department,
        requestedById: user.id,
        materialName: dto.materialName.trim(),
        sku: dto.sku?.trim() || null,
        catalogueItemId: dto.catalogueItemId || null,
        requestedKg: dto.requestedKg,
        status: RequestStatus.PENDING,
      },
      include: requestInclude,
    });

    await this.audit.log({
      entityType: 'ProductionRequest',
      entityId: req.id,
      action: 'PRODUCTION_REQUEST_CREATED',
      actorId: user.id,
      after: { department, materialName: req.materialName, requestedKg: req.requestedKg },
    });

    return req;
  }

  /** List requests visible to the caller — a head sees ONLY their own department. */
  async list(user: AuthUser, params: { status?: RequestStatus; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.ProductionRequestWhereInput = {
      ...departmentFilter(user), // {} for Store/Admin; { department: theirs } for a head
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

  /** Single request — 403 if it belongs to a department the caller may not see. */
  async findOne(user: AuthUser, id: string) {
    const req = await this.prisma.productionRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!req) throw new NotFoundException('Request not found');
    assertDepartmentAccess(user, req.department); // enforces isolation at the record level
    return req;
  }

  /** Status/quantity rollup scoped to what the caller may see. */
  async summary(user: AuthUser) {
    const where = departmentFilter(user);
    const grouped = await this.prisma.productionRequest.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { requestedKg: true, issuedKg: true },
    });

    const byStatus: Record<RequestStatus, number> = {
      PENDING: 0,
      APPROVED: 0,
      PARTIAL: 0,
      REJECTED: 0,
    };
    let totalRequestedKg = 0;
    let totalIssuedKg = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      totalRequestedKg += g._sum.requestedKg ?? 0;
      totalIssuedKg += g._sum.issuedKg ?? 0;
    }
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return { total, byStatus, totalRequestedKg, totalIssuedKg };
  }
}
