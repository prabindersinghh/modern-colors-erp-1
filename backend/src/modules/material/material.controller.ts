import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { MaterialStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StoreInwardGuard } from '../../common/guards/store-inward.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MaterialService } from './material.service';
import { QrService, QrPayload, LabelInput } from '../qr/qr.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SetPackWeightDto } from './dto/set-pack-weight.dto';
import { LabelReprintService } from '../label-reprint/label-reprint.service';

/**
 * Raw-material units, QR images and label sheets. These are Phase 1 + oversight data:
 * the Store (ADMIN), Operators, Supervisors and the view-only Admin. Production heads
 * do not browse raw units directly, and the Phase 3 DISPATCH role must never see raw
 * material at all — the class-level gate below enforces that server-side.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
// Gate is OFF this controller entirely after the re-cut: no materials browsing, no
// labels, no pack weight. Printing and the needs-weight queue are Store's.
@Roles(Role.ADMIN, Role.SUPERVISOR, Role.OVERSIGHT)
export class MaterialController {
  constructor(
    private readonly materials: MaterialService,
    private readonly qr: QrService,
    private readonly reprints: LabelReprintService,
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

  /**
   * Units that arrived with no usable weight and are therefore BLOCKED from being
   * issued to production.
   *
   * Receiving no longer weighs each sack — a unit's opening balance comes from the PO's
   * per-package weight. When a document genuinely states no pack size (a bulk invoice
   * like "2,300 KG"), the unit still registers and still scans, but has a null balance
   * and cannot move. This is the queue that makes those visible so they get fixed,
   * rather than being discovered later at the issue desk.
   *
   * Placed BEFORE 'materials/:id' — Nest matches routes in declaration order, and
   * 'needs-weight' would otherwise be captured as an :id.
   */
  @Get('materials/needs-weight')
  needsWeight() {
    return this.materials.needsWeight();
  }

  /**
   * Set the per-package weight for one PO line, fixing every un-moved unit on it at
   * once. This is the operator's repair action from the needs-weight queue — ONE entry
   * per line rather than per sack.
   */
  /**
   * Set the per-package weight for an invoice's unweighed units.
   *
   * Q2 of the segregation plan: this is a PHYSICAL fact about the sack, not commercial
   * data, and Store owns the needs-weight queue — so Store keeps it and it is NOT
   * behind the inward flip. Renamed off the `purchase-orders/` prefix so the boundary
   * reads honestly: Store touches materials, never invoices.
   */
  @Post('materials/pack-weight/:poId')
  @Roles(Role.ADMIN)
  setPackWeight(
    @Param('poId') poId: string,
    @Body() dto: SetPackWeightDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.materials.setLineWeight(
      poId,
      { sku: dto.sku ?? null, materialName: dto.materialName },
      dto.weightKg,
      user.id,
    );
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
  async qrPng(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StreamableFile> {
    // A single unit's sticker is its own scope: pulling one PNG must not lock the
    // whole invoice, but it IS a print of that unit's label.
    const scope = { kind: 'MC_UNIT_LABEL', materialId: id } as const;
    await this.reprints.assertMayPrint(scope);
    const material = await this.materials.findOne(id);
    const png = await this.qr.pngBuffer(this.payloadFor(material));
    await this.reprints.consumePrint(scope, user.id, 'PNG');
    const safe = material.uniqueId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(png, {
      type: 'image/png',
      disposition: `attachment; filename="${safe}.png"`,
    });
  }

  // Printable QR labels (PDF) — ONE 3×1.5" label per page for a label-roll printer,
  // so page count === unit count. All units of an invoice.
  @Get('purchase-orders/:poId/labels.pdf')
  async labels(@CurrentUser() user: AuthUser, @Param('poId') poId: string): Promise<StreamableFile> {
    const scope = { kind: 'PO_LABELS', poId } as const;
    await this.reprints.assertMayPrint(scope);
    const items = await this.labelItems(poId);
    // The SAME renderer as the first print — a reprint is never a separate code path,
    // so the 3x1.5in one-label-per-page geometry cannot drift between the two.
    const pdf = await this.qr.buildLabelRoll(items);
    await this.reprints.consumePrint(scope, user.id, 'PDF');
    const safePoId = poId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="labels-${safePoId}.pdf"`,
    });
  }

  // Individual QR PNGs (one per unit, named by unique ID) bundled as a ZIP (item 12).
  @Get('purchase-orders/:poId/labels.zip')
  async labelsZip(@CurrentUser() user: AuthUser, @Param('poId') poId: string): Promise<StreamableFile> {
    const scope = { kind: 'PO_LABELS', poId } as const;
    await this.reprints.assertMayPrint(scope);
    const items = await this.labelItems(poId);
    const zip = await this.qr.buildLabelsZip(items);
    await this.reprints.consumePrint(scope, user.id, 'ZIP');
    const safePoId = poId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="qr-codes-${safePoId}.zip"`,
    });
  }

  // CSV of label data (incl. the exact QR payload string) — for label-design
  // software like BarTender / NiceLabel to merge onto a .btw/.lbl template.
  @Get('purchase-orders/:poId/labels.csv')
  async labelsCsv(@CurrentUser() user: AuthUser, @Param('poId') poId: string): Promise<StreamableFile> {
    // The CSV feeds BarTender/NiceLabel, which prints the same stickers — so it draws
    // on the same allowance as the PDF and the ZIP rather than being a way around it.
    const scope = { kind: 'PO_LABELS', poId } as const;
    await this.reprints.assertMayPrint(scope);
    const items = await this.labelItems(poId);
    const cell = (v: unknown) => {
      let s = v == null ? '' : String(v);
      // Neutralize CSV formula injection: a leading =,+,-,@,tab,CR makes Excel/Sheets
      // treat the (invoice-derived) value as a formula. Prefix with an apostrophe.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'S.No', 'Unique ID', 'Material Name', 'SKU', 'HSN Code', 'Supplier', 'Invoice No', 'Date', 'QR Data',
    ];
    const rows = items.map((it, i) => {
      const p = it.payload;
      return [
        i + 1, p.uniqueId, p.materialName, p.sku ?? '', p.hsnCode ?? '', p.supplier ?? '',
        p.poNumber ?? '', new Date(p.date).toISOString().slice(0, 10), JSON.stringify(p),
      ].map(cell).join(',');
    });
    // Prepend a BOM so Excel opens UTF-8 correctly; CRLF line endings.
    const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
    await this.reprints.consumePrint(scope, user.id, 'CSV');
    const safePoId = poId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="labels-${safePoId}.csv"`,
    });
  }

  /**
   * DEPRECATED alias of the route above, kept ONLY because Vercel deploys in ~30s and
   * Railway can take 30 minutes: for that window the new UI would otherwise call a
   * route the old API does not serve, and Store could not unblock a unit. Delete once
   * both sides are known deployed.
   */
  @Post('purchase-orders/:poId/pack-weight')
  @Roles(Role.ADMIN)
  setPackWeightLegacy(
    @Param('poId') poId: string,
    @Body() dto: SetPackWeightDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.setPackWeight(poId, dto, user);
  }

  // ── helpers ──
  /**
   * Label inputs for a PO's units. Narrowed to the RAW-MATERIAL payload: this
   * controller only ever deals with MC- units, and the CSV export below reads
   * material-only fields (sku/hsnCode/supplier/poNumber) that do not exist on
   * the finished-goods payload.
   */
  private async labelItems(poId: string): Promise<{ payload: QrPayload }[]> {
    const materials = await this.materials.forPurchaseOrder(poId);
    if (materials.length === 0) throw new NotFoundException('No units for this invoice');
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
