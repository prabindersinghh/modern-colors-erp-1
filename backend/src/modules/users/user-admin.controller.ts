import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserAdminGuard } from '../../common/guards/user-admin.guard';
import { AllowUserAdmin } from '../../common/decorators/allow-user-admin.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UserAdminService } from './user-admin.service';

class CreateLoginDto {
  /** Local part only — the server appends @moderncolours.local; it is not input. */
  @IsString()
  @MinLength(1)
  @MaxLength(41)
  localPart!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(['PRODUCTION_HEAD', 'DISPATCH', 'OPERATOR', 'REVIEWER'])
  role!: string;

  @IsOptional()
  @IsIn(['PU', 'ENAMEL', 'POWDER'])
  department?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}

class RenameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}

/**
 * The factory Admin's user management — the SECOND named door through OVERSIGHT's
 * view-only rule (the first is FG corrections). Its own controller, its own guard,
 * no @Roles anywhere — so the structural sweep in user-admin.spec.ts can assert the
 * complete OVERSIGHT write surface is exactly these handlers plus the correction one.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, UserAdminGuard)
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  @AllowUserAdmin()
  list() {
    return this.users.list();
  }

  @Post()
  @AllowUserAdmin()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateLoginDto) {
    return this.users.create(actor.id, dto);
  }

  /** Change a login's display name (identity and role are never touched). */
  @Post(':id/rename')
  @AllowUserAdmin()
  rename(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RenameDto) {
    return this.users.rename(actor.id, id, dto.name);
  }

  @Post(':id/reset-password')
  @AllowUserAdmin()
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(actor.id, id, dto.password);
  }

  @Post(':id/deactivate')
  @AllowUserAdmin()
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.deactivate(actor.id, id);
  }

  @Post(':id/reactivate')
  @AllowUserAdmin()
  reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.users.reactivate(actor.id, id);
  }
}
