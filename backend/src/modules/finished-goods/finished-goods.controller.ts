import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { FgStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FinishedGoodsService } from './finished-goods.service';
import { DispatchService } from './dispatch.service';
import { ReturnsService } from './returns.service';
import { DispatchScanDto, DispatchBatchDto } from './dto/dispatch.dto';
import { ReturnDto } from './dto/return.dto';

@Controller('finished-goods')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinishedGoodsController {
  constructor(
    private readonly fg: FinishedGoodsService,
    private readonly dispatch: DispatchService,
    private readonly returns: ReturnsService,
  ) {}

  // ── Generation (production head only; Store/Admin may read) ──

  /** Mint one FG unit + QR per package. Blocked unless the output is CONFIRMED. */
  @Post('generate/:outputId')
  @Roles(Role.PRODUCTION_HEAD)
  generate(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.fg.generate(user, outputId);
  }

  @Get('by-output/:outputId')
  @Roles(Role.PRODUCTION_HEAD, Role.ADMIN, Role.OVERSIGHT)
  forOutput(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.fg.forOutput(user, outputId);
  }

  /** Printable FG label roll — same 3×1.5" one-per-page format as raw material labels. */
  @Get('by-output/:outputId/labels.pdf')
  @Roles(Role.PRODUCTION_HEAD, Role.ADMIN)
  @Header('Content-Type', 'application/pdf')
  async labels(
    @CurrentUser() user: AuthUser,
    @Param('outputId') outputId: string,
  ): Promise<StreamableFile> {
    const pdf = await this.fg.labelRoll(user, outputId);
    const safe = outputId.replace(/[^a-zA-Z0-9_-]/g, '');
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="fg-labels-${safe}.pdf"`,
    });
  }

  // ── Listing (Dispatch sees FG across all departments; heads only their own) ──

  @Get()
  @Roles(Role.PRODUCTION_HEAD, Role.ADMIN, Role.OVERSIGHT, Role.DISPATCH)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: FgStatus,
    @Query('batchId') batchId?: string,
    @Query('search') search?: string,
  ) {
    return this.fg.list(user, { status, batchId, search });
  }

  /** Look up one FG unit by its FG- code (the dispatch scanner uses this). */
  @Get('unit/:uniqueId')
  @Roles(Role.PRODUCTION_HEAD, Role.ADMIN, Role.OVERSIGHT, Role.DISPATCH)
  unit(@CurrentUser() user: AuthUser, @Param('uniqueId') uniqueId: string) {
    return this.fg.findByUniqueId(user, uniqueId);
  }

  // ── Dispatch (DISPATCH role only; Admin may read the history) ──

  @Get('dispatch/ready')
  @Roles(Role.DISPATCH, Role.ADMIN, Role.OVERSIGHT)
  ready(@Query('search') search?: string) {
    return this.dispatch.ready({ search });
  }

  @Get('dispatch/history')
  @Roles(Role.DISPATCH, Role.ADMIN, Role.OVERSIGHT)
  history(@CurrentUser() user: AuthUser) {
    return this.dispatch.history(user);
  }

  /** Scan one FG QR to mark it dispatched. */
  @Post('dispatch/scan')
  @Roles(Role.DISPATCH)
  scan(@CurrentUser() user: AuthUser, @Body() dto: DispatchScanDto) {
    return this.dispatch.dispatchUnit(user, dto.uniqueId, dto.note, dto.device);
  }

  /** Dispatch every remaining unit of a batch (a full pallet ships). Audited as bulk. */
  @Post('dispatch/batch')
  @Roles(Role.DISPATCH)
  bulk(@CurrentUser() user: AuthUser, @Body() dto: DispatchBatchDto) {
    return this.dispatch.dispatchBatch(user, dto.batchId, dto.note);
  }

  // ── Returns (DISPATCH acts; Admin may read) — see ReturnsService for the rules ──

  @Get('returns/history')
  @Roles(Role.DISPATCH, Role.ADMIN, Role.OVERSIGHT)
  returnsHistory() {
    return this.returns.history();
  }

  /** Returned unit → written off, permanently out of inventory. Reason required. */
  @Post('returns/scrap')
  @Roles(Role.DISPATCH)
  scrapReturn(@CurrentUser() user: AuthUser, @Body() dto: ReturnDto) {
    return this.returns.scrap(user, dto.uniqueId, dto.note, dto.device);
  }

  /** Returned unit → back into sellable stock as a NEW FG unit with its own QR. */
  @Post('returns/refurbish')
  @Roles(Role.DISPATCH)
  refurbishReturn(@CurrentUser() user: AuthUser, @Body() dto: ReturnDto) {
    return this.returns.refurbish(user, dto.uniqueId, dto.note, dto.device);
  }

  /** Single-unit label PDF — reprints and refurbished-unit stickers. */
  @Get('unit/:uniqueId/label.pdf')
  @Roles(Role.DISPATCH, Role.PRODUCTION_HEAD, Role.ADMIN)
  @Header('Content-Type', 'application/pdf')
  async unitLabel(
    @CurrentUser() user: AuthUser,
    @Param('uniqueId') uniqueId: string,
  ): Promise<StreamableFile> {
    const pdf = await this.fg.unitLabel(user, uniqueId);
    const safe = uniqueId.replace(/[^a-zA-Z0-9_-]/g, '');
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="fg-label-${safe}.pdf"`,
    });
  }
}
