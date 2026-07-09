import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequestStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProductionRequestService } from './production-request.service';
import { CreateProductionRequestDto } from './dto/create-production-request.dto';

// Read roles: a head (scoped to its own dept), the Store, and the view-only Admin.
const READ_ROLES = [Role.PRODUCTION_HEAD, Role.ADMIN, Role.OVERSIGHT] as const;

@Controller('production-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductionRequestController {
  constructor(private readonly requests: ProductionRequestService) {}

  // Only a production head can raise a request (department forced to theirs).
  @Post()
  @Roles(Role.PRODUCTION_HEAD)
  create(@Body() dto: CreateProductionRequestDto, @CurrentUser() user: AuthUser) {
    return this.requests.create(dto, user);
  }

  @Get()
  @Roles(...READ_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: RequestStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.requests.list(user, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // NOTE: this must be declared before :id so "summary" isn't captured as an id.
  @Get('summary')
  @Roles(...READ_ROLES)
  summary(@CurrentUser() user: AuthUser) {
    return this.requests.summary(user);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.findOne(user, id);
  }
}
