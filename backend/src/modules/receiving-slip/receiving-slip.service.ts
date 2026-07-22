import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, SlipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const SLIP_SEQ = 'receiving_slip_seq';

/** One material as it appeared on the truck. Deliberately free of anything commercial. */
export interface SlipLine {
  materialName: string;
  sku: string | null;
  /** Number of physical packages. */
  quantity: number;
  /** Package word — Bag / Drum / Can. */
  unit: string | null;
  /** Weight of ONE package, in `measure`. Null when the document stated none. */
  packWeight: number | null;
  /** "kg" or "L" — never mixed into a single total anywhere. */
  measure: string;
  /** Unit ID range these packages were minted as, e.g. MC-000101 … MC-000150. */
  idFrom: string;
  idTo: string;
}

export const formatSlipNumber = (n: number | bigint): string => `RS-${String(n).padStart(6, '0')}`;

/**
 * The digital receiving slip — what the gate hands to Store.
 *
 * Store no longer sees the invoice, so this is how it learns what arrived. It carries
 * supplier, date, materials, quantities with kg and L kept separate, pack weights and
 * the minted unit ID ranges — and NO price, amount, HSN or invoice image.
 *
 * `lines` is written by the explicit mapper below, field by field. It is never built by
 * spreading a Prisma record, because that is exactly how `fileKey` and `extractedJson`
 * ended up in an invoice response.
 *
 * The stored payload is denormalised on purpose: a slip records what was physically
 * handed over, so a later catalogue or material edit must not be able to rewrite what
 * the gate guard already printed and carried across the yard.
 */
