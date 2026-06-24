import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { POStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PurchaseOrderService } from './purchase-order.service';
import { ManualEntryDto } from './dto/manual-entry.dto';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Get(':id/file')
  async file(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, fileName, mimeType } = await this.po.getFile(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${fileName}"`,
    });
    return buffer;
  }

  // Writes: Operator (and Admin). Supervisor is read-only.
  @Post()
  @Roles(Role.ADMIN, Role.OPERATOR)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() actor: AuthUser) {
    if (!file) throw new BadRequestException('No file uploaded (field name "file")');
    return this.po.upload(file, actor.id);
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
}
