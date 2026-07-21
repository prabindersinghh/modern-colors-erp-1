import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { HandoverService } from './handover.service';

/** Read-only handover readiness — Store + factory Admin. Nothing here mutates. */
@Controller('handover')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HandoverController {
  constructor(private readonly handover: HandoverService) {}

  @Get('readiness')
  @Roles(Role.ADMIN, Role.OVERSIGHT)
  readiness() {
    return this.handover.readiness();
  }
}
