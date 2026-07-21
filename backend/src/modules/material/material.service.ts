import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { MaterialStatus, Prisma, PurchaseOrder, POLineItem } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QrService } from '../qr/qr.service';

const SEQ = 'material_unique_seq';

type PoWithLines = PurchaseOrder & { lineItems: POLineItem[] };

/**
 * Whether a unit's stock is measured in litres or kilograms, inferred from the PO line's
 * unit text. Liquids (solvents) arrive stated in litres; everything else defaults to kg.
 * Best-effort — a head can still request the material in the right unit regardless, and
 * the stored balance is the same number either way (only the label differs).
 */
export function deriveStockUnit(unitText: string | null | undefined): string {
  return /^\s*(l|lt|ltr|ltrs|litre|litres|liter|liters)\b\.?/i.test(unitText ?? '')
    ? 'L'
    : 'kg';
}

@Injectable()
export class MaterialService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly qr: QrService,
  ) {}

  // Global sequence backs the unique-ID generator (concurrency-safe, I8).
  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${SEQ} START 1`);
  }

  private formatId(n: number | bigint): string {
    return `MC-${String(n).padStart(6, '0')}`;
  }

  /**
   * Register one Material per physical unit for a confirmed PO (I3) — runs inside
   * the caller's transaction. Generates a QR per unit and audits each registration.
   * Returns the created materials.
   */
  async registerUnits(
    tx: Prisma.TransactionClient,
    po: PoWithLines,
    actorId: string,
  ) {
    const created: { id: string; uniqueId: string }[] = [];

    for (const line of po.lineItems) {
      for (let u = 0; u < line.quantity; u++) {
        const rows = await tx.$queryRawUnsafe<{ v: bigint }[]>(
          `SELECT nextval('${SEQ}') AS v`,
        );
        const uniqueId = this.formatId(rows[0].v);

        // OPENING STOCK BALANCE.
        // Receiving no longer weighs each sack (a truckload can be 2,500 of them), so a
        // unit's opening balance is the PO's per-package weight, applied at registration.
        // The unit therefore arrives already carrying stock instead of waiting for a
        // manual weigh step.
        //
        // A line with no usable weight still registers and still scans — it simply gets
        // a NULL balance, which stock.service already refuses to move (see the
        // "no confirmed weight yet" guard). Those units are surfaced by
        // GET /materials/needs-weight so they can be fixed rather than silently lost.
        // We never write 0: zero is a real balance meaning "empty", and it would let an
        // unweighed sack pass the null check while issuing nothing.
        const openingBalance =
          line.weight != null && line.weight > 0 ? line.weight : null;

        const material = await tx.material.create({
          data: {
            uniqueId,
            poId: po.id,
            materialName: line.materialName,
            sku: line.sku,
            hsnCode: line.hsnCode,
            supplier: po.supplier,
            batchNumber: line.batchNumber,
            unit: line.unit,
            weight: line.weight,
            balanceKg: openingBalance,
            stockUnit: deriveStockUnit(line.unit),
            status: MaterialStatus.REGISTERED,
          },
        });

        const payload = {
          uniqueId,
          materialName: material.materialName,
          sku: material.sku,
          hsnCode: material.hsnCode,
          supplier: material.supplier,
          poNumber: po.poNumber,
          batch: material.batchNumber,
          date: new Date().toISOString(),
        };
        const imageRef = await this.qr.dataUrl(payload);
        await tx.qrCode.create({
          data: {
            materialId: material.id,
            payload: payload as unknown as Prisma.InputJsonValue,
            imageRef,
          },
        });

        await this.audit.log(
          {
            entityType: 'Material',
            entityId: material.id,
            action: 'MATERIAL_REGISTERED',
            actorId,
            after: { uniqueId, materialName: material.materialName },
          },
          tx,
        );

        created.push({ id: material.id, uniqueId });
      }
    }

    return created;
  }

  async list(params: {
    status?: MaterialStatus;
    poId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const where: Prisma.MaterialWhereInput = {
      status: params.status,
      poId: params.poId,
      OR: params.search
        ? [
            { uniqueId: { contains: params.search, mode: 'insensitive' } },
            { materialName: { contains: params.search, mode: 'insensitive' } },
            { sku: { contains: params.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.material.findMany({
        where,
        orderBy: { uniqueId: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.material.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Units blocked from stock because they arrived with no usable weight.
   *
   * Grouped by PO line (material + PO), because that is the unit of repair: the
   * operator sets ONE pack weight for the line and every sack on it becomes issuable.
   * Listing 200 individual sacks would be unusable.
   */
  async needsWeight() {
    const units = await this.prisma.material.findMany({
      where: {
        balanceKg: null,
        // Only units that have actually arrived — a REGISTERED unit that is still on
        // the supplier's truck is not yet a problem to chase.
        status: { in: [MaterialStatus.SCANNED, MaterialStatus.READY_FOR_PRODUCTION] },
      },
      select: {
        id: true,
        uniqueId: true,
        materialName: true,
        sku: true,
        unit: true,
        poId: true,
        arrivedAt: true,
        po: { select: { poNumber: true, supplier: true } },
      },
      orderBy: [{ poId: 'asc' }, { uniqueId: 'asc' }],
    });

    // Collapse to one row per PO line so the fix is one entry, not one per sack.
    const groups = new Map<
      string,
      {
        poId: string;
        poNumber: string | null;
        supplier: string | null;
        materialName: string;
        sku: string | null;
        unit: string | null;
        unitCount: number;
        uniqueIds: string[];
      }
    >();
    for (const u of units) {
      const key = `${u.poId}::${u.sku ?? u.materialName}`;
      const g = groups.get(key) ?? {
        poId: u.poId,
        poNumber: u.po?.poNumber ?? null,
        supplier: u.po?.supplier ?? null,
        materialName: u.materialName,
        sku: u.sku,
        unit: u.unit,
        unitCount: 0,
        uniqueIds: [],
      };
      g.unitCount += 1;
      // Cap the sample so a 2,500-sack line does not return 2,500 ids.
      if (g.uniqueIds.length < 5) g.uniqueIds.push(u.uniqueId);
      groups.set(key, g);
    }

    return {
      totalUnits: units.length,
      lines: [...groups.values()].sort((a, b) => b.unitCount - a.unitCount),
    };
  }

  /**
   * Repair a PO line whose units arrived with no weight: set the per-package weight
   * ONCE and every not-yet-moved unit on that line becomes issuable.
   *
   * This is the fix for the queue above. It is deliberately scoped to units that have
   * NOT moved — a unit with stock history has a balance that reflects real consumption,
   * and overwriting it here would silently rewrite the ledger's story. Those are
   * corrected individually through ReceivingService.weigh(), which adjusts by delta.
   */
  async setLineWeight(
    poId: string,
    match: { sku?: string | null; materialName: string },
    weightKg: number,
    actorId: string,
  ) {
    if (!(weightKg > 0)) {
      throw new BadRequestException('Pack weight must be greater than 0.');
    }

    const where = {
      poId,
      balanceKg: null,
      ...(match.sku ? { sku: match.sku } : { materialName: match.materialName, sku: null }),
    } as const;

    const targets = await this.prisma.material.findMany({
      where,
      select: { id: true, uniqueId: true },
    });
    if (targets.length === 0) {
      return { updated: 0, uniqueIds: [] as string[] };
    }

    await this.prisma.material.updateMany({
      where,
      data: { weight: weightKg, balanceKg: weightKg },
    });

    // Keep the PO line in step so a re-print or re-read of the invoice agrees.
    await this.prisma.pOLineItem.updateMany({
      where: {
        poId,
        ...(match.sku ? { sku: match.sku } : { materialName: match.materialName, sku: null }),
      },
      data: { weight: weightKg, edited: true },
    });

    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: poId,
      action: 'PACK_WEIGHT_SET',
      actorId,
      after: {
        materialName: match.materialName,
        sku: match.sku ?? null,
        weightKg,
        unitsUpdated: targets.length,
        balanceSource: 'OPERATOR_PACK_WEIGHT',
      },
    });

    return { updated: targets.length, uniqueIds: targets.map((t) => t.uniqueId) };
  }

  async findOne(id: string) {
    const material = await this.prisma.material.findFirst({
      where: { OR: [{ id }, { uniqueId: id }] },
      include: { qrCode: true, po: { select: { poNumber: true, supplier: true } } },
    });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  /** Materials for a PO, with their QR payloads — used to build label sheets. */
  forPurchaseOrder(poId: string) {
    return this.prisma.material.findMany({
      where: { poId },
      include: { qrCode: true },
      orderBy: { uniqueId: 'asc' },
    });
  }
}
