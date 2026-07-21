import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertDepartmentAccess, departmentFilter } from '../../common/auth/department-scope';
import { isBatchLocked } from '../batch/batch.service';
import { CreateOutputDto, UpdateOutputDto } from './dto/create-output.dto';

const outputInclude = {
  batch: { select: { id: true, batchNumber: true, department: true, status: true } },
  recordedBy: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, name: true } },
  _count: { select: { finishedGoods: true } },
} satisfies Prisma.ProductionOutputInclude;

@Injectable()
export class ProductionOutputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record what was produced from a batch — saved as an UNCONFIRMED draft. The head
   * reviews it and confirms separately; only then can FG QRs be minted.
   */
  async create(user: AuthUser, dto: CreateOutputDto) {
    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    assertDepartmentAccess(user, batch.department); // 403 for another dept's batch

    // Recording MORE output against an already-confirmed batch is allowed (a second run
    // or a correction) but is warned about in the UI and audited here.
    const isExtra = isBatchLocked(batch.status);

    const output = await this.prisma.productionOutput.create({
      data: {
        batchId: batch.id,
        productName: dto.productName.trim(),
        packageCount: dto.packageCount,
        sizePerPackage: dto.sizePerPackage,
        sizeUnit: dto.sizeUnit ?? 'L',
        productionDate: new Date(dto.productionDate),
        shade: dto.shade?.trim() || null,
        productSku: dto.productSku?.trim() || null,
        notes: dto.notes?.trim() || null,
        recordedById: user.id,
        confirmed: false,
      },
      include: outputInclude,
    });

    // Batch moves OPEN → OUTPUT_RECORDED (never backwards from CONFIRMED/CLOSED).
    if (batch.status === BatchStatus.OPEN) {
      await this.prisma.batch.update({
        where: { id: batch.id },
        data: { status: BatchStatus.OUTPUT_RECORDED },
      });
    }

    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: output.id,
      action: isExtra ? 'OUTPUT_RECORDED_EXTRA' : 'OUTPUT_RECORDED',
      actorId: user.id,
      after: {
        batchNumber: batch.batchNumber,
        department: batch.department,
        productName: output.productName,
        packageCount: output.packageCount,
        sizePerPackage: output.sizePerPackage,
        sizeUnit: output.sizeUnit,
        ...(isExtra ? { note: 'Recorded against an already-confirmed batch.' } : {}),
      },
    });

    return { output, warning: isExtra ? `Batch ${batch.batchNumber} was already confirmed — this is an additional output record.` : null };
  }

  /** Outputs visible to the caller (head = own department only). */
  async list(user: AuthUser, params: { batchId?: string; confirmed?: boolean } = {}) {
    const where: Prisma.ProductionOutputWhereInput = {
      batch: departmentFilter(user), // head → own dept; Store/Admin → all
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.confirmed !== undefined ? { confirmed: params.confirmed } : {}),
    };
    const outputs = await this.prisma.productionOutput.findMany({
      where,
      include: outputInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Dispatch visibility for the head: how many of THIS output's FG units have left
    // the factory vs still sitting. Department scoping is already applied by `where`;
    // the stats only cover outputs the caller may see.
    const withFg = outputs.filter((o) => o.fgGeneratedAt);
    if (withFg.length === 0) return outputs.map((o) => ({ ...o, fgStats: null }));
    const counts = await this.prisma.finishedGood.groupBy({
      by: ['outputId', 'status'],
      where: { outputId: { in: withFg.map((o) => o.id) } },
      _count: { _all: true },
    });
    return outputs.map((o) => {
      if (!o.fgGeneratedAt) return { ...o, fgStats: null };
      const mine = counts.filter((c) => c.outputId === o.id);
      const n = (s: string) => mine.find((c) => c.status === s)?._count._all ?? 0;
      const dispatched = n('DISPATCHED');
      const scrapped = n('SCRAPPED');
      const refurbished = n('REFURBISHED');
      const awaiting = n('GENERATED') + n('READY');
      return {
        ...o,
        fgStats: {
          total: dispatched + awaiting, // active units; scrapped/refurb originals excluded
          dispatched,
          awaiting,
          scrapped,
          refurbished,
          pct: dispatched + awaiting > 0 ? Math.round((dispatched / (dispatched + awaiting)) * 100) : 0,
        },
      };
    });
  }

  async findOne(user: AuthUser, id: string) {
    const output = await this.prisma.productionOutput.findUnique({
      where: { id },
      include: outputInclude,
    });
    if (!output) throw new NotFoundException('Production output not found');
    assertDepartmentAccess(user, output.batch.department);
    return output;
  }

  /** Edit a DRAFT. Once confirmed the record is locked (corrections = a new output). */
  async update(user: AuthUser, id: string, dto: UpdateOutputDto) {
    const existing = await this.findOne(user, id);
    if (existing.confirmed) {
      throw new ConflictException(
        'This output is confirmed and can no longer be edited. Record an additional output instead.',
      );
    }
    const output = await this.prisma.productionOutput.update({
      where: { id },
      data: {
        productName: dto.productName?.trim(),
        packageCount: dto.packageCount,
        sizePerPackage: dto.sizePerPackage,
        sizeUnit: dto.sizeUnit,
        productionDate: dto.productionDate ? new Date(dto.productionDate) : undefined,
        shade: dto.shade?.trim(),
        productSku: dto.productSku?.trim(),
        notes: dto.notes?.trim(),
      },
      include: outputInclude,
    });
    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: id,
      action: 'OUTPUT_UPDATED',
      actorId: user.id,
      before: { packageCount: existing.packageCount, productName: existing.productName },
      after: { packageCount: output.packageCount, productName: output.productName },
    });
    return output;
  }

  /**
   * THE REVIEW GATE. The head confirms the recorded output; only after this can FG QR
   * codes be generated. Append-only audited. Idempotent-safe: re-confirming is rejected.
   */
  async confirm(user: AuthUser, id: string) {
    const existing = await this.findOne(user, id);
    if (existing.confirmed) {
      throw new ConflictException('This output has already been confirmed.');
    }
    if (!(existing.packageCount > 0)) {
      throw new BadRequestException('Package count must be greater than 0 before confirming.');
    }

    const [output] = await this.prisma.$transaction([
      this.prisma.productionOutput.update({
        where: { id },
        data: { confirmed: true, confirmedById: user.id, confirmedAt: new Date() },
        include: outputInclude,
      }),
      this.prisma.batch.update({
        where: { id: existing.batchId },
        data: { status: BatchStatus.CONFIRMED },
      }),
    ]);

    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: id,
      action: 'OUTPUT_CONFIRMED',
      actorId: user.id,
      before: { confirmed: false },
      after: {
        confirmed: true,
        batchNumber: existing.batch.batchNumber,
        productName: existing.productName,
        packageCount: existing.packageCount,
        totalVolume: existing.packageCount * existing.sizePerPackage,
        sizeUnit: existing.sizeUnit,
      },
    });

    return output;
  }

  /** Delete an unconfirmed draft (a confirmed record is permanent). */
  async remove(user: AuthUser, id: string) {
    const existing = await this.findOne(user, id);
    if (existing.confirmed) {
      throw new ConflictException('A confirmed output cannot be deleted.');
    }
    await this.prisma.productionOutput.delete({ where: { id } });
    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: id,
      action: 'OUTPUT_DRAFT_DELETED',
      actorId: user.id,
      before: { productName: existing.productName, packageCount: existing.packageCount },
    });
    return { deleted: true };
  }
}
