import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StoreInwardGuard } from '../../common/guards/store-inward.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ReceivingService } from './receiving.service';
import { ScanDto, WeightDto } from './dto/receiving.dto';

// Receiving actions are Operator (and Admin). Idempotent for offline re-sync (I9).
@Controller('receiving')
// Re-cut: scan-to-receive is STORE's, permanently. Gate photographs the invoice and
// stops; it never touches a physical unit.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Post('scan')
  scan(@Body() dto: ScanDto, @CurrentUser() actor: AuthUser) {
    return this.receiving.scan(dto.uniqueId, actor.id, dto.device);
  }

  /** Recently received units (newest first) — seeds the screen's running log. */
  @Get('recent')
  recent(@Query('take') take?: string) {
    const n = take ? Number.parseInt(take, 10) : 12;
    return this.receiving.recent(Number.isFinite(n) ? n : 12);
  }

  @Post(':uniqueId/weight')
  weigh(
    @Param('uniqueId') uniqueId: string,
    @Body() dto: WeightDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.receiving.weigh(uniqueId, dto.weight, actor.id, dto.device);
  }
}
