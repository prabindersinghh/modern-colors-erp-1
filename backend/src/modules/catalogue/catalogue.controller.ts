import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { buildTemplateCsv, buildTemplateXlsx } from './catalogue-template';
import { CatalogueValidationService } from './catalogue-validation.service';
import { ImportRowsDto, RevalidateRowsDto } from './dto/import-rows.dto';
import { CatalogueService } from './catalogue.service';
import { CreateCatalogueItemDto } from './dto/create-catalogue-item.dto';
import { UpdateCatalogueItemDto } from './dto/update-catalogue-item.dto';

// Catalogue reads are needed by Phase 1 roles (PO review) and by production heads (the
// material picker). The Phase 3 DISPATCH role is excluded — it deals only in finished
// goods. Write operations keep their own stricter per-route gates below.
const CATALOGUE_READ_ROLES = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.OVERSIGHT,
  Role.PRODUCTION_HEAD,
] as const;

@Controller('catalogue')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...CATALOGUE_READ_ROLES)
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly validation: CatalogueValidationService,
  ) {}

  // Read + match: Phase 1 roles + production heads (needed during PO review / picking).
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('provisional') provisional?: string,
  ) {
    return this.catalogue.findAll({
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      provisional: provisional === 'true' || provisional === '1',
    });
  }

  // Count of provisional (TMP-) SKUs still awaiting a real code — for the nudge.
  // NOTE: declared before :id so "provisional-count" isn't captured as an id.
  @Get('provisional-count')
  provisionalCount() {
    return this.catalogue.provisionalCount();
  }

  @Get('match')
  match(@Query('q') q: string, @Query('sku') sku?: string) {
    if (!q) throw new BadRequestException('Query param "q" (material name) is required');
    return this.catalogue.match({ materialName: q, sku });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogue.findOne(id);
  }

  // Add a single new SKU: allowed for Operators too (new SKUs arrive daily and
  // are added during operations WITH confirmation). Additive + audited.
  @Post()
  // The no-match SKU add belongs to Store's Review & Confirm, not to Gate.
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateCatalogueItemDto,
    @CurrentUser() actor: AuthUser,
    @Query('source') source?: string,
  ) {
    return this.catalogue.create(dto, actor.id, source === 'no-match');
  }

  // Bulk import: Admin only (one-time / periodic master list setup).
  /**
   * Downloadable import template (CSV or Excel).
   *
   * Store previously had to guess the column layout; a guessed header means a failed or
   * half-imported file. This returns the exact expected structure with worked examples.
   * Read-only and generated in-process — no DB access, no file storage.
   */
  @Get('import/template')
  @Roles(Role.ADMIN)
  template(
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const xlsx = (format ?? 'csv').toLowerCase() === 'xlsx';
    const body = xlsx ? buildTemplateXlsx() : buildTemplateCsv();
    const name = xlsx ? 'catalogue-template.xlsx' : 'catalogue-template.csv';
    res.set({
      'Content-Type': xlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    return new StreamableFile(body);
  }

  @Post('import')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    // 10 MB covers a 500–600 SKU CSV/XLSX; restrict fields to mitigate multipart DoS.
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 5, fieldNameSize: 100 },
    }),
  )
  import(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    return this.catalogue.importFile(file.buffer, actor.id);
  }

  // Preview a CSV/XLSX before committing — parses + validates, returns rows to
  // review. No DB writes. Admin only.
  @Post('import/preview')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 5, fieldNameSize: 100 },
    }),
  )
  importPreview(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    return this.catalogue.previewImport(file.buffer);
  }

  /**
   * Preview + validate in one call. Parses the file (as today), then layers on
   * deterministic checks and — unless skipped — an AI sanity pass.
   *
   * Pass ?ai=false for a small addition where waiting on an API call is not worth it.
   * If AI is unavailable for ANY reason the response still returns the parsed rows and
   * the deterministic flags, so the import path is never blocked by this layer.
   */
  @Post('import/validate')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 5, fieldNameSize: 100 },
    }),
  )
  async importValidate(
    @UploadedFile() file: Express.Multer.File,
    @Query('ai') ai?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    const preview = this.catalogue.previewImport(file.buffer);
    const validation = await this.validation.validate(preview.rows, {
      useAi: ai !== 'false' && ai !== '0',
    });
    return { ...preview, validation };
  }

  /**
   * Re-validate rows the operator has edited in the preview, without re-uploading the
   * file. This is what lets them fix a flagged cell on screen and check their work.
   */
  @Post('import/revalidate')
  @Roles(Role.ADMIN)
  async importRevalidate(@Body() dto: RevalidateRowsDto) {
    // Normalise undefined -> null: the DTO allows omitted optional fields, the
    // validator works on an explicit "known blank".
    const rows = dto.rows.map((r) => ({
      row: r.row,
      materialName: r.materialName ?? null,
      sku: r.sku ?? null,
      hsnCode: r.hsnCode ?? null,
      category: r.category ?? null,
      unit: r.unit ?? null,
      standardPackaging: r.standardPackaging ?? null,
    }));
    return this.validation.validate(rows, { useAi: dto.ai !== false });
  }

  /**
   * Commit an explicit set of rows — the reviewed/edited/partial import.
   *
   * Store selects which rows to bring in (typically the clean ones) and imports those,
   * leaving flagged rows behind to fix later. Same upsert path as a file import.
   */
  @Post('import/rows')
  @Roles(Role.ADMIN)
  importRows(@Body() dto: ImportRowsDto, @CurrentUser() actor: AuthUser) {
    return this.catalogue.importRows(dto.rows, actor.id);
  }

  // Edit / delete: Admin only (per PRD §7).
  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCatalogueItemDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.catalogue.update(id, dto, actor.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.catalogue.remove(id, actor.id);
  }
}
