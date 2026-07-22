import { Body, Controller, Get, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ReceivingSlipService } from './receiving-slip.service';

class FinalizeDto {
  /** How many units the gate physically scanned in before pressing Done. */
  @IsInt()
  @Min(0)
  scannedCount!: number;
}

/**
 * Receiving slips — the commercial-free record of an inward.
 *
 * Store reads these because it can no longer read the invoice; the Gate writes them as a
 * by-product of the flow it already runs. Every route here is a GET except the finalise,
 * which only the Gate may call.
 */
@Controller('receiving-slips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceivingSlipController {
  constructor(private readonly slips: ReceivingSlipService) {}

  @Get()
  @Roles(Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER)
  list(@Query('take') take?: string) {
    return this.slips.list(take ? Number(take) : undefined);
  }

  /** Store's dashboard resolves a slip from the inward it is looking at. */
  @Get('by-po/:poId')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER)
  byPo(@Param('poId') poId: string) {
    return this.slips.findByPo(poId);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER)
  findOne(@Param('id') id: string) {
    return this.slips.findOne(id);
  }

  /**
   * The printable slip. Store prints its copy from here and Gate prints the paper he
   * hands over with the truck — the SAME renderer, so the two can never diverge.
   * Available from DRAFT onward: a gate guard should not have to wait for Store to
   * confirm before he can hand over paper. Gate is scoped to his own uploads in the
   * service. This is the SLIP only; the invoice document is untouched and stays where
   * it was, and the slip carries nothing commercial.
   */
  @Get(':id/slip.pdf')
  @Roles(Role.ADMIN, Role.OPERATOR, Role.OVERSIGHT, Role.REVIEWER)
  async slipPdf(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StreamableFile> {
    const { pdf, fileName } = await this.slips.printable(user, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${fileName}"`,
    });
  }

  /**
   * Closes the slip when receiving is done. STORE owns the physical count now — after
   * the re-cut, Gate never touches a unit, so it cannot know how many arrived.
   */
  @Post(':id/finalize')
  @Roles(Role.ADMIN)
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FinalizeDto) {
    return this.slips.finalize(user, id, dto.scannedCount);
  }
}

/**
 * The Reviewer's ONLY screen: every inward, invoice beside slip.
 *
 * Separate controller purely so the Reviewer's surface is legible in one place — it is
 * two GETs and nothing else. Reviewer holds no write anywhere in the application, which
 * reviewer-isolation.spec.ts asserts by sweeping every controller.
 */
@Controller('inwards')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InwardsController {
  constructor(private readonly slips: ReceivingSlipService) {}

  @Get()
  @Roles(Role.REVIEWER, Role.OVERSIGHT)
  list(@Query('take') take?: string) {
    return this.slips.listInwards(take ? Number(take) : undefined);
  }

  @Get(':poId/slip')
  @Roles(Role.REVIEWER, Role.OVERSIGHT)
  slip(@Param('poId') poId: string) {
    return this.slips.findByPo(poId);
  }
}
