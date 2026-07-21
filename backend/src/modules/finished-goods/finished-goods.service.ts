import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { BatchStatus, FgStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QrService, type FgQrPayload } from '../qr/qr.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertDepartmentAccess, departmentFilter } from '../../common/auth/department-scope';
import { CorrectFinishedGoodDto } from './dto/correct-finished-good.dto';

// Own sequence, separate from material_unique_seq — FG IDs never collide with MC- IDs.
export const FG_SEQ = 'finished_good_unique_seq';

/** Finished-goods IDs are FG-prefixed so they can never be mistaken for raw units (MC-). */
export const FG_PREFIX = 'FG-';
export function isFinishedGoodId(id: string): boolean {
  return id.trim().toUpperCase().startsWith(FG_PREFIX);
}
export function formatFgId(n: number | bigint): string {
  return `${FG_PREFIX}${String(n).padStart(6, '0')}`;
}

const fgInclude = {
  batch: { select: { id: true, batchNumber: true, department: true } },
  output: { select: { id: true, productName: true, productionDate: true, shade: true, productSku: true } },
  dispatchedBy: { select: { id: true, name: true } },
  qrCode: { select: { payload: true, imageRef: true } },
  // Refurbishment lineage — a returned drum's old and new identities stay linked.
  refurbishedFrom: { select: { uniqueId: true } },
  refurbishedInto: { select: { uniqueId: true, status: true } },
} satisfies Prisma.FinishedGoodInclude;

