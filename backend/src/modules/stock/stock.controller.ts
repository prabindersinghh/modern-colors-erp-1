import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Department, Role, StockTxnType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { StockService } from './stock.service';
import { CreateStockTransactionDto } from './dto/create-stock-transaction.dto';

// Stock movement (POST) is a Store-only action (the sole scanner/issuer). The
// read-only stock views (levels + ledger) are also open to the view-only Admin.
// Production heads get NO stock access — they stay request-only.
const STORE_AND_ADMIN = [Role.ADMIN, Role.OVERSIGHT] as const;

@Controller('stock')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** Live per-material stock levels, factory-wide (read-only). */
  @Get('levels')
  @Roles(...STORE_AND_ADMIN)
  levels(@Query('q') q?: string) {
    return this.stock.levels({ q });
  }

  /** The append-only movement ledger — filterable, read-only (I4). */
  @Get('transactions')
  @Roles(...STORE_AND_ADMIN)
  ledger(
    @Query('type') type?: StockTxnType,
    @Query('department') department?: Department,
    @Query('uniqueId') uniqueId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.stock.ledger({
      type,
      department,
      uniqueId,
      startDate,
      endDate,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** QR-verify / look up a scanned unit before choosing a movement (Store only). */
  @Get('units/:uniqueId')
  getUnit(@Param('uniqueId') uniqueId: string) {
    return this.stock.getUnit(uniqueId);
  }

  /** A unit's append-only movement history (Store only). */
  @Get('units/:uniqueId/transactions')
  unitTransactions(@Param('uniqueId') uniqueId: string) {
    return this.stock.unitTransactions(uniqueId);
  }

  /** Record one Add / Deduct / Discard on a scanned unit (Store only). */
  @Post('transactions')
  create(@Body() dto: CreateStockTransactionDto, @CurrentUser() user: AuthUser) {
    return this.stock.createTransaction(user, dto);
  }
}
