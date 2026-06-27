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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CatalogueService } from './catalogue.service';
import { CreateCatalogueItemDto } from './dto/create-catalogue-item.dto';
import { UpdateCatalogueItemDto } from './dto/update-catalogue-item.dto';

@Controller('catalogue')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  // Read + match: any authenticated user (operators need it during PO review).
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.catalogue.findAll({
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
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
  @Roles(Role.ADMIN, Role.OPERATOR)
  create(
    @Body() dto: CreateCatalogueItemDto,
    @CurrentUser() actor: AuthUser,
    @Query('source') source?: string,
  ) {
    return this.catalogue.create(dto, actor.id, source === 'no-match');
  }

  // Bulk import: Admin only (one-time / periodic master list setup).
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