@Injectable()
export class ReceivingSlipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Generate the slip for a just-registered inward.
   *
   * Called INSIDE the confirm transaction, so a registered invoice always has a slip —
   * there is no window in which Store can see units with no record of where they came
   * from. `units` arrives in line order (registerUnits mints line by line), which is what
   * lets each line report a contiguous ID range; the count assertion below fails loudly
   * rather than emitting a slip whose ranges have quietly drifted.
   */
  async generateForConfirm(
    tx: Prisma.TransactionClient,
    po: {
      id: string;
      supplier: string | null;
      lineItems: {
        materialName: string;
        sku: string | null;
        quantity: number;
        unit: string | null;
        weight: number | null;
      }[];
    },
    units: { uniqueId: string }[],
    actorId: string,
  ) {
    const expected = po.lineItems.reduce((n, l) => n + l.quantity, 0);
    if (units.length !== expected) {
      throw new ConflictException(
        `Slip not generated: ${units.length} units minted but the invoice lines total ${expected}.`,
      );
    }

    const lines: SlipLine[] = [];
    let cursor = 0;
    for (const line of po.lineItems) {
      const slice = units.slice(cursor, cursor + line.quantity);
      cursor += line.quantity;
      if (slice.length === 0) continue;
      lines.push({
        materialName: line.materialName,
        sku: line.sku,
        quantity: line.quantity,
        unit: line.unit,
        packWeight: line.weight,
        // Litres for liquids, kilograms otherwise — the two are shown separately on the
        // slip and are never added together.
        measure: /^(l|ltr|lt|litre|liter)$/i.test(line.unit ?? '') ? 'L' : 'kg',
        idFrom: slice[0].uniqueId,
        idTo: slice[slice.length - 1].uniqueId,
      });
    }

    const [{ v }] = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${SLIP_SEQ}') AS v`);
    const slip = await tx.receivingSlip.create({
      data: {
        slipNumber: formatSlipNumber(v),
        poId: po.id,
        supplier: po.supplier,
        receivedDate: new Date(),
        lines: lines as unknown as Prisma.InputJsonValue,
        unitCount: units.length,
        status: SlipStatus.DRAFT,
        generatedById: actorId,
      },
    });

    await this.audit.log(
      {
        entityType: 'ReceivingSlip',
        entityId: slip.id,
        action: 'RECEIVING_SLIP_GENERATED',
        actorId,
        after: { slipNumber: slip.slipNumber, poId: po.id, unitCount: units.length, lineCount: lines.length },
      },
      tx,
    );
    return slip;
  }

  /**
   * Close the slip when the gate presses Done on its receiving session.
   *
   * The session itself stays client-side and unchanged; this records only how many units
   * were physically scanned in. A slip that is never finalised stays DRAFT and remains
   * fully visible and printable — a gate guard forgetting to press Done must never hide
   * an inward from Store.
   */
  async finalize(user: AuthUser, id: string, scannedCount: number) {
    if (!Number.isInteger(scannedCount) || scannedCount < 0) {
      throw new BadRequestException('Scanned count must be a whole number.');
    }
    const slip = await this.prisma.receivingSlip.findUnique({ where: { id } });
    if (!slip) throw new NotFoundException('No such receiving slip.');
    if (slip.status === SlipStatus.FINALIZED) {
      throw new ConflictException('That slip has already been finalised.');
    }

    const updated = await this.prisma.receivingSlip.update({
      where: { id },
      data: {
        status: SlipStatus.FINALIZED,
        finalizedById: user.id,
        finalizedAt: new Date(),
        scannedCount,
      },
    });
    await this.audit.log({
      entityType: 'ReceivingSlip',
      entityId: slip.id,
      action: 'RECEIVING_SLIP_FINALIZED',
      actorId: user.id,
      before: { status: SlipStatus.DRAFT },
      after: { slipNumber: slip.slipNumber, scannedCount, expected: slip.unitCount },
    });
    return updated;
  }

  /** Slips, newest first — Store's record of what has come in. */
  async list(take = 100) {
    return this.prisma.receivingSlip.findMany({
      orderBy: { receivedDate: 'desc' },
      take: Math.min(200, Math.max(1, take)),
      select: this.SAFE,
    });
  }

  async findOne(id: string) {
    const slip = await this.prisma.receivingSlip.findUnique({ where: { id }, select: this.SAFE });
    if (!slip) throw new NotFoundException('No such receiving slip.');
    return slip;
  }

  /** By invoice — how Store's dashboard finds the slip for a given inward. */
  async findByPo(poId: string) {
    return this.prisma.receivingSlip.findUnique({ where: { poId }, select: this.SAFE });
  }

  /**
   * Every inward, for the Reviewer: the invoice alongside its slip.
   *
   * Includes invoices from BEFORE the slip system existed — they simply have no slip,
   * and the Reviewer is told so rather than the inward being hidden. Nothing is
   * backfilled: a slip is a record of a handover that we did not observe for those.
   */
  async listInwards(take = 200) {
    const pos = await this.prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, take)),
      select: {
        id: true,
        poNumber: true,
        supplier: true,
        fileName: true,
        status: true,
        createdAt: true,
        confirmedAt: true,
        receivingSlip: { select: this.SAFE },
      },
    });
    return pos.map((po) => ({
      ...po,
      hasInvoiceFile: !!po.fileName,
      slip: po.receivingSlip ?? null,
      receivingSlip: undefined,
    }));
  }

  /**
   * Everything a slip may expose. An allow-list, for the same reason the invoice reads
   * use one: so adding a field is a deliberate act rather than a Prisma default.
   */
  private readonly SAFE = {
    id: true,
    slipNumber: true,
    poId: true,
    supplier: true,
    receivedDate: true,
    lines: true,
    unitCount: true,
    status: true,
    generatedAt: true,
    finalizedAt: true,
    scannedCount: true,
    generatedBy: { select: { name: true, email: true } },
    finalizedBy: { select: { name: true, email: true } },
  } satisfies Prisma.ReceivingSlipSelect;
}

/** Roles that may read a slip. Store is the whole point; Gate produced it. */
export const SLIP_READERS = [Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER] as const;
