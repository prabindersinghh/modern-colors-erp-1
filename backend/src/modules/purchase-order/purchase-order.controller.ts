import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { POStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import {
  Delete,
  Patch,
} from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

// Purchase orders are Phase 1 data. Class-level gate covers the read routes (list /
// detail / file); write routes keep their stricter ADMIN+OPERATOR gates below. The
// Phase 3 DISPATCH role is excluded entirely — it never sees supplier or PO data.
@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.OVERSIGHT)
export class PurchaseOrderController {
  constructor(private readonly po: PurchaseOrderService) {}

  // Read: any authenticated user (Supervisor may view).
  @Get()
  list(
    @Query('status') status?: POStatus,
    @Query('supplier') supplier?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.po.list({
      status,
      supplier,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.po.findOne(id);
  }

  /**
   * The invoice document itself. The Reviewer's whole job is to read this beside the
   * digital slip, so REVIEWER is added HERE and on no other invoice route — it cannot
   * list invoices, cannot open one's data, and holds no write anywhere.
   */
  @Get(':id/file')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.OVERSIGHT, Role.REVIEWER)
  async file(@Param('id') id: string): Promise<StreamableFile> {
    const { buffer, fileName, mimeType } = await this.po.getFile(id);
    // Sanitize the (user-supplied) filename before it reaches the header to
    // prevent header/Content-Disposition injection. ASCII-safe quoted form +
    // RFC 5987 encoded form for the real name.
    const ascii = (fileName || 'po').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
    const encoded = encodeURIComponent(fileName || 'po');
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    });
  }

  // Writes: Operator (and Admin). Supervisor is read-only.
  @Post()
  @Roles(Role.ADMIN, Role.OPERATOR)
  @UseInterceptors(
    // Cap size + restrict fields to mitigate multipart DoS and memory exhaustion.
    // 25 MB allows full-resolution phone photos of a PO; one file only.
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 5, fieldNameSize: 100 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthUser) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    return this.po.upload(file, actor.id);
  }

  // Create a PO by typing it in (no document) — Option B of the upload flow.
  @Post('manual')
  @Roles(Role.ADMIN, Role.OPERATOR)
  createManual(@Body() dto: ManualEntryDto, @CurrentUser() actor: AuthUser) {
    return this.po.createManual(dto, actor.id);
  }

  @Post(':id/extract')
  @Roles(Role.ADMIN, Role.OPERATOR)
  extract(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.po.extract(id, actor.id);
  }

  @Post(':id/manual')
  @Roles(Role.ADMIN, Role.OPERATOR)
  manual(
    @Param('id') id: string,
    @Body() dto: ManualEntryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.po.manualEntry(id, dto, actor.id);
  }

  // ── Operator review: edit the working set before confirming ──

  @Post(':id/line-items')
  @Roles(Role.ADMIN, Role.OPERATOR)
  addLine(@Param('id') id: string, @Body() dto: CreateLineItemDto, @CurrentUser() actor: AuthUser) {
    return this.po.addLineItem(id, dto, actor.id);
  }

  @Patch(':id/line-items/:itemId')
  @Roles(Role.ADMIN, Role.OPERATOR)
  updateLine(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateLineItemDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.po.updateLineItem(id, itemId, dto, actor.id);
  }

  @Delete(':id/line-items/:itemId')
  @Roles(Role.ADMIN, Role.OPERATOR)
  deleteLine(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.po.deleteLineItem(id, itemId, actor.id);
  }

  // ── The hard confirm gate (creates Materials + QRs) ──
  @Post(':id/confirm')
  @Roles(Role.ADMIN, Role.OPERATOR)
  confirm(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.po.confirm(id, actor.id);
  }
}