@Injectable()
export class FinishedGoodsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly qr: QrService,
  ) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${FG_SEQ} START 1`);
  }

  private formatId(n: number | bigint): string {
    return formatFgId(n);
  }

  /** Single-unit label PDF (3×1.5in) — reprints and refurbished-unit stickers. */
  async unitLabel(user: AuthUser, uniqueId: string): Promise<Buffer> {
    const fg = await this.findByUniqueId(user, uniqueId);
    if (!fg.qrCode?.payload) throw new NotFoundException(`No QR payload stored for ${uniqueId}`);
    const pdf = await this.qr.buildLabelRoll([{ payload: fg.qrCode.payload as unknown as FgQrPayload }]);
    // Printing the label satisfies a pending "reprint needed" flag from a correction.
    if ((fg as { qrReprintNeeded?: boolean }).qrReprintNeeded) {
      await this.prisma.finishedGood.update({ where: { id: fg.id }, data: { qrReprintNeeded: false } });
    }
    return pdf;
  }

  /**
   * Audited CORRECTION of a finished-goods record (the factory Admin's one write).
   *
   * Guarded by CorrectionsGuard + @AllowCorrection — a named permission, NOT a role
   * grant, so OVERSIGHT's structural view-only rule stays intact and machine-checked.
   *
   * Boundaries, enforced here as well as by the DTO:
   *  - identity is untouchable: uniqueId, status, batch/output linkage, dispatch and
   *    return facts can never change through this path;
   *  - a reason is required and the change is append-only audited with the full
   *    before→after of exactly the fields that changed;
   *  - if a PRINTED field changed (name / size), the stored QR payload is regenerated
   *    so the next print is correct, and the unit is flagged "label needs reprinting".
   */
  async correct(user: AuthUser, uniqueId: string, dto: CorrectFinishedGoodDto) {
    const id = uniqueId.trim();
    if (!isFinishedGoodId(id)) {
      throw new BadRequestException(`${id} is not a finished-goods code.`);
    }
    const fg = await this.prisma.finishedGood.findUnique({
      where: { uniqueId: id },
      include: { batch: true, output: true, qrCode: true },
    });
    if (!fg) throw new NotFoundException(`No finished-goods unit with ID ${id}`);

    // Only fields that were provided AND actually differ count as changes.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};
    const consider = (field: 'productName' | 'sizePerPackage' | 'sizeUnit' | 'dispatchNote', value: unknown) => {
      if (value === undefined) return;
      const current = fg[field];
      if (value === current) return;
      before[field] = current;
      after[field] = value;
      data[field] = value;
    };
    consider('productName', dto.productName?.trim());
    consider('sizePerPackage', dto.sizePerPackage);
    consider('sizeUnit', dto.sizeUnit);
    consider('dispatchNote', dto.dispatchNote === undefined ? undefined : (dto.dispatchNote?.trim() || null));

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to correct — no field differs from the record.');
    }

    // Did the correction touch what is PRINTED on the physical sticker?
    const printedChanged = ['productName', 'sizePerPackage', 'sizeUnit'].some((f) => f in data);

    const corrected = await this.prisma.$transaction(async (tx) => {
      const unit = await tx.finishedGood.update({
        where: { id: fg.id },
        data: { ...data, ...(printedChanged ? { qrReprintNeeded: true } : {}) },
        include: fgInclude,
      });

      if (printedChanged && fg.qrCode) {
        // Regenerate the stored payload from the corrected values so the NEXT print is
        // right. The flag above records that the sticker on the drum is now outdated.
        const payload: FgQrPayload = {
          uniqueId: unit.uniqueId,
          productName: unit.productName,
          batch: fg.batch.batchNumber,
          department: fg.batch.department,
          size: `${unit.sizePerPackage} ${unit.sizeUnit}`,
          shade: fg.output.shade ?? null,
          productSku: fg.output.productSku ?? null,
          date: fg.output.productionDate.toISOString(),
          kind: 'FINISHED_GOOD' as const,
        };
        const imageRef = await this.qr.dataUrl(payload);
        await tx.finishedGoodQr.update({
          where: { id: fg.qrCode.id },
          data: { payload: payload as unknown as Prisma.InputJsonValue, imageRef },
        });
      }

      await this.audit.log(
        {
          entityType: 'FinishedGood',
          entityId: fg.id,
          action: 'FG_CORRECTED',
          actorId: user.id,
          before: before as Prisma.InputJsonValue,
          after: {
            ...after,
            uniqueId: fg.uniqueId,
            batchNumber: fg.batch.batchNumber,
            reason: dto.note.trim(),
            labelReprintNeeded: printedChanged,
          } as Prisma.InputJsonValue,
        },
        tx,
      );

      return unit;
    });

    return { unit: corrected, labelReprintNeeded: printedChanged };
  }

  /**
   * Mint one FinishedGood + QR per package for a CONFIRMED output.
   * Hard gate: unconfirmed output cannot generate QRs. Generating twice is blocked via
   * fgGeneratedAt so a double-click can never mint duplicate stickers.
   */
  async generate(user: AuthUser, outputId: string) {
    const output = await this.prisma.productionOutput.findUnique({
      where: { id: outputId },
      include: { batch: true },
    });
    if (!output) throw new NotFoundException('Production output not found');
    assertDepartmentAccess(user, output.batch.department);

    // THE GATE — this is the whole point of the review step.
    if (!output.confirmed) {
      throw new BadRequestException(
        'Confirm the production output before generating finished-goods QR codes.',
      );
    }
    if (output.fgGeneratedAt) {
      throw new ConflictException(
        'QR codes have already been generated for this output. Record an additional output if more was produced.',
      );
    }
    if (!(output.packageCount > 0)) {
      throw new BadRequestException('Package count must be greater than 0.');
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const units: { id: string; uniqueId: string }[] = [];
        for (let i = 0; i < output.packageCount; i++) {
          const rows = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${FG_SEQ}') AS v`);
          const uniqueId = this.formatId(rows[0].v);

          const fg = await tx.finishedGood.create({
            data: {
              uniqueId,
              outputId: output.id,
              batchId: output.batchId,
              productName: output.productName,
              sizePerPackage: output.sizePerPackage,
              sizeUnit: output.sizeUnit,
              status: FgStatus.GENERATED,
            },
          });

          // Explicitly typed so the compiler checks this against what the label
          // renderer reads. It was previously untyped and cast with `as never`,
          // which is exactly how the FG label roll shipped broken.
          const payload: FgQrPayload = {
            uniqueId,
            productName: output.productName,
            batch: output.batch.batchNumber,
            department: output.batch.department,
            size: `${output.sizePerPackage} ${output.sizeUnit}`,
            shade: output.shade ?? null,
            productSku: output.productSku ?? null,
            date: output.productionDate.toISOString(),
            kind: 'FINISHED_GOOD' as const,
          };
          const imageRef = await this.qr.dataUrl(payload);
          await tx.finishedGoodQr.create({
            data: { finishedGoodId: fg.id, payload: payload as unknown as Prisma.InputJsonValue, imageRef },
          });
          units.push({ id: fg.id, uniqueId });
        }

        await tx.productionOutput.update({
          where: { id: output.id },
          data: { fgGeneratedAt: new Date() },
        });
        // Batch is now producing physical goods — mark it closed for normal flow.
        await tx.batch.update({
          where: { id: output.batchId },
          data: { status: BatchStatus.CLOSED },
        });
        return units;
      },
      { timeout: 120_000 }, // large runs (hundreds of drums) need headroom
    );

    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: output.id,
      action: 'FG_QR_GENERATED',
      actorId: user.id,
      after: {
        batchNumber: output.batch.batchNumber,
        productName: output.productName,
        unitCount: created.length,
        firstId: created[0]?.uniqueId ?? null,
        lastId: created.at(-1)?.uniqueId ?? null,
      },
    });

    return { generated: created.length, units: created };
  }

  /** FG units for an output — for on-screen label review. */
  async forOutput(user: AuthUser, outputId: string) {
    const output = await this.prisma.productionOutput.findUnique({
      where: { id: outputId },
      include: { batch: { select: { department: true } } },
    });
    if (!output) throw new NotFoundException('Production output not found');
    assertDepartmentAccess(user, output.batch.department);
    return this.prisma.finishedGood.findMany({
      where: { outputId },
      include: fgInclude,
      orderBy: { uniqueId: 'asc' },
    });
  }

  /** Printable label roll (reuses the existing 3×1.5" one-label-per-page format). */
  async labelRoll(user: AuthUser, outputId: string): Promise<Buffer> {
    const units = await this.forOutput(user, outputId);
    if (units.length === 0) {
      throw new NotFoundException('No finished-goods units to print for this output.');
    }
    return this.qr.buildLabelRoll(
      // Cast through the FG payload type, NOT `as never`. The original `as never`
      // silenced the compiler and let a raw-material-shaped renderer receive an
      // FG payload — which threw at run time on every FG label roll.
      units.map((u) => ({ payload: u.qrCode?.payload as unknown as FgQrPayload })),
    );
  }

  /** List FG units, scoped. Dispatch sees all departments (it ships everything). */
  async list(
    user: AuthUser,
    params: { status?: FgStatus; batchId?: string; search?: string; take?: number } = {},
  ) {
    const take = Math.min(500, Math.max(1, params.take ?? 100));
    const where: Prisma.FinishedGoodWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.search
        ? {
            OR: [
              { uniqueId: { contains: params.search, mode: 'insensitive' } },
              { productName: { contains: params.search, mode: 'insensitive' } },
              { batch: { batchNumber: { contains: params.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...this.scopeFor(user),
    };
    return this.prisma.finishedGood.findMany({
      where,
      include: fgInclude,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Visibility scope for finished goods:
   *  - DISPATCH → all departments (it ships the whole factory's output), FG only
   *  - PRODUCTION_HEAD → own department only
   *  - ADMIN / OVERSIGHT → everything
   */
  private scopeFor(user: AuthUser): Prisma.FinishedGoodWhereInput {
    if (user.role === 'DISPATCH') return {};
    const scope = departmentFilter(user); // throws for roles with no legitimate scope
    return scope.department ? { batch: { department: scope.department } } : {};
  }

  /** One FG unit by its FG- id (used by the dispatch scanner). */
  async findByUniqueId(user: AuthUser, uniqueId: string) {
    const id = uniqueId.trim();
    if (!isFinishedGoodId(id)) {
      throw new BadRequestException(
        `${id} is not a finished-goods code. Raw-material units (MC-) are scanned in Scan & Issue.`,
      );
    }
    const fg = await this.prisma.finishedGood.findUnique({
      where: { uniqueId: id },
      include: fgInclude,
    });
    if (!fg) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
    if (user.role !== 'DISPATCH') assertDepartmentAccess(user, fg.batch.department);
    return fg;
  }
}
