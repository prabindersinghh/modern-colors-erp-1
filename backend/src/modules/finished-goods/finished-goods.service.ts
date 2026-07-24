import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { BatchStatus, FgFamily, FgStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LabelReprintService } from '../label-reprint/label-reprint.service';
import { QrService, type FgQrPayload } from '../qr/qr.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { assertDepartmentAccess, departmentFilter } from '../../common/auth/department-scope';
import { CorrectFinishedGoodDto } from './dto/correct-finished-good.dto';

// Family identity (sequences, prefixes, the FG-/FGHD-/FGTH- check) lives in fg-family.ts.
// Re-exported here so existing importers keep working; `isFinishedGoodId` now spans all
// three families, so the dispatch scanner and returns accept hardener/thinner too.
import { FAMILY_META, formatFamilyId, familyOfId, isFinishedGoodId } from './fg-family';
export { isFinishedGoodId, familyOfId } from './fg-family';

/** The paint family's sequence + id formatter — kept for callers that only mean FG-. */
export const FG_SEQ = FAMILY_META.FINISHED_GOOD.seq;
export const FG_PREFIX = FAMILY_META.FINISHED_GOOD.prefix;
export function formatFgId(n: number | bigint): string {
  return formatFamilyId('FINISHED_GOOD', n);
}

const fgInclude = {
  batch: { select: { id: true, batchNumber: true, department: true } },
  output: { select: { id: true, productName: true, productionDate: true, shade: true, productSku: true } },
  dispatchedBy: { select: { id: true, name: true } },
  qrCode: { select: { payload: true, imageRef: true } },
  // Refurbishment lineage — a returned drum's old and new identities stay linked.
  refurbishedFrom: { select: { uniqueId: true } },
  refurbishedInto: { select: { uniqueId: true, status: true } },
  // Packing-stage backward trace — "packed in PG-000012", if any.
  cartonItem: { select: { carton: { select: { uniqueId: true, status: true, dispatchedAt: true } } } },
} satisfies Prisma.FinishedGoodInclude;

