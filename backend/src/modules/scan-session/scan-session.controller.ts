import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { Role, ScanKind } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ScanSessionService } from './scan-session.service';

class OpenDto {
  @IsIn(['RECEIVING', 'DISPATCH'])
  kind!: ScanKind;
}

/**
 * Start/Done for scan sessions. RECEIVING is Store's (Receive Stock); DISPATCH is
 * Dispatch's. Each role reaches only its own kind's enforcement in practice — the guard
 * on the scan endpoints checks the matching kind for the acting role.
 */
@Controller('scan-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScanSessionController {
  constructor(private readonly sessions: ScanSessionService) {}

  @Get('current')
  @Roles(Role.ADMIN, Role.DISPATCH)
  current(@CurrentUser() user: AuthUser, @Query('kind') kind: ScanKind) {
    return this.sessions.current(user.id, kind);
  }

  /**
   * Session history (read-only). OVERSIGHT sees EVERY session — who scanned, from when to
   * when, how many — for the owner's total-visibility rule; Store/Dispatch see their own.
   */
  @Get()
  @Roles(Role.ADMIN, Role.DISPATCH, Role.OVERSIGHT)
  list(@CurrentUser() user: AuthUser, @Query('kind') kind?: ScanKind) {
    return this.sessions.list(user, kind);
  }

  @Post()
  @Roles(Role.ADMIN, Role.DISPATCH)
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenDto) {
    return this.sessions.open(user.id, dto.kind);
  }

  @Post(':kind/close')
  @Roles(Role.ADMIN, Role.DISPATCH)
  close(@CurrentUser() user: AuthUser, @Param('kind') kind: ScanKind) {
    return this.sessions.close(user.id, kind);
  }
}
