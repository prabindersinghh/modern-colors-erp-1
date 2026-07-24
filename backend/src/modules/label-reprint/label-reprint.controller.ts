import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ReprintStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReprintApprovalGuard } from '../../common/guards/reprint-approval.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowReprintApproval } from '../../common/decorators/allow-reprint-approval.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LabelReprintService, MAX_PRINTS_PER_APPROVAL, type PrintScope } from './label-reprint.service';

class RequestReprintDto {
  @IsIn(['PO_LABELS', 'FG_OUTPUT_LABELS', 'FG_UNIT_LABEL', 'CARTON_LABEL'])
  scope!: 'PO_LABELS' | 'FG_OUTPUT_LABELS' | 'FG_UNIT_LABEL' | 'CARTON_LABEL';

  /** The PO, output or finished-goods unit the labels belong to. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  targetId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

class DecideDto {
  /** How many prints this approval buys. The Admin's choice, not a fixed one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRINTS_PER_APPROVAL)
  prints?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export const toScope = (scope: string, targetId: string): PrintScope =>
  scope === 'PO_LABELS'
    ? { kind: 'PO_LABELS', poId: targetId }
    : scope === 'FG_OUTPUT_LABELS'
      ? { kind: 'FG_OUTPUT_LABELS', outputId: targetId }
      : scope === 'CARTON_LABEL'
        ? { kind: 'CARTON_LABEL', cartonId: targetId }
        : { kind: 'FG_UNIT_LABEL', finishedGoodId: targetId };

/**
 * Raising a reprint request, and reading the state of the lock.
 *
 * These are ordinary role-gated routes: whoever may print may ask to print again.
 * Deciding the request is a different thing entirely and lives in the controller
 * below, behind its own named door.
 */
@Controller('label-reprints')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LabelReprintController {
  constructor(private readonly reprints: LabelReprintService) {}

  /** Is this scope locked, and is anything already in flight for it? */
  @Get('status')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.OVERSIGHT, Role.PRODUCTION_HEAD, Role.DISPATCH)
  async status(@Query('scope') scope: string, @Query('targetId') targetId: string) {
    const s = toScope(scope, targetId);
    const [printed, live] = await Promise.all([
      this.reprints.alreadyPrinted(s),
      this.reprints.liveRequest(s),
    ]);
    return {
      alreadyPrinted: printed,
      // The whole contract in one field: may this print go ahead right now?
      mayPrint: !printed || (live?.status === ReprintStatus.APPROVED && live.printsUsed < live.printsApproved),
      request: live,
    };
  }

  @Post('request')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.PRODUCTION_HEAD, Role.DISPATCH)
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestReprintDto) {
    return this.reprints.request(user.id, toScope(dto.scope, dto.targetId), dto.reason);
  }

  /** The queue, readable by everyone who can print so they can see where they stand. */
  @Get()
  @Roles(Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.OVERSIGHT, Role.PRODUCTION_HEAD, Role.DISPATCH)
  list(@Query('status') status?: ReprintStatus) {
    return this.reprints.list(status);
  }
}

/**
 * Deciding a reprint — the THIRD named door through OVERSIGHT's view-only rule.
 *
 * Its own controller, its own guard, NO @Roles anywhere, exactly like FG corrections
 * and user admin. That is what lets label-reprint.spec.ts assert the complete set of
 * Oversight write doors and catch a fourth one appearing.
 */
@Controller('label-reprints/decisions')
@UseGuards(JwtAuthGuard, ReprintApprovalGuard)
export class LabelReprintApprovalController {
  constructor(private readonly reprints: LabelReprintService) {}

  @Post(':id/approve')
  @AllowReprintApproval()
  approve(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.reprints.approve(actor.id, id, dto.prints ?? 1, dto.note);
  }

  @Post(':id/reject')
  @AllowReprintApproval()
  reject(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: DecideDto) {
    return this.reprints.reject(actor.id, id, dto.note);
  }
}
