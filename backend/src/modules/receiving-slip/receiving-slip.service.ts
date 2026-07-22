import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SlipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { buildSlipPdf } from './slip-pdf';

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
  /** Unit ID range, once Store has confirmed. Null before then — no unit exists yet. */
  idFrom: string | null;
  idTo: string | null;
}

/** The invoice fields a slip line may draw from. Nothing commercial is listed. */
export const SLIP_SOURCE_SELECT = {
  materialName: true,
  sku: true,
  quantity: true,
  unit: true,
  weight: true,
} satisfies Prisma.POLineItemSelect;

export type SlipSourceLine = {
  materialName: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  weight: number | null;
};

/**
 * The ONLY place an invoice line becomes a slip line — field by field, deliberately.
 * Never a spread of a Prisma record, which is exactly how `fileKey` and `extractedJson`
 * once reached an invoice response.
 */
export const toSlipLine = (l: SlipSourceLine): SlipLine => ({
  materialName: l.materialName,
  sku: l.sku,
  quantity: l.quantity,
  unit: l.unit,
  packWeight: l.weight,
  // Litres for liquids, kilograms otherwise — labelled per line, never summed together.
  measure: /^(l|ltr|lt|litre|liter)$/i.test(l.unit ?? '') ? 'L' : 'kg',
  idFrom: null,
  idTo: null,
});

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
   * The slip is BORN AT EXTRACTION, as the digital PO.
   *
   * It is no longer a by-product of confirming — it is what Store confirms FROM, because
   * Store never sees the invoice. At this point no unit exists, so there are no ID ranges
   * and no unitCount; those attach in {@link attachUnits} when Store confirms.
   *
   * Idempotent: re-extracting refreshes a DRAFT rather than minting a second slip, and
   * refuses to touch one Gate has already handed over.
   */
  async generateFromExtraction(
    po: { id: string; supplier: string | null; lineItems: SlipSourceLine[] },
    actorId: string,
  ) {
    const lines = po.lineItems.map(toSlipLine);
    const existing = await this.prisma.receivingSlip.findUnique({ where: { poId: po.id } });
    if (existing) {
      // Handed over means proofread: Store's copy must not change underneath it.
      if (existing.status !== SlipStatus.DRAFT) return existing;
      return this.prisma.receivingSlip.update({
        where: { poId: po.id },
        data: { lines: lines as unknown as Prisma.InputJsonValue, supplier: po.supplier },
      });
    }

    const [{ v }] = await this.prisma.$queryRawUnsafe<{ v: bigint }[]>(
      `SELECT nextval('${SLIP_SEQ}') AS v`,
    );
    const slip = await this.prisma.receivingSlip.create({
      data: {
        slipNumber: formatSlipNumber(v),
        poId: po.id,
        supplier: po.supplier,
        receivedDate: new Date(),
        lines: lines as unknown as Prisma.InputJsonValue,
        status: SlipStatus.DRAFT,
        generatedById: actorId,
      },
    });

    await this.audit.log({
      entityType: 'ReceivingSlip',
      entityId: slip.id,
      action: 'RECEIVING_SLIP_GENERATED',
      actorId,
      after: { slipNumber: slip.slipNumber, poId: po.id, lineCount: lines.length },
    });
    return slip;
  }

  /**
   * Gate's proofread is done: "Looks right — send to Store".
   *
   * The snapshot Store works from is taken HERE, after the proofread, so Store always
   * sees the corrected version. From this moment Gate's line edits are refused.
   */
  async sendToStore(user: AuthUser, poId: string) {
    const slip = await this.prisma.receivingSlip.findUnique({ where: { poId } });
    if (!slip) throw new NotFoundException('No slip for this invoice.');
    if (slip.status !== SlipStatus.DRAFT) {
      throw new ConflictException('This slip has already been handed to Store.');
    }
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { supplier: true, lineItems: { select: SLIP_SOURCE_SELECT, orderBy: { createdAt: 'asc' } } },
    });
    if (!po?.lineItems.length) throw new BadRequestException('There are no lines to hand over.');

    const updated = await this.prisma.receivingSlip.update({
      where: { poId },
      data: {
        status: SlipStatus.AWAITING_STORE,
        handedOverAt: new Date(),
        supplier: po.supplier,
        lines: po.lineItems.map(toSlipLine) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      entityType: 'ReceivingSlip',
      entityId: slip.id,
      action: 'RECEIVING_SLIP_SENT_TO_STORE',
      actorId: user.id,
      before: { status: SlipStatus.DRAFT },
      after: { slipNumber: slip.slipNumber, lineCount: po.lineItems.length },
    });
    return updated;
  }

  /**
   * Gate may only edit while the slip is still his. Server-side, because a proofread
   * that the UI merely hides is not a proofread.
   */
  async assertGateMayEdit(poId: string) {
    const slip = await this.prisma.receivingSlip.findUnique({
      where: { poId },
      select: { status: true },
    });
    if (slip && slip.status !== SlipStatus.DRAFT) {
      throw new ForbiddenException(
        'This invoice has been handed to Store. Ask Store to correct it during Review & Confirm.',
      );
    }
  }

  /**
   * Store confirmed: the unit ID ranges attach to the lines they came from.
   *
   * Runs inside the confirm transaction. `units` arrives in line order, which is what
   * lets each line report a contiguous range; the count assertion fails loudly rather
   * than emitting ranges that have quietly drifted.
   */
  async attachUnits(
    tx: Prisma.TransactionClient,
    po: { id: string; lineItems: SlipSourceLine[] },
    units: { uniqueId: string }[],
    actorId: string,
  ) {
    const expected = po.lineItems.reduce((n, l) => n + l.quantity, 0);
    if (units.length !== expected) {
      throw new ConflictException(
        `Slip not updated: ${units.length} units minted but the lines total ${expected}.`,
      );
    }
    const lines: SlipLine[] = [];
    let cursor = 0;
    for (const line of po.lineItems) {
      const slice = units.slice(cursor, cursor + line.quantity);
      cursor += line.quantity;
      lines.push({
        ...toSlipLine(line),
        idFrom: slice[0]?.uniqueId ?? null,
        idTo: slice.at(-1)?.uniqueId ?? null,
      });
    }
    // A slip normally already exists (born at extraction). Manual-entry invoices and
    // anything confirmed before the slip system have none, so one is created here —
    // history must not go dark just because it predates the lifecycle change.
    const data = {
      lines: lines as unknown as Prisma.InputJsonValue,
      unitCount: units.length,
      confirmedAt: new Date(),
    };
    const existing = await tx.receivingSlip.findUnique({ where: { poId: po.id } });
    let slip;
    if (existing) {
      slip = await tx.receivingSlip.update({ where: { poId: po.id }, data });
    } else {
      const [{ v }] = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${SLIP_SEQ}') AS v`);
      slip = await tx.receivingSlip.create({
        data: {
          ...data,
          slipNumber: formatSlipNumber(v),
          poId: po.id,
          receivedDate: new Date(),
          status: SlipStatus.AWAITING_STORE,
          generatedById: actorId,
        },
      });
    }
    await this.audit.log(
      {
        entityType: 'ReceivingSlip',
        entityId: slip.id,
        action: 'RECEIVING_SLIP_UNITS_ATTACHED',
        actorId,
        after: { slipNumber: slip.slipNumber, unitCount: units.length },
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

  /**
   * The printable slip — ONE renderer, shared by Store and Gate.
   *
   * Gate is scoped to invoices HE uploaded: a gate guard may print the paper for the
   * truck he is standing next to, and nothing else. Checked here rather than in the
   * controller so the rule travels with the data, and enforced server-side because a
   * hidden button is not a permission.
   */
  async printable(user: AuthUser, id: string): Promise<{ pdf: Buffer; fileName: string }> {
    const slip = await this.prisma.receivingSlip.findUnique({
      where: { id },
      select: {
        slipNumber: true,
        supplier: true,
        receivedDate: true,
        status: true,
        unitCount: true,
        scannedCount: true,
        lines: true,
        po: { select: { uploadedById: true } },
        generatedBy: { select: { name: true, email: true } },
      },
    });
    if (!slip) throw new NotFoundException('No such receiving slip.');

    if (user.role === Role.OPERATOR && slip.po?.uploadedById !== user.id) {
      throw new ForbiddenException('You can only print slips for invoices you uploaded.');
    }

    const pdf = await buildSlipPdf({
      slipNumber: slip.slipNumber,
      supplier: slip.supplier,
      receivedDate: slip.receivedDate,
      status: slip.status,
      unitCount: slip.unitCount,
      scannedCount: slip.scannedCount,
      lines: slip.lines as unknown as SlipLine[],
      generatedBy: slip.generatedBy,
    });
    return { pdf, fileName: `${slip.slipNumber}.pdf` };
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
    handedOverAt: true,
    confirmedAt: true,
    finalizedAt: true,
    scannedCount: true,
    generatedBy: { select: { name: true, email: true } },
    finalizedBy: { select: { name: true, email: true } },
  } satisfies Prisma.ReceivingSlipSelect;
}

/** Roles that may read a slip. Store is the whole point; Gate produced it. */
export const SLIP_READERS = [Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER] as const;
