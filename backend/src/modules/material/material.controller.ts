import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { MaterialStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MaterialService } from './material.service';
import { QrService, QrPayload, LabelInput } from '../qr/qr.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaterialController {
  constructor(
    private readonly materials: MaterialService,
    private readonly qr: QrService,
  ) {}

  @Get('materials')
  list(
    @Query('status') status?: MaterialStatus,
    @Query('poId') poId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.materials.list({
      status,
      poId,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('materials/:id')
  findOne(@Param('id') id: string) {
    return this.materials.findOne(id);
  }

  // Units of a PO with their QR image refs — for on-screen label review.
  @Get('purchase-orders/:poId/units')
  async units(@Param('poId') poId: string) {
    const materials = await this.materials.forPurchaseOrder(poId);
    return materials.map((m) => ({
      id: m.id,
      uniqueId: m.uniqueId,
      materialName: m.materialName,
      sku: m.sku,
      hsnCode: m.hsnCode,
      supplier: m.supplier,
      unit: m.unit,
      weight: m.weight,
      status: m.status,
      qrImage: m.qrCode?.imageRef ?? null,
    }));
  }

  // Single unit's QR as a PNG — individual download / print-shop use (item 12).
  @Get('materials/:id/qr.png')
  async qrPng(@Param('id') id: string): Promise<StreamableFile> {
    const material = await this.materials.findOne(id);
    const png = await this.qr.pngBuffer(this.payloadFor(material));
    const safe = material.uniqueId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(png, {
      type: 'image/png',
      disposition: `attachment; filename="${safe}.png"`,
    });
  }

  // Printable QR label sheet (PDF) — 3×1.5" stickers, all units of a PO (item 11).
  @Get('purchase-orders/:poId/labels.pdf')
  async labels(@Param('poId') poId: string): Promise<StreamableFile> {
    const items = await this.labelItems(poId);
    const pdf = await this.qr.buildLabelSheet(items);
    const safePoId = poId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="labels-${safePoId}.pdf"`,
    });
  }

  // Individual QR PNGs (one per unit, named by unique ID) bundled as a ZIP (item 12).
  @Get('purchase-orders/:poId/labels.zip')
  async labelsZip(@Param('poId') poId: string): Promise<StreamableFile> {
    const items = await this.labelItems(poId);
    const zip = await this.qr.buildLabelsZip(items);
    const safePoId = poId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="qr-codes-${safePoId}.zip"`,
    });
  }

  // ── helpers ──
  private async labelItems(poId: string): Promise<LabelInput[]> {
    const materials = await this.materials.forPurchaseOrder(poId);
    if (materials.length === 0) throw new NotFoundException('No units for this purchase order');
    return materials.map((m) => ({ payload: this.payloadFor(m) }));
  }

  private payloadFor(m: {
    uniqueId: string;
    materialName: string;
    sku: string | null;
    hsnCode: string | null;
    supplier: string | null;
    batchNumber: string | null;
    createdAt: Date;
    qrCode?: { payload: unknown } | null;
    po?: { poNumber: string | null } | null;
  }): QrPayload {
    const stored = m.qrCode?.payload as QrPayload | undefined;
    if (stored && stored.uniqueId) return stored;
    return {
      uniqueId: m.uniqueId,
      materialName: m.materialName,
      sku: m.sku,
      hsnCode: m.hsnCode,
      supplier: m.supplier,
      poNumber: m.po?.poNumber ?? null,
      batch: m.batchNumber,
      date: m.createdAt.toISOString(),
    };
  }
}