@Injectable()
export class FinishedGoodsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly qr: QrService,
    private readonly reprints: LabelReprintService,
  ) {}

  async onModuleInit() {
    // Ensure every family's sequence exists (paint, hardener, thinner).
    for (const meta of Object.values(FAMILY_META)) {
      await this.prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${meta.seq} START 1`);
    }
  }

  private formatId(n: number | bigint): string {
    return formatFgId(n);
  }

  /**
   * Single-unit label PDF (3×1.5in) — reprints and refurbished-unit stickers.
   *
   * A refurbished unit is newly minted, so this is its FIRST print and passes freely.
   * For a unit whose label was already printed, the reprint lock applies — unless a
   * correction flagged `qrReprintNeeded`, which carries its own single-use allowance
   * because the correction is what made the sticker on the drum wrong. Clearing that
   * flag now happens inside consumePrint, so "the flag was cleared" and "a print was
   * recorded" can never disagree.
   */
  async unitLabel(user: AuthUser, uniqueId: string): Promise<Buffer> {
    const fg = await this.findByUniqueId(user, uniqueId);
    if (!fg.qrCode?.payload) throw new NotFoundException(`No QR payload stored for ${uniqueId}`);
    const scope = { kind: 'FG_UNIT_LABEL', finishedGoodId: fg.id } as const;
    await this.reprints.assertMayPrint(scope);
    const pdf = await this.qr.buildLabelRoll([{ payload: fg.qrCode.payload as unknown as FgQrPayload }]);
    await this.reprints.consumePrint(scope, user.id, 'PDF');
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
   * Mint the finished goods for a CONFIRMED output — across all THREE families in one
   * transaction: paint (FG-) × packageCount, hardener (FGHD-) × hardenerCount, thinner
   * (FGTH-) × thinnerCount. Each family draws from its own sequence and carries its own
   * pack size + unit (kg/L never blended). A family with a zero count mints nothing, so an
   * output that produced no hardener behaves exactly as before.
   *
   * Hard gate: an unconfirmed output cannot generate. `fgGeneratedAt` blocks a second run
   * for the WHOLE lot, so a double-click can never mint duplicate stickers of any family.
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

    // The three families this output mints, each with its OWN count, size and unit. Paint
    // always uses the base size/unit; hardener/thinner use theirs, falling back to the
    // paint unit only if the head left it blank (never blends a value across families).
    const plan: { family: FgFamily; count: number; name: string; size: number; unit: string }[] = [
      { family: FgFamily.FINISHED_GOOD, count: output.packageCount, name: output.productName, size: output.sizePerPackage, unit: output.sizeUnit },
      { family: FgFamily.HARDENER, count: output.hardenerCount, name: `${output.productName} — Hardener`, size: output.hardenerSize ?? output.sizePerPackage, unit: output.hardenerUnit ?? output.sizeUnit },
      { family: FgFamily.THINNER, count: output.thinnerCount, name: `${output.productName} — Thinner`, size: output.thinnerSize ?? output.sizePerPackage, unit: output.thinnerUnit ?? output.sizeUnit },
    ].filter((p) => p.count > 0);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const units: { id: string; uniqueId: string; family: FgFamily }[] = [];
        for (const line of plan) {
          for (let i = 0; i < line.count; i++) {
            const rows = await tx.$queryRawUnsafe<{ v: bigint }[]>(
              `SELECT nextval('${FAMILY_META[line.family].seq}') AS v`,
            );
            const uniqueId = formatFamilyId(line.family, rows[0].v);

            const fg = await tx.finishedGood.create({
              data: {
                uniqueId,
                family: line.family,
                outputId: output.id,
                batchId: output.batchId,
                productName: line.name,
                sizePerPackage: line.size,
                sizeUnit: line.unit,
                status: FgStatus.GENERATED,
              },
            });

            // Explicitly typed so the compiler checks this against what the label
            // renderer reads. `kind` is the label-SHAPE discriminator (all three families
            // print on the FG label), NOT the family — family shows via the id prefix.
            const payload: FgQrPayload = {
              uniqueId,
              productName: line.name,
              batch: output.batch.batchNumber,
              department: output.batch.department,
              size: `${line.size} ${line.unit}`,
              shade: output.shade ?? null,
              productSku: output.productSku ?? null,
              date: output.productionDate.toISOString(),
              kind: 'FINISHED_GOOD' as const,
            };
            const imageRef = await this.qr.dataUrl(payload);
            await tx.finishedGoodQr.create({
              data: { finishedGoodId: fg.id, payload: payload as unknown as Prisma.InputJsonValue, imageRef },
            });
            units.push({ id: fg.id, uniqueId, family: line.family });
          }
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

    const countByFamily = (f: FgFamily) => created.filter((u) => u.family === f).length;
    await this.audit.log({
      entityType: 'ProductionOutput',
      entityId: output.id,
      action: 'FG_QR_GENERATED',
      actorId: user.id,
      after: {
        batchNumber: output.batch.batchNumber,
        productName: output.productName,
        unitCount: created.length,
        // Per-family breakdown, never a blended total — the counts are of different things.
        finishedPaint: countByFamily('FINISHED_GOOD'),
        hardener: countByFamily('HARDENER'),
        thinner: countByFamily('THINNER'),
        firstId: created[0]?.uniqueId ?? null,
        lastId: created.at(-1)?.uniqueId ?? null,
      },
    });

    return {
      generated: created.length,
      byFamily: {
        FINISHED_GOOD: countByFamily('FINISHED_GOOD'),
        HARDENER: countByFamily('HARDENER'),
        THINNER: countByFamily('THINNER'),
      },
      units: created,
    };
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
    const scope = { kind: 'FG_OUTPUT_LABELS', outputId } as const;
    await this.reprints.assertMayPrint(scope);
    const pdf = await this.qr.buildLabelRoll(
      // Cast through the FG payload type, NOT `as never`. The original `as never`
      // silenced the compiler and let a raw-material-shaped renderer receive an
      // FG payload — which threw at run time on every FG label roll.
      units.map((u) => ({ payload: u.qrCode?.payload as unknown as FgQrPayload })),
    );
    await this.reprints.consumePrint(scope, user.id, 'PDF');
    return pdf;
  }

  /**
   * OVERSIGHT label PREVIEW for a finished-goods output — watermarked, and NOT the print
   * path: no assertMayPrint, no consumePrint, so viewing spends no reprint allowance and
   * yields no clean printable sheet. Audited LABEL_VIEWED. The real print path (labelRoll
   * above) is untouched.
   */
  async previewLabelRoll(user: AuthUser, outputId: string): Promise<Buffer> {
    const units = await this.forOutput(user, outputId);
    if (units.length === 0) {
      throw new NotFoundException('No finished-goods units to preview for this output.');
    }
    const roll = await this.qr.buildLabelRoll(
      units.map((u) => ({ payload: u.qrCode?.payload as unknown as FgQrPayload })),
    );
    const pdf = await this.qr.watermark(roll, 'OVERSIGHT VIEW - NOT FOR PRINT');
    await this.audit.log({
      entityType: 'Label',
      entityId: outputId,
      action: 'LABEL_VIEWED',
      actorId: user.id,
      after: { scope: 'FG_OUTPUT_LABELS', unitCount: units.length },
    });
    return pdf;
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
