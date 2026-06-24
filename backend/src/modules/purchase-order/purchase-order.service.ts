import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { POSource, POStatus, Prisma } from '@prisma/client';
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
import { ManualEntryDto } from './dto/manual-entry.dto';

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
      },
    });

    await this.audit.log({
      entityType: 'PurchaseOrder',
      entityId: po.id,
      action: 'PO_UPLOADED',
      actorId,
      after: { fileName: po.fileName },
    });

    return po;
  }

  async list(params: { status?: POStatus; supplier?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
    const where: Prisma.PurchaseOrderWhereInput = {
      status: params.status,
      supplier: params.supplier ? { contains: params.supplier, mode: 'insensitive' } : undefined,
      poNumber: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
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
      include: {
        lineItems: { include: { matchedCatalogue: true }, orderBy: { createdAt: 'asc' } },
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { materials: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async getFile(id: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po || !po.fileKey) throw new NotFoundException('PO file not found');
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
    if (!po) throw new NotFoundException('Purchase order not found');
    if (!po.fileKey) {
      throw new BadRequestException('This PO has no uploaded file to extract.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.get(po.fileKey);
    } catch {
      throw new BadRequestException('PO file could not be read from storage.');
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
    if (!po) throw new NotFoundException('Purchase order not found');

    const items: ExtractedLineItem[] = dto.lineItems.map((li) => ({
      materialName: li.materialName,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unit: li.unit ?? null,
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

  // ── helpers ──

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
            sku: item.sku,
            quantity: item.quantity,
            unit: item.unit,
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
