import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FgStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QrService, type FgQrPayload } from '../qr/qr.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { FG_SEQ, formatFgId, isFinishedGoodId } from './finished-goods.service';

const returnInclude = {
  batch: { select: { id: true, batchNumber: true, department: true } },
  output: { select: { id: true, productName: true, productionDate: true, shade: true, productSku: true } },
  returnedBy: { select: { id: true, name: true } },
  refurbishedInto: { select: { uniqueId: true, status: true } },
  refurbishedFrom: { select: { uniqueId: true } },
} satisfies Prisma.FinishedGoodInclude;

/**
 * Returned finished goods (rejected / sent back by a customer).
 *
 * A returned unit ends in exactly one of two ways, both DISPATCH-role actions, both
 * append-only audited with who/when/unit/batch/reason:
 *
 *  - SCRAP    → written off. Terminal. The unit never re-enters inventory.
 *  - REFURBISH → the physical drum goes back into sellable stock, but as a NEW FG unit
 *    with its own FG- identity and QR (it will be dispatched again, and one identity
 *    must never be dispatched twice). The new unit keeps the ORIGINAL batch and output,
 *    and carries `refurbishedFromId` — so it traces to what it really is, and never
 *    looks newly produced. The original's history stays intact under its own ID.
 *
 * Only a DISPATCHED unit can be returned: anything else is still inside the factory,
 * and "returning" it would corrupt the stock story.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly qr: QrService,
  ) {}

  /** Lock + validate the unit being returned. Shared by both outcomes. */
  private async lockReturnable(tx: Prisma.TransactionClient, uniqueId: string) {
    const id = uniqueId.trim();
    if (!isFinishedGoodId(id)) {
      throw new BadRequestException(`${id} is not a finished-goods code. Returns handle FG- units only.`);
    }
    const locked = await tx.$queryRaw<{ id: string; status: FgStatus }[]>`
      SELECT "id", "status" FROM "FinishedGood" WHERE "uniqueId" = ${id} FOR UPDATE`;
    const row = locked[0];
    if (!row) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
    if (row.status === FgStatus.SCRAPPED) throw new ConflictException(`${id} was already scrapped.`);
    if (row.status === FgStatus.REFURBISHED) {
      throw new ConflictException(`${id} was already refurbished into a new unit.`);
    }
    if (row.status !== FgStatus.DISPATCHED) {
      throw new ConflictException(
        `${id} has not been dispatched — only goods that left the factory can be returned.`,
      );
    }
    return row;
  }

  /** Returned unit is written off. Terminal; reason required. */
  async scrap(user: AuthUser, uniqueId: string, note: string, device?: string) {
    const reason = note?.trim();
    if (!reason) throw new BadRequestException('A reason is required to scrap a returned unit.');

    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockReturnable(tx, uniqueId);
      const unit = await tx.finishedGood.update({
        where: { id: row.id },
        data: {
          status: FgStatus.SCRAPPED,
          returnedAt: new Date(),
          returnedById: user.id,
          returnNote: reason,
        },
        include: returnInclude,
      });
      await this.audit.log(
        {
          entityType: 'FinishedGood',
          entityId: unit.id,
          action: 'FG_RETURN_SCRAPPED',
          actorId: user.id,
          device: device ?? null,
          before: { status: row.status },
          after: {
            uniqueId: unit.uniqueId,
            status: FgStatus.SCRAPPED,
            batchNumber: unit.batch.batchNumber,
            productName: unit.productName,
            reason,
          },
        },
        tx,
      );
      return unit;
    });
  }

  /**
   * Returned unit goes back into sellable stock as a NEW unit with a fresh FG identity
   * and QR. Same batch + output as the original (real provenance), linked via
   * refurbishedFromId. The original becomes REFURBISHED — terminal, history intact.
   */
  async refurbish(user: AuthUser, uniqueId: string, note: string, device?: string) {
    const reason = note?.trim();
    if (!reason) throw new BadRequestException('A reason is required to refurbish a returned unit.');

    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockReturnable(tx, uniqueId);
      const original = await tx.finishedGood.findUniqueOrThrow({
        where: { id: row.id },
        include: { batch: true, output: true },
      });

      const seq = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${FG_SEQ}') AS v`);
      const newId = formatFgId(seq[0].v);

      const replacement = await tx.finishedGood.create({
        data: {
          uniqueId: newId,
          outputId: original.outputId, // real origin — never looks newly produced
          batchId: original.batchId,
          productName: original.productName,
          sizePerPackage: original.sizePerPackage,
          sizeUnit: original.sizeUnit,
          status: FgStatus.GENERATED, // back in the dispatch queue as sellable stock
          refurbishedFromId: original.id,
        },
      });

      const payload: FgQrPayload = {
        uniqueId: newId,
        productName: original.productName,
        batch: original.batch.batchNumber,
        department: original.batch.department,
        size: `${original.sizePerPackage} ${original.sizeUnit}`,
        shade: original.output.shade ?? null,
        productSku: original.output.productSku ?? null,
        date: original.output.productionDate.toISOString(),
        kind: 'FINISHED_GOOD' as const,
      };
      const imageRef = await this.qr.dataUrl(payload);
      await tx.finishedGoodQr.create({
        data: {
          finishedGoodId: replacement.id,
          payload: payload as unknown as Prisma.InputJsonValue,
          imageRef,
        },
      });

      const updatedOriginal = await tx.finishedGood.update({
        where: { id: original.id },
        data: {
          status: FgStatus.REFURBISHED,
          returnedAt: new Date(),
          returnedById: user.id,
          returnNote: reason,
        },
        include: returnInclude,
      });

      await this.audit.log(
        {
          entityType: 'FinishedGood',
          entityId: original.id,
          action: 'FG_RETURN_REFURBISHED',
          actorId: user.id,
          device: device ?? null,
          before: { status: row.status },
          after: {
            uniqueId: original.uniqueId,
            status: FgStatus.REFURBISHED,
            replacementUniqueId: newId,
            batchNumber: original.batch.batchNumber,
            productName: original.productName,
            reason,
          },
        },
        tx,
      );

      return { original: updatedOriginal, replacement: { ...replacement, imageRef } };
    });
  }

  /** Recent returns (both outcomes), newest first — the Returns tab history. */
  async history(take = 50) {
    return this.prisma.finishedGood.findMany({
      where: { status: { in: [FgStatus.SCRAPPED, FgStatus.REFURBISHED] } },
      include: returnInclude,
      orderBy: { returnedAt: 'desc' },
      take: Math.min(200, take),
    });
  }
}
