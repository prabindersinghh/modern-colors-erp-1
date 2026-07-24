import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccessFlipGuard } from '../../common/guards/access-flip.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowAccessFlip } from '../../common/decorators/allow-access-flip.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SystemFlagsService, STORE_INWARD_ACCESS, PACKING_STAGE, FLAG_ON, FLAG_OFF } from './system-flags.service';

class SetInwardAccessDto {
  @IsIn([FLAG_ON, FLAG_OFF])
  value!: string;
}

/** Reading a flag is not a privilege — screens need it to explain themselves. */
@Controller('system-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemFlagsController {
  constructor(private readonly flags: SystemFlagsService) {}

  @Get('store-inward-access')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.SUPERVISOR)
  async get() {
    return { key: STORE_INWARD_ACCESS, value: await this.flags.get(STORE_INWARD_ACCESS, FLAG_ON) };
  }

  /**
   * Packing-stage flag. Read by Dispatch (to switch its home between FG-drum and PG-card
   * mode), the Packer, and the whole-factory readers. Defaults OFF.
   */
  @Get('packing-stage')
  @Roles(Role.DISPATCH, Role.PACKER, Role.OVERSIGHT, Role.ADMIN, Role.PRODUCTION_HEAD)
  async packingStage() {
    return { key: PACKING_STAGE, value: await this.flags.get(PACKING_STAGE, FLAG_OFF) };
  }
}

/**
 * Flipping a flag — the FOURTH named door (@AllowAccessFlip). Own controller, own guard,
 * no @Roles, exactly like corrections, user admin and reprint approval. This ONE door now
 * governs BOTH flag keys (store-inward-access and packing-stage); the door COUNT stays
 * four, asserted by the sweep in user-admin.spec.ts.
 */
@Controller('system-flags/decisions')
@UseGuards(JwtAuthGuard, AccessFlipGuard)
export class SystemFlagsAdminController {
  constructor(private readonly flags: SystemFlagsService) {}

  @Post('store-inward-access')
  @AllowAccessFlip()
  set(@CurrentUser() actor: AuthUser, @Body() dto: SetInwardAccessDto) {
    return this.flags.set(STORE_INWARD_ACCESS, dto.value, actor.id);
  }

  @Post('packing-stage')
  @AllowAccessFlip()
  setPacking(@CurrentUser() actor: AuthUser, @Body() dto: SetInwardAccessDto) {
    return this.flags.set(PACKING_STAGE, dto.value, actor.id);
  }
}
