import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { POSource, POStatus, Prisma, SlipStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { CatalogueService } from '../catalogue/catalogue.service';
import {
  AiExtractionService,
  ExtractionError,
  ExtractedLineItem,
} from '../ai-extraction/ai-extraction.service';
import { MaterialService } from '../material/material.service';
import { ReceivingSlipService, SLIP_SOURCE_SELECT } from '../receiving-slip/receiving-slip.service';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly catalogue: CatalogueService,
    private readonly extraction: AiExtractionService,
    private readonly material: MaterialService,
    private readonly slips: ReceivingSlipService,
  ) {}

  async upload(file: Express.Multer.File, actorId: string) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    // Strip CR/LF and path separators from the user-supplied name before storing
    // it (defense-in-depth against header injection / path traversal). The stored
    // object key is always a server-generated UUID, never the original name.
    const safeName =
      (file.originalname || 'po')
        .replace(/[\r\n]+/g, '')
        .replace(/[/\\]/g, '_')
        .trim()
        .slice(0, 255) || 'po';
    const ext = (safeName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `po/${randomUUID()}.${ext || 'bin'}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const po = await this.prisma.purchaseOrder.create({
      data: {
        fileKey: key,
        fileName: safeName,
        status: POStatus.PO_UPLOADED,
        source: POSource.AI,
        uploadedById: actorId,
        // Arrival timestamp is LOCKED: server-stamped at the instant the invoice photo is
        // uploaded, and never editable by anyone thereafter (no route accepts an arrivedAt).
        // This makes it a tamper-proof record of when the goods were photographed in.
        arrivedAt: new Date(),
      },
    });

    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: po.id,
      action: 'PO_UPLOADED',
      actorId,
      after: { fileName: po.fileName, arrivedAt: po.arrivedAt },
    });

    return po;
  }

  /**
   * Every invoice field a caller may see — an explicit ALLOW-LIST, not an exclusion.
   *
   * Prisma returns all scalars when you use `include` without `select`, which is how
   * `fileKey` (the raw R2 storage key) and `extractedJson` (the full extraction payload)
   * were being handed out in the body of GET /purchase-orders and /:id to every Phase-1
   * role. Neither is needed by any caller — the frontend type does not even declare them,
   * and the invoice document is reachable only through the download handler, which reads
   * the key itself rather than trusting one from a response.
   *
   * Adding a field here is a deliberate act. commercial-isolation.spec.ts asserts the two
   * forbidden keys never reappear.
   */
  private static readonly SAFE_FIELDS = {
    id: true,
    poNumber: true,
    supplier: true,
    fileName: true,
    status: true,
    source: true,
    deliveryDate: true,
    arrivedAt: true,
    uploadedById: true,
    confirmedById: true,
    confirmedAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.PurchaseOrderSelect;

  async list(params: {
    status?: POStatus;
    supplier?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    /** Gate sees ONLY his own uploads. Applied here, not in the UI. */
    uploadedById?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
    const where: Prisma.PurchaseOrderWhereInput = {
      status: params.status,
      supplier: params.supplier ? { contains: params.supplier, mode: 'insensitive' } : undefined,
      poNumber: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
      uploadedById: params.uploadedById,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          ...PurchaseOrderService.SAFE_FIELDS,
          uploadedBy: { select: { id: true, name: true } },
          _count: { select: { lineItems: true, materials: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        ...PurchaseOrderService.SAFE_FIELDS,
        lineItems: { include: { matchedCatalogue: true }, orderBy: { createdAt: 'asc' } },
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { materials: true } },
      },
    });
    if (!po) throw new NotFoundException('Invoice not found');
    return po;
  }

  /** The invoice lines a slip may draw from — read through the slip's own allow-list. */
  private slipLines(poId: string) {
    return this.prisma.pOLineItem.findMany({
      where: { poId },
      select: SLIP_SOURCE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async getFile(id: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po || !po.fileKey) throw new NotFoundException('Invoice file not found');
    const buffer = await this.storage.get(po.fileKey);
    return { buffer, fileName: po.fileName ?? 'po', mimeType: this.mimeFor(po.fileName) };
  }

  /**
   * Run AI extraction (Step 2). Populates the editable POLineItem working set —
   * NOT Materials (those are created only on confirm, invariant I1). On failure
   * returns a fallback signal so the operator can enter the PO manually (I7).
   */
  async extract(id: string, actorId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Invoice not found');
    if (!po.fileKey) {
      throw new BadRequestException('This invoice has no uploaded file to extract.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.get(po.fileKey);
    } catch (err) {
      // A storage outage is NOT the operator's fault and must not be a dead end.
      // This previously threw a 400, which both discarded the specific reason the
      // storage layer had worked out and implied "your request was wrong, do not
      // retry" — when in fact retrying after storage recovers would succeed.
      // Return the same fallback signal an AI failure returns, so the operator is
      // routed to manual entry exactly as invariant I7 intends.
      const message =
        err instanceof Error ? err.message : 'The invoice file could not be read from storage.';
      await this.audit.log({
        entityType: 'PurchaseOrder',
        entityId: po.id,
        action: 'AI_EXTRACTION_FAILED',
        actorId,
        after: { reason: 'storage_unavailable', message },
      });
      return { fallback: true, reason: 'storage_unavailable', message };
    }

    try {
      const result = await this.extraction.extract(buffer, this.mimeFor(po.fileName));
      await this.replaceLineItems(po.id, result.lineItems);
      const updated = await this.prisma.purchaseOrder.update({
        where: { id: po.id },
        data: {
          poNumber: result.poNumber ?? undefined,
          supplier: result.supplier ?? undefined,
          deliveryDate: this.parseDate(result.deliveryDate),
          extractedJson: result as unknown as Prisma.InputJsonValue,
          source: POSource.AI,
          status: POStatus.AI_EXTRACTED,
        },
      });
      // The slip is born HERE, as the digital PO: Store never sees the invoice, so this
      // is what it will confirm from. No units exist yet, so no ID ranges.
      await this.slips.generateFromExtraction(
        { id: po.id, supplier: result.supplier ?? po.supplier, arrivedAt: po.arrivedAt, lineItems: await this.slipLines(po.id) },
        actorId,
      );
      await this.audit.log({
        entityType: 'PurchaseOrder',
        entityId: po.id,
        action: 'AI_EXTRACTED',
        actorId,
        after: { lineItemCount: result.lineItems.length },
      });
      return { fallback: false, purchaseOrder: await this.findOne(updated.id) };
    } catch (err) {
      if (err instanceof ExtractionError) {
        await this.audit.log({
          entityType: 'PurchaseOrder',
          entityId: po.id,
          action: 'AI_EXTRACTION_FAILED',
          actorId,
          after: { reason: err.reason, message: err.message },
        });
        // Operator is NOT blocked — they can fall back to manual entry (I7).
        return { fallback: true, reason: err.reason, message: err.message };
      }
      throw err;
    }
  }

  /** Manual fallback entry (I7): operator types the PO; we still run catalogue match. */
  async manualEntry(id: string, dto: ManualEntryDto, actorId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException('Invoice not found');

    const items: ExtractedLineItem[] = dto.lineItems.map((li) => ({
      materialName: li.materialName,
      hsnCode: li.hsnCode ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unit: li.unit ?? null,
      weight: li.weight ?? null,
      batchNumber: li.batchNumber ?? null,
    }));
    await this.replaceLineItems(po.id, items);

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        poNumber: dto.poNumber ?? undefined,
        supplier: dto.supplier ?? undefined,
        deliveryDate: this.parseDate(dto.deliveryDate),
        source: POSource.MANUAL,
        status: POStatus.AI_EXTRACTED, // ready for the same review/confirm gate
      },
    });
    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: po.id,
      action: 'PO_MANUAL_ENTRY',
      actorId,
      after: { lineItemCount: items.length },
    });
    return this.findOne(updated.id);
  }

  /**
   * Create a brand-new PO from typed data — no document uploaded (Option B). Goes
   * straight to AI_EXTRACTED so it enters the SAME review/confirm gate as an AI PO.
   */
  async createManual(dto: ManualEntryDto, actorId: string) {
    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber: dto.poNumber ?? undefined,
        supplier: dto.supplier ?? undefined,
        deliveryDate: this.parseDate(dto.deliveryDate),
        status: POStatus.AI_EXTRACTED,
        source: POSource.MANUAL,
        uploadedById: actorId,
      },
    });

    const items: ExtractedLineItem[] = dto.lineItems.map((li) => ({
      materialName: li.materialName,
      hsnCode: li.hsnCode ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unit: li.unit ?? null,
      weight: li.weight ?? null,
      batchNumber: li.batchNumber ?? null,
    }));
    await this.replaceLineItems(po.id, items);

    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: po.id,
      action: 'PO_MANUAL_CREATED',
      actorId,
      after: { poNumber: po.poNumber, lineItemCount: items.length },
    });
    return this.findOne(po.id);
  }

  // ── Operator review (edit the working set before confirming) ──

  async addLineItem(poId: string, dto: CreateLineItemDto, actorId: string) {
    await this.assertEditable(poId);
    const match = await this.catalogue.match({ materialName: dto.materialName, sku: dto.sku });
    await this.prisma.pOLineItem.create({
      data: {
        poId,
        materialName: dto.materialName,
        hsnCode: dto.hsnCode ?? null,
        sku: dto.sku ?? null,
        quantity: dto.quantity,
        unit: dto.unit ?? null,
        weight: dto.weight ?? null,
        batchNumber: dto.batchNumber ?? null,
        matchType: match.matchType,
        matchedCatalogueId: match.matchedId,
        edited: true,
      },
    });
    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: poId,
      action: 'PO_LINE_ADDED',
      actorId,
      after: { materialName: dto.materialName, quantity: dto.quantity },
    });
    return this.findOne(poId);
  }

  async updateLineItem(poId: string, itemId: string, dto: UpdateLineItemDto, actorId: string) {
    await this.assertEditable(poId);
    const existing = await this.prisma.pOLineItem.findFirst({ where: { id: itemId, poId } });
    if (!existing) throw new NotFoundException('Line item not found');

    const materialName = dto.materialName ?? existing.materialName;
    const sku = dto.sku !== undefined ? dto.sku : existing.sku;
    // Re-match if the identifying fields changed.
    const reMatch = dto.materialName !== undefined || dto.sku !== undefined;
    const match = reMatch
      ? await this.catalogue.match({ materialName, sku })
      : { matchType: existing.matchType, matchedId: existing.matchedCatalogueId };

    await this.prisma.pOLineItem.update({
      where: { id: itemId },
      data: {
        materialName,
        hsnCode: dto.hsnCode !== undefined ? dto.hsnCode : existing.hsnCode,
        sku,
        quantity: dto.quantity ?? existing.quantity,
        unit: dto.unit !== undefined ? dto.unit : existing.unit,
        weight: dto.weight !== undefined ? dto.weight : existing.weight,
        batchNumber: dto.batchNumber !== undefined ? dto.batchNumber : existing.batchNumber,
        matchType: match.matchType,
        matchedCatalogueId: match.matchedId,
        edited: true,
      },
    });
    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: poId,
      action: 'PO_LINE_EDITED',
      actorId,
      before: { materialName: existing.materialName, quantity: existing.quantity },
      after: { materialName, quantity: dto.quantity ?? existing.quantity },
    });
    return this.findOne(poId);
  }

  async deleteLineItem(poId: string, itemId: string, actorId: string) {
    await this.assertEditable(poId);
    const existing = await this.prisma.pOLineItem.findFirst({ where: { id: itemId, poId } });
    if (!existing) throw new NotFoundException('Line item not found');
    await this.prisma.pOLineItem.delete({ where: { id: itemId } });
    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: poId,
      action: 'PO_LINE_DELETED',
      actorId,
      before: { materialName: existing.materialName, quantity: existing.quantity },
    });
    return this.findOne(poId);
  }

  /**
   * THE HARD GATE (invariant I1). Only here — on explicit operator confirm — are
   * Material rows created: one per physical unit (I3) with sequential unique IDs
   * (I8) and a QR each. Runs atomically; PO → OPERATOR_VERIFIED → REGISTERED.
   */
  /**
   * GATE'S CONFIRM & HAND-OVER — the explicit human act that MINTS (invariant I1, relocated
   * to Gate). Gate proofreads the extracted lines against the paper he is holding, then
   * hands the inward to Store: this registers one Material + QR per package (the MC- codes),
   * attaches their ID ranges to the receiving slip, and marks the slip AWAITING_STORE.
   *
   * Units NEVER persist without this explicit human confirm — extraction alone only ever
   * produced a DRAFT slip with no units. The codes now exist BEFORE the slip reaches Store,
   * so the Good Receipt Note the gate prints already carries MC-001…, not "pending".
   *
   * Normally Gate; also reachable by Store when STORE_INWARD_ACCESS is ON (the reversible
   * cutover), enforced by StoreInwardGuard on the route.
   */
  async handOverToStore(actorId: string, poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lineItems: true },
    });
    if (!po) throw new NotFoundException('Invoice not found');
    if (po.status !== POStatus.AI_EXTRACTED) {
      throw new BadRequestException(
        `Proofread the extracted invoice (status AI_EXTRACTED) before handing it to Store; current status is ${po.status}.`,
      );
    }
    if (po.lineItems.length === 0) {
      throw new BadRequestException('Cannot hand over an invoice with no line items.');
    }
    const slip = await this.prisma.receivingSlip.findUnique({ where: { poId }, select: { status: true } });
    if (slip && slip.status !== SlipStatus.DRAFT) {
      throw new ConflictException('This invoice has already been handed to Store.');
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.purchaseOrder.update({
          where: { id: poId },
          // Gate is the human who verified the goods against the paper.
          data: { status: POStatus.OPERATOR_VERIFIED, confirmedById: actorId, confirmedAt: new Date() },
        });
        await this.audit.log(
          { entityType: 'PurchaseOrder', entityId: poId, action: 'OPERATOR_VERIFIED', actorId },
          tx,
        );

        // THE MINTING ACT (I1) — now at Gate's hand-over, not Store's confirm.
        const units = await this.material.registerUnits(tx, po, actorId);
        // Attach the minted ID ranges to the slip and hand it over to Store.
        await this.slips.attachUnits(tx, po, units, actorId);
        await tx.receivingSlip.update({
          where: { poId },
          data: { status: SlipStatus.AWAITING_STORE, handedOverAt: new Date() },
        });

        await tx.purchaseOrder.update({ where: { id: poId }, data: { status: POStatus.REGISTERED } });
        await this.audit.log(
          { entityType: 'PurchaseOrder', entityId: poId, action: 'MATERIALS_REGISTERED', actorId, after: { unitCount: units.length } },
          tx,
        );
        return units;
      },
      { timeout: 120000 },
    );

    return { purchaseOrder: await this.findOne(poId), registeredUnits: created.length };
  }

  /**
   * STORE'S ACCEPT — what "Review & Confirm" became once Gate mints. The units already
   * exist (Gate registered them at hand-over), so this does NOT mint: Store reviews the
   * received Good Receipt Note, accepts custody, and prints. Append-only audited. The
   * physical receiving (scanning the MC- units in at Receive Stock) stays a separate,
   * session-gated step and is unchanged.
   */
  async accept(poId: string, actorId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true, status: true, poNumber: true } });
    if (!po) throw new NotFoundException('Invoice not found');
    if (po.status !== POStatus.REGISTERED) {
      throw new BadRequestException(
        'This inward has not been handed over yet — the Gate must confirm and register it first.',
      );
    }
    // Idempotent: stamp acceptance once. Re-clicking Accept does not re-audit.
    const marked = await this.prisma.receivingSlip.updateMany({
      where: { poId, acceptedAt: null },
      data: { acceptedAt: new Date(), acceptedById: actorId },
    });
    if (marked.count > 0) {
      await this.audit.log({
        entityType: 'PurchaseOrder',
        entityId: poId,
        action: 'STORE_INWARD_ACCEPTED',
        actorId,
        after: { poNumber: po.poNumber },
      });
    }
    return this.findOne(poId);
  }

  // ── helpers ──

  private async assertEditable(poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new NotFoundException('Invoice not found');
    if (po.status !== POStatus.AI_EXTRACTED) {
      throw new BadRequestException(
        `Line items can only be edited before confirmation (status AI_EXTRACTED); current status is ${po.status}.`,
      );
    }
  }

  /** Replace the working-set line items, running catalogue match on each (I6). */
  private async replaceLineItems(poId: string, items: ExtractedLineItem[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.pOLineItem.deleteMany({ where: { poId } });
      for (const item of items) {
        const match = await this.catalogue.match({
          materialName: item.materialName,
          sku: item.sku,
        });
        await tx.pOLineItem.create({
          data: {
            poId,
            materialName: item.materialName,
            hsnCode: item.hsnCode,
            sku: item.sku,
            quantity: item.quantity,
            unit: item.unit,
            weight: item.weight,
            batchNumber: item.batchNumber,
            matchType: match.matchType,
            matchedCatalogueId: match.matchedId,
          },
        });
      }
    });
  }

  private mimeFor(fileName: string | null): string {
    const ext = (fileName?.split('.').pop() ?? '').toLowerCase();
    return EXT_TO_MIME[ext] ?? 'application/pdf';
  }

  private parseDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }
}
