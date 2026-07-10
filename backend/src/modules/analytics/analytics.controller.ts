import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // Factory-wide oversight analytics — Admin only (view-only role).
  @Get('overview')
  @Roles(Role.OVERSIGHT)
  adminOverview(@Query('days') days?: string) {
    return this.analytics.adminOverview(days ? Number(days) : undefined);
  }

  // Store dashboard analytics — Store only.
  @Get('store')
  @Roles(Role.ADMIN)
  storeOverview(@Query('days') days?: string) {
    return this.analytics.storeOverview(days ? Number(days) : undefined);
  }

  // Production-head dashboard — scoped SERVER-SIDE to the caller's own department.
  // A head can never obtain another department's numbers here.
  @Get('my')
  @Roles(Role.PRODUCTION_HEAD)
  myOverview(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.analytics.myOverview(user, days ? Number(days) : undefined);
  }
}
