import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CartonStatus, PackingListStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PackingService } from './packing.service';
import { AddEntryDto, AddItemDto, CartonScanDto, ScanInDto, VoidCartonDto } from './dto/packing.dto';

/**
 * The packing desk — PACKER only, with read-through for the whole-factory viewers.
 *
 * The packer scans finished goods in, composes cartons, confirms (mints PG, freezes),
 * seals (scans PACKED) and voids. He cannot touch raw stock, requests, batches, invoices,
 * slips, users, settings, analytics or dispatch — asserted by packer-isolation.spec.ts.
 * This controller holds NO named door.
 */
@Controller('packing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackingController {
  constructor(private readonly packing: PackingService) {}

  /** The pool the packer works from — units to scan in, and his loose UNDER_PACKING units. */
  @Get('pool')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  pool() {
    return this.packing.pool();
  }

  /** FG batch cards — the packer's home: per-family counts + scan-in progress per batch. */
  @Get('batches')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  batches() {
    return this.packing.batches();
  }

  /** A batch's unit-level detail. */
  @Get('batches/:id')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  batch(@Param('id') id: string) {
    return this.packing.batch(id);
  }

  /** Scan a finished-goods unit into the packer's hands (→ UNDER_PACKING). */
  @Post('scan-in')
  @Roles(Role.PACKER)
  scanIn(@CurrentUser() user: AuthUser, @Body() dto: ScanInDto) {
    return this.packing.scanIn(user, dto.uniqueId, dto.device);
  }

  /** This packer's cartons (ADMIN/OVERSIGHT see all), optionally by status. */
  @Get('cartons')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  cartons(@CurrentUser() user: AuthUser, @Query('status') status?: CartonStatus) {
    return this.packing.cartons(user, status);
  }

  /** Start a new empty DRAFT carton. */
  @Post('cartons')
  @Roles(Role.PACKER)
  createCarton(@CurrentUser() user: AuthUser) {
    return this.packing.createCarton(user);
  }

  @Get('cartons/:id')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  carton(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.packing.carton(user, id);
  }

  /** Add a unit to a DRAFT carton. */
  @Post('cartons/:id/items')
  @Roles(Role.PACKER)
  addItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddItemDto) {
    return this.packing.addItem(user, id, dto.uniqueId);
  }

  /** Remove a unit from a DRAFT carton. */
  @Delete('cartons/:id/items/:fgId')
  @Roles(Role.PACKER)
  removeItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('fgId') fgId: string) {
    return this.packing.removeItem(user, id, fgId);
  }

  /** Confirm a DRAFT carton — mint PG, freeze contents (the hard gate). */
  @Post('cartons/:id/confirm')
  @Roles(Role.PACKER)
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.packing.confirmCarton(user, id);
  }

  /** Void a carton + release its contents (reason required). */
  @Post('cartons/:id/void')
  @Roles(Role.PACKER)
  voidCarton(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidCartonDto) {
    return this.packing.voidCarton(user, id, dto.reason);
  }

  /** The carton's A5 mega label PDF (first print free; reprints via the lock). */
  @Get('cartons/:id/labels.pdf')
  @Roles(Role.PACKER, Role.ADMIN)
  @Header('Content-Type', 'application/pdf')
  async labels(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StreamableFile> {
    const pdf = await this.packing.cartonLabel(user, id);
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `inline; filename="carton-${safe}.pdf"` });
  }

  /** Scan the PG to mark the carton (and its contents) PACKED. */
  @Post('mark-packed')
  @Roles(Role.PACKER)
  markPacked(@CurrentUser() user: AuthUser, @Body() dto: CartonScanDto) {
    return this.packing.markPacked(user, dto.uniqueId, dto.device);
  }

  /** Resolve a PG scan to its exact contents (the mega-QR reveal). Dispatch uses this too. */
  @Get('carton/:uniqueId')
  @Roles(Role.PACKER, Role.DISPATCH, Role.ADMIN, Role.OVERSIGHT)
  resolve(@Param('uniqueId') uniqueId: string) {
    return this.packing.resolveCarton(uniqueId);
  }

  // ── Packing lists (compose a list of straights + combos, confirm it whole) ──

  @Get('lists')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  lists(@CurrentUser() user: AuthUser, @Query('status') status?: PackingListStatus) {
    return this.packing.lists(user, status);
  }

  @Post('lists')
  @Roles(Role.PACKER)
  createList(@CurrentUser() user: AuthUser) {
    return this.packing.createList(user);
  }

  @Get('lists/:id')
  @Roles(Role.PACKER, Role.ADMIN, Role.OVERSIGHT)
  packingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.packing.packingList(user, id);
  }

  /** Add an entry — a straight (one id) or a combo (several) — to a DRAFT list. */
  @Post('lists/:id/entries')
  @Roles(Role.PACKER)
  addEntry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddEntryDto) {
    return this.packing.addEntry(user, id, dto.uniqueIds);
  }

  @Delete('lists/:id/entries/:cartonId')
  @Roles(Role.PACKER)
  removeEntry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('cartonId') cartonId: string) {
    return this.packing.removeEntry(user, id, cartonId);
  }

  /** ONE confirm mints a PG for every entry in the list, sequential, in one transaction. */
  @Post('lists/:id/confirm')
  @Roles(Role.PACKER)
  confirmList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.packing.confirmList(user, id);
  }

  /** ONE PDF: every confirmed entry's A5 label, in list order. */
  @Get('lists/:id/labels.pdf')
  @Roles(Role.PACKER, Role.ADMIN)
  @Header('Content-Type', 'application/pdf')
  async listLabels(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StreamableFile> {
    const pdf = await this.packing.listLabels(user, id);
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '');
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: `inline; filename="packing-list-${safe}.pdf"` });
  }
}
