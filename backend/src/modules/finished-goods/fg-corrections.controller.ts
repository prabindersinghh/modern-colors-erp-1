import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CorrectionsGuard } from '../../common/guards/corrections.guard';
import { AllowCorrection } from '../../common/decorators/allow-correction.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FinishedGoodsService } from './finished-goods.service';
import { CorrectFinishedGoodDto } from './dto/correct-finished-good.dto';

/**
 * THE one exception to OVERSIGHT's structural view-only rule — kept in its own
 * controller, behind its own guard, on purpose:
 *
 *  - it does NOT use RolesGuard/@Roles, so "OVERSIGHT appears in no mutating @Roles
 *    list" remains true across the whole app and is asserted by fg-corrections.spec.ts;
 *  - CorrectionsGuard passes only @AllowCorrection-marked handlers and only the
 *    OVERSIGHT role, so this controller can never quietly grow into a write surface;
 *  - the service restricts corrections to non-identity fields and audits every change
 *    with before→after and a required reason (corrections doctrine, invariant I4).
 */
@Controller('finished-goods/corrections')
@UseGuards(JwtAuthGuard, CorrectionsGuard)
export class FgCorrectionsController {
  constructor(private readonly fg: FinishedGoodsService) {}

  /** Correct a finished-goods record (name / size / note — never identity or status). */
  @Post(':uniqueId')
  @AllowCorrection()
  correct(
    @CurrentUser() user: AuthUser,
    @Param('uniqueId') uniqueId: string,
    @Body() dto: CorrectFinishedGoodDto,
  ) {
    return this.fg.correct(user, uniqueId, dto);
  }
}
