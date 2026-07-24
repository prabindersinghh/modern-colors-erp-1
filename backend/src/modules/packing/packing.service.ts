import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CartonStatus, FgStatus, PackingListStatus, Prisma, ScanKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isFinishedGoodId } from '../finished-goods/fg-family';
import { ScanSessionService } from '../scan-session/scan-session.service';
import { LabelReprintService } from '../label-reprint/label-reprint.service';
import { buildCartonLabel, buildCartonLabelSheet, type CartonLabelDoc } from './carton-label';
import { CARTON_SEQ, formatCartonId, isCartonId } from './carton-id';
export { CARTON_SEQ, formatCartonId, isCartonId } from './carton-id';

// A DRAFT carton needs a uniqueId (the column is NOT NULL UNIQUE) but has no PG yet — the
// PG is minted only at CONFIRM. Until then it wears a per-row placeholder that no scan
// resolves and no label prints, so "a draft has no PG" stays true.
const draftPlaceholder = (id: string) => `DRAFT-${id}`;

const cartonItemInclude = {
  finishedGood: {
    select: {
      id: true,
      uniqueId: true,
      family: true,
      productName: true,
      sizePerPackage: true,
      sizeUnit: true,
      status: true,
      batch: { select: { id: true, batchNumber: true, department: true } },
      outputId: true,
    },
  },
} satisfies Prisma.CartonItemInclude;

const cartonInclude = {
  packedBy: { select: { id: true, name: true } },
  dispatchedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  items: { include: cartonItemInclude, orderBy: { finishedGood: { uniqueId: 'asc' } } },
} satisfies Prisma.CartonInclude;

const packingListInclude = {
  packedBy: { select: { id: true, name: true } },
  // Entries in the order they were added — the order the label sheet prints.
  cartons: { include: cartonInclude, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PackingListInclude;

/**
 * The packing desk.
 *
 * A packer scans finished-goods units (paint, hardener or thinner) into his hands, groups
 * them into a carton, and CONFIRMS it — which mints the carton's PG id and FREEZES its
 * contents. A confirmed carton is never edited; a wrong one is VOIDED (its units released
 * back to the pool, its PG retired forever) and repacked into a fresh PG. Dispatch later
 * scans the PG to ship the whole carton at once.
 *
 * Every mutation is guarded FOR UPDATE and append-only audited. The load-bearing rule —
 * a unit is in at most one carton — is a database UNIQUE on CartonItem.finishedGoodId,
 * not a convention here.
 */
@Injectable()
export class PackingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reprints: LabelReprintService,
    private readonly sessions: ScanSessionService,
  ) {}

  async onModuleInit() {
    await this.prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${CARTON_SEQ} START 1`);
  }

  /**
   * The pool the packer works from:
   *  - `toScanIn`: GENERATED units not yet taken in (scan these to start),
   *  - `loose`: his UNDER_PACKING units not yet in any carton (add these to a carton).
   * Both families flow through here; the id prefix tells paint from hardener/thinner.
   */
  async pool() {
    const select = {
      id: true,
      uniqueId: true,
      family: true,
      productName: true,
      sizePerPackage: true,
      sizeUnit: true,
      status: true,
      batch: { select: { batchNumber: true, department: true } },
    } satisfies Prisma.FinishedGoodSelect;

    const [toScanIn, loose] = await Promise.all([
      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.GENERATED },
        select,
        orderBy: { uniqueId: 'asc' },
        take: 500,
      }),
      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.UNDER_PACKING, cartonItem: { is: null } },
        select,
        orderBy: { uniqueId: 'asc' },
        take: 500,
      }),
    ]);
    return { toScanIn, loose };
  }

  // Statuses that count as "produced" for a batch card (SCRAPPED / REFURBISHED originals
  // are excluded — they are no longer part of what the batch ships).
  private static readonly PRODUCED = [FgStatus.GENERATED, FgStatus.UNDER_PACKING, FgStatus.PACKED, FgStatus.DISPATCHED] as const;
  // Statuses that mean a unit has been SCANNED IN (taken past GENERATED).
  private static readonly SCANNED_IN = [FgStatus.UNDER_PACKING, FgStatus.PACKED, FgStatus.DISPATCHED];

  /**
   * FG BATCH CARDS — the packer's home. One card per production batch that still has units
   * to pack, with per-family counts (size+unit shown, kg/L never blended) and a 0–100%
   * progress bar = units scanned into UNDER_PACKING / total units of the batch. Every number
   * is SERVER-computed. Fully-dispatched batches drop off; batches fully scanned-in (no
   * GENERATED left) are flagged `done`.
   */
  async batches() {
    const familyLabel: Record<string, string> = { FINISHED_GOOD: 'Paint', HARDENER: 'Hardener', THINNER: 'Thinner' };
    // Counts per (batch, family, status).
    const grouped = await this.prisma.finishedGood.groupBy({
      by: ['batchId', 'family', 'status'],
      where: { status: { in: [...PackingService.PRODUCED] } },
      _count: { _all: true },
    });
    if (grouped.length === 0) return { batches: [] };
    // Identity + size/unit per (batch, family) — one representative row each.
    const meta = await this.prisma.finishedGood.findMany({
      where: { status: { in: [...PackingService.PRODUCED] } },
      distinct: ['batchId', 'family'],
      select: {
        batchId: true, family: true, sizePerPackage: true, sizeUnit: true, productName: true,
        batch: { select: { batchNumber: true, department: true } },
      },
    });

    const scannedSet = new Set<string>(PackingService.SCANNED_IN);
    const FAM_ORDER = ['FINISHED_GOOD', 'HARDENER', 'THINNER'];
    const byBatch = new Map<string, any>();
    for (const m of meta) {
      const b = byBatch.get(m.batchId) ?? {
        batchId: m.batchId, batchNumber: m.batch.batchNumber, department: m.batch.department,
        productName: m.productName, families: [] as any[], total: 0, scannedIn: 0, generatedLeft: 0, dispatched: 0,
      };
      const counts = grouped.filter((g) => g.batchId === m.batchId && g.family === m.family);
      const sum = (pred: (s: FgStatus) => boolean) => counts.filter((c) => pred(c.status)).reduce((n, c) => n + c._count._all, 0);
      const famTotal = counts.reduce((n, c) => n + c._count._all, 0);
      b.families.push({
        family: m.family, label: familyLabel[m.family] ?? m.family, count: famTotal,
        size: m.sizePerPackage, unit: m.sizeUnit, scannedIn: sum((s) => scannedSet.has(s)),
      });
      b.total += famTotal;
      b.scannedIn += sum((s) => scannedSet.has(s));
      b.generatedLeft += sum((s) => s === FgStatus.GENERATED);
      b.dispatched += sum((s) => s === FgStatus.DISPATCHED);
      byBatch.set(m.batchId, b);
    }

    const batches = [...byBatch.values()]
      // Drop fully-dispatched batches — they have left the factory, nothing for the packer.
      .filter((b) => b.total > 0 && b.dispatched < b.total)
      .map((b) => ({
        batchId: b.batchId, batchNumber: b.batchNumber, department: b.department, productName: b.productName,
        families: b.families.sort((x: any, y: any) => FAM_ORDER.indexOf(x.family) - FAM_ORDER.indexOf(y.family)),
        total: b.total, scannedIn: b.scannedIn,
        progress: b.total > 0 ? Math.round((b.scannedIn / b.total) * 100) : 0,
        done: b.generatedLeft === 0, // fully scanned in — nothing left for the packer to take
      }))
      // Active (needs scanning) first, then done; within each, most-recent batch first.
      .sort((a, b) => Number(a.done) - Number(b.done) || b.batchNumber.localeCompare(a.batchNumber));
    return { batches };
  }

  /** A batch's unit-level detail — every produced unit, its family, size and status. */
  async batch(batchId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { batchNumber: true, department: true } });
    if (!batch) throw new NotFoundException('Batch not found');
    const units = await this.prisma.finishedGood.findMany({
      where: { batchId, status: { in: [...PackingService.PRODUCED] } },
      select: { id: true, uniqueId: true, family: true, productName: true, sizePerPackage: true, sizeUnit: true, status: true },
      orderBy: { uniqueId: 'asc' },
      take: 2000,
    });
    return { batchId, batchNumber: batch.batchNumber, department: batch.department, units };
  }

  /** Scan a unit into UNDER_PACKING. Double-scan guarded; must currently be GENERATED.
   *  Server-side gated: refused unless the packer has an open PACKING session (same system
   *  as Receive Stock / Dispatch). Counts the scan against the session. */
  async scanIn(user: AuthUser, uniqueId: string, device?: string) {
    await this.sessions.assertOpen(user.id, ScanKind.PACKING);
    const id = uniqueId.trim();
    if (!isFinishedGoodId(id)) {
      throw new BadRequestException(`${id} is not a finished-goods code. The packer scans FG-/FGHD-/FGTH- units.`);
    }
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: FgStatus; uniqueId: string }[]>`
        SELECT "id", "status", "uniqueId" FROM "FinishedGood" WHERE "uniqueId" = ${id} FOR UPDATE`;
      const row = locked[0];
      if (!row) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
      if (row.status === FgStatus.UNDER_PACKING) {
        throw new ConflictException(`${id} is already under packing.`);
      }
      if (row.status !== FgStatus.GENERATED && row.status !== FgStatus.READY) {
        throw new ConflictException(`${id} is ${row.status.toLowerCase()} — only fresh finished goods can be packed.`);
      }
      const unit = await tx.finishedGood.update({
        where: { id: row.id },
        data: { status: FgStatus.UNDER_PACKING },
        select: { id: true, uniqueId: true, family: true, productName: true, status: true },
      });
      await this.audit.log(
        {
          entityType: 'FinishedGood',
          entityId: unit.id,
          action: 'FG_UNDER_PACKING',
          actorId: user.id,
          device: device ?? null,
          before: { status: row.status },
          after: { uniqueId: unit.uniqueId, family: unit.family, status: FgStatus.UNDER_PACKING },
        },
        tx,
      );
      return unit;
    });
  }

  /** This packer's cartons (ADMIN/OVERSIGHT read them all), optionally filtered by status. */
  async cartons(user: AuthUser, status?: CartonStatus) {
    const mineOnly = user.role === 'PACKER';
    const rows = await this.prisma.carton.findMany({
      where: {
        ...(mineOnly ? { packedById: user.id } : {}),
        ...(status ? { status } : {}),
      },
      include: cartonInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((c) => this.withPhase(c));
  }

  async carton(user: AuthUser, id: string) {
    const c = await this.prisma.carton.findUnique({ where: { id }, include: cartonInclude });
    if (!c) throw new NotFoundException('Carton not found');
    if (user.role === 'PACKER' && c.packedById !== user.id) {
      throw new NotFoundException('Carton not found');
    }
    return this.withPhase(c);
  }

  /** Start a new empty DRAFT carton. */
  async createCarton(user: AuthUser) {
    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.carton.create({
        data: { uniqueId: 'pending', packedById: user.id },
      });
      // Replace the temporary value with a per-row draft placeholder (needs the id).
      const carton = await tx.carton.update({
        where: { id: c.id },
        data: { uniqueId: draftPlaceholder(c.id) },
        include: cartonInclude,
      });
      await this.audit.log(
        { entityType: 'Carton', entityId: carton.id, action: 'CARTON_STARTED', actorId: user.id },
        tx,
      );
      return carton;
    });
    return this.withPhase(created);
  }

  /** Add a unit to a DRAFT carton. The unit must be one of the packer's UNDER_PACKING units. */
  async addItem(user: AuthUser, cartonId: string, uniqueId: string) {
    const id = uniqueId.trim();
    await this.prisma.$transaction(async (tx) => {
      const carton = await this.lockCartonForEdit(tx, user, cartonId);

      const unit = await tx.finishedGood.findUnique({
        where: { uniqueId: id },
        select: { id: true, status: true, uniqueId: true, cartonItem: { select: { cartonId: true } } },
      });
      if (!unit) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
      if (unit.status !== FgStatus.UNDER_PACKING) {
        throw new ConflictException(`${id} is not under packing — scan it in first.`);
      }
      if (unit.cartonItem) {
        throw new ConflictException(`${id} is already in a carton.`);
      }
      // The DB UNIQUE on finishedGoodId is the real guarantee; this catch turns a raced
      // duplicate into the same friendly 409 rather than a 500.
      try {
        await tx.cartonItem.create({ data: { cartonId: carton.id, finishedGoodId: unit.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(`${id} is already in a carton.`);
        }
        throw e;
      }
      await this.audit.log(
        {
          entityType: 'Carton',
          entityId: carton.id,
          action: 'CARTON_ITEM_ADDED',
          actorId: user.id,
          after: { unit: id },
        },
        tx,
      );
    });
    // Read AFTER commit — a mid-transaction read on this.prisma's connection sees stale data.
    return this.carton(user, cartonId);
  }

  /** Remove a unit from a DRAFT carton (the unit stays UNDER_PACKING, back in the pool). */
  async removeItem(user: AuthUser, cartonId: string, fgUniqueId: string) {
    const id = fgUniqueId.trim();
    await this.prisma.$transaction(async (tx) => {
      const carton = await this.lockCartonForEdit(tx, user, cartonId);
      const unit = await tx.finishedGood.findUnique({ where: { uniqueId: id }, select: { id: true } });
      if (!unit) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
      const item = await tx.cartonItem.findUnique({ where: { finishedGoodId: unit.id } });
      if (!item || item.cartonId !== carton.id) {
        throw new NotFoundException(`${id} is not in this carton.`);
      }
      await tx.cartonItem.delete({ where: { id: item.id } });
      await this.audit.log(
        { entityType: 'Carton', entityId: carton.id, action: 'CARTON_ITEM_REMOVED', actorId: user.id, after: { unit: id } },
        tx,
      );
    });
    return this.carton(user, cartonId);
  }

  /**
   * THE HARD GATE. Confirm a DRAFT carton: mint its PG id, FREEZE the contents. Mirrors the
   * production-output confirm. Refuses an empty carton and refuses to confirm twice.
   */
  async confirmCarton(user: AuthUser, cartonId: string) {
    await this.prisma.$transaction(async (tx) => {
      const carton = await this.lockCartonForEdit(tx, user, cartonId);
      const count = await tx.cartonItem.count({ where: { cartonId: carton.id } });
      if (count === 0) {
        throw new BadRequestException('A carton must contain at least one unit before it is confirmed.');
      }
      const seq = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${CARTON_SEQ}') AS v`);
      const pgId = formatCartonId(seq[0].v);
      await tx.carton.update({
        where: { id: carton.id },
        data: { uniqueId: pgId, confirmedAt: new Date() },
      });
      await this.audit.log(
        {
          entityType: 'Carton',
          entityId: carton.id,
          action: 'CARTON_CONFIRMED',
          actorId: user.id,
          after: { pg: pgId, unitCount: count },
        },
        tx,
      );
    });
    // Read AFTER commit so the response carries the freshly-minted PG.
    return this.carton(user, cartonId);
  }

  /**
   * Scan the PG to mark the carton PACKED — the physical seal step. The carton must be
   * confirmed (frozen) and not yet packed; its contents follow it to PACKED.
   */
  async markPacked(user: AuthUser, pgUniqueId: string, device?: string) {
    const id = pgUniqueId.trim();
    if (!isCartonId(id)) throw new BadRequestException(`${id} is not a carton (PG-) code.`);
    const cartonId = await this.prisma.$transaction(async (tx) => {
      const carton = await this.lockCartonByPg(tx, id);
      if (user.role === 'PACKER' && carton.packedById !== user.id) {
        throw new NotFoundException(`No carton with ID ${id}`);
      }
      if (carton.status === CartonStatus.VOIDED) throw new ConflictException(`${id} was voided.`);
      if (!carton.confirmedAt) throw new ConflictException(`${id} is still a draft — confirm it before marking it packed.`);
      if (carton.status === CartonStatus.PACKED) throw new ConflictException(`${id} was already marked packed.`);
      if (carton.status !== CartonStatus.DRAFT) throw new ConflictException(`${id} is ${carton.status.toLowerCase()} and cannot be packed.`);

      await tx.carton.update({ where: { id: carton.id }, data: { status: CartonStatus.PACKED, packedAt: new Date() } });
      const items = await tx.cartonItem.findMany({ where: { cartonId: carton.id }, select: { finishedGoodId: true } });
      await tx.finishedGood.updateMany({
        where: { id: { in: items.map((i) => i.finishedGoodId) } },
        data: { status: FgStatus.PACKED },
      });
      await this.audit.log(
        { entityType: 'Carton', entityId: carton.id, action: 'CARTON_PACKED', actorId: user.id, device: device ?? null, after: { pg: id, unitCount: items.length } },
        tx,
      );
      return carton.id;
    });
    return this.carton(user, cartonId);
  }

  /**
   * Void a carton and RELEASE its contents. A confirmed carton is frozen — this is the
   * only way to change one: its units go back to UNDER_PACKING (repackable), its PG is
   * retired forever. Allowed unless the carton is already dispatched or voided.
   */
  async voidCarton(user: AuthUser, cartonId: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('A reason is required to void a carton.');
    await this.prisma.$transaction(async (tx) => {
      const carton = await this.lockCarton(tx, cartonId);
      if (user.role === 'PACKER' && carton.packedById !== user.id) throw new NotFoundException('Carton not found');
      if (carton.status === CartonStatus.DISPATCHED) throw new ConflictException('A dispatched carton cannot be voided — that is a return.');
      if (carton.status === CartonStatus.VOIDED) throw new ConflictException('This carton is already voided.');

      const items = await tx.cartonItem.findMany({ where: { cartonId: carton.id }, select: { id: true, finishedGoodId: true } });
      // Release each unit back to the pool, then drop the membership rows (freeing the
      // UNIQUE so they can join a fresh carton).
      if (items.length) {
        await tx.finishedGood.updateMany({
          where: { id: { in: items.map((i) => i.finishedGoodId) } },
          data: { status: FgStatus.UNDER_PACKING },
        });
        await tx.cartonItem.deleteMany({ where: { cartonId: carton.id } });
      }
      await tx.carton.update({
        where: { id: carton.id },
        data: { status: CartonStatus.VOIDED, voidedAt: new Date(), voidedById: user.id, voidReason: why },
      });
      await this.audit.log(
        {
          entityType: 'Carton',
          entityId: carton.id,
          action: 'CARTON_VOIDED',
          actorId: user.id,
          before: { pg: carton.uniqueId, status: carton.status },
          after: { released: items.length, reason: why },
        },
        tx,
      );
    });
    return this.carton(user, cartonId);
  }

  /**
   * Resolve a PG scan to its exact contents — the mega-QR reveal. Used by dispatch before
   * shipping and by trace. A voided carton resolves too, so the caller can SEE it is voided
   * and refuse it (dispatch does).
   */
  async resolveCarton(uniqueId: string) {
    const id = uniqueId.trim();
    if (!isCartonId(id)) throw new BadRequestException(`${id} is not a carton (PG-) code.`);
    const c = await this.prisma.carton.findUnique({ where: { uniqueId: id }, include: cartonInclude });
    if (!c) throw new NotFoundException(`No carton with ID ${id}`);
    return this.withPhase(c);
  }

  /**
   * The carton's A5 mega label PDF. Only a CONFIRMED carton has a PG to print. The first
   * print is free; a later print is the reprint lock's business (Oversight approves via
   * the existing door), exactly like the FG output roll.
   */
  async cartonLabel(user: AuthUser, cartonId: string): Promise<Buffer> {
    const c = await this.carton(user, cartonId);
    if (!c.confirmedAt) {
      throw new ConflictException('Confirm the carton before printing its label.');
    }
    const scope = { kind: 'CARTON_LABEL', cartonId: c.id } as const;
    await this.reprints.assertMayPrint(scope);
    const pdf = await buildCartonLabel(this.labelDocFor(c));
    await this.reprints.consumePrint(scope, user.id, 'PDF');
    return pdf;
  }

  // ── Packing lists (the factory's real workflow: compose a list, confirm it whole) ──

  /** Start a new empty DRAFT packing list. */
  async createList(user: AuthUser) {
    const created = await this.prisma.$transaction(async (tx) => {
      const l = await tx.packingList.create({ data: { packedById: user.id } });
      await this.audit.log({ entityType: 'PackingList', entityId: l.id, action: 'PACKING_LIST_STARTED', actorId: user.id }, tx);
      return l;
    });
    return this.packingList(user, created.id);
  }

  /** This packer's lists (ADMIN/OVERSIGHT see all), optionally by status. */
  async lists(user: AuthUser, status?: PackingListStatus) {
    const mineOnly = user.role === 'PACKER';
    const rows = await this.prisma.packingList.findMany({
      where: { ...(mineOnly ? { packedById: user.id } : {}), ...(status ? { status } : {}) },
      include: packingListInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((l) => this.withListShape(l));
  }

  async packingList(user: AuthUser, id: string) {
    const l = await this.prisma.packingList.findUnique({ where: { id }, include: packingListInclude });
    if (!l) throw new NotFoundException('Packing list not found');
    if (user.role === 'PACKER' && l.packedById !== user.id) throw new NotFoundException('Packing list not found');
    return this.withListShape(l);
  }

  /**
   * Add ONE entry to a DRAFT list — a straight (one unit) or a combo (several). Each entry
   * is a DRAFT carton; the units must be the packer's UNDER_PACKING units, none already in
   * a carton (the DB UNIQUE is the real guarantee).
   */
  async addEntry(user: AuthUser, listId: string, uniqueIds: string[]) {
    const ids = [...new Set(uniqueIds.map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) throw new BadRequestException('An entry needs at least one unit.');
    await this.prisma.$transaction(async (tx) => {
      const list = await this.lockListForEdit(tx, user, listId);
      const carton = await tx.carton.create({
        data: { uniqueId: `pending`, packedById: user.id, packingListId: list.id },
      });
      await tx.carton.update({ where: { id: carton.id }, data: { uniqueId: draftPlaceholder(carton.id) } });
      for (const id of ids) {
        const unit = await tx.finishedGood.findUnique({
          where: { uniqueId: id },
          select: { id: true, status: true, cartonItem: { select: { cartonId: true } } },
        });
        if (!unit) throw new NotFoundException(`No finished-goods unit with ID ${id}`);
        if (unit.status !== FgStatus.UNDER_PACKING) throw new ConflictException(`${id} is not under packing — scan it in first.`);
        if (unit.cartonItem) throw new ConflictException(`${id} is already in a carton.`);
        try {
          await tx.cartonItem.create({ data: { cartonId: carton.id, finishedGoodId: unit.id } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException(`${id} is already in a carton.`);
          }
          throw e;
        }
      }
      await this.audit.log(
        { entityType: 'PackingList', entityId: list.id, action: 'PACKING_LIST_ENTRY_ADDED', actorId: user.id, after: { units: ids, kind: ids.length === 1 ? 'straight' : 'combo' } },
        tx,
      );
    });
    return this.packingList(user, listId);
  }

  /** Remove a DRAFT entry from a DRAFT list — releases its units back to the pool. */
  async removeEntry(user: AuthUser, listId: string, cartonId: string) {
    await this.prisma.$transaction(async (tx) => {
      const list = await this.lockListForEdit(tx, user, listId);
      const carton = await tx.carton.findUnique({ where: { id: cartonId }, select: { id: true, packingListId: true, confirmedAt: true } });
      if (!carton || carton.packingListId !== list.id) throw new NotFoundException('That entry is not in this list.');
      if (carton.confirmedAt) throw new ConflictException('That entry is confirmed — void it instead.');
      const items = await tx.cartonItem.findMany({ where: { cartonId }, select: { finishedGoodId: true } });
      if (items.length) {
        await tx.finishedGood.updateMany({ where: { id: { in: items.map((i) => i.finishedGoodId) } }, data: { status: FgStatus.UNDER_PACKING } });
        await tx.cartonItem.deleteMany({ where: { cartonId } });
      }
      await tx.carton.delete({ where: { id: cartonId } });
      await this.audit.log({ entityType: 'PackingList', entityId: list.id, action: 'PACKING_LIST_ENTRY_REMOVED', actorId: user.id, after: { released: items.length } }, tx);
    });
    return this.packingList(user, listId);
  }

  /**
   * THE LIST CONFIRM — one act mints a PG for EVERY entry (straights included), sequential,
   * in one transaction. Refuses an empty list or one holding an empty entry. After this the
   * whole list is frozen; individual entries still void/repack via the carton path.
   */
  async confirmList(user: AuthUser, listId: string) {
    await this.prisma.$transaction(async (tx) => {
      const list = await this.lockListForEdit(tx, user, listId);
      const entries = await tx.carton.findMany({
        where: { packingListId: list.id, confirmedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, _count: { select: { items: true } } },
      });
      if (entries.length === 0) throw new BadRequestException('The list has no unconfirmed entries to confirm.');
      const pgs: string[] = [];
      for (const e of entries) {
        if (e._count.items === 0) throw new BadRequestException('An entry has no units — remove it before confirming the list.');
        const seq = await tx.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('${CARTON_SEQ}') AS v`);
        const pgId = formatCartonId(seq[0].v);
        await tx.carton.update({ where: { id: e.id }, data: { uniqueId: pgId, confirmedAt: new Date() } });
        pgs.push(pgId);
      }
      await tx.packingList.update({ where: { id: list.id }, data: { status: PackingListStatus.CONFIRMED, confirmedAt: new Date() } });
      await this.audit.log(
        { entityType: 'PackingList', entityId: list.id, action: 'PACKING_LIST_CONFIRMED', actorId: user.id, after: { entries: pgs.length, firstPg: pgs[0], lastPg: pgs.at(-1), pgs } },
        tx,
      );
    });
    return this.packingList(user, listId);
  }

  /** ONE PDF: every confirmed entry's A5 label, in list order. First print free; reprints locked. */
  async listLabels(user: AuthUser, listId: string): Promise<Buffer> {
    const l = await this.packingList(user, listId);
    const confirmed = l.cartons.filter((c) => c.confirmedAt);
    if (confirmed.length === 0) throw new ConflictException('Confirm the list before printing its labels.');
    // Each carton label is individually locked; the sheet respects every one of them.
    for (const c of confirmed) await this.reprints.assertMayPrint({ kind: 'CARTON_LABEL', cartonId: c.id });
    const pdf = await buildCartonLabelSheet(confirmed.map((c) => this.labelDocFor(c)));
    for (const c of confirmed) await this.reprints.consumePrint({ kind: 'CARTON_LABEL', cartonId: c.id }, user.id, 'PDF-LIST');
    return pdf;
  }

  /** Map a carton (with items) to a detailed label doc — per-unit id/name/family/size+unit. */
  private labelDocFor(c: {
    uniqueId: string;
    packedAt: Date | null;
    packedBy?: { name: string } | null;
    items: { finishedGood: { uniqueId: string; productName: string; family: string; sizePerPackage: number; sizeUnit: string; batch?: { batchNumber: string } | null } }[];
  }): CartonLabelDoc {
    return {
      uniqueId: c.uniqueId,
      packedAt: c.packedAt,
      packedBy: c.packedBy?.name ?? null,
      items: c.items.map((it) => ({
        uniqueId: it.finishedGood.uniqueId,
        productName: it.finishedGood.productName,
        family: it.finishedGood.family,
        // Quantity = the output's per-family size + unit; kg/L never blended into a total.
        size: `${it.finishedGood.sizePerPackage} ${it.finishedGood.sizeUnit}`,
        batchNumber: it.finishedGood.batch?.batchNumber ?? null,
      })),
    };
  }

  /** Lock a DRAFT list owned by the packer, editable. */
  private async lockListForEdit(tx: Prisma.TransactionClient, user: AuthUser, listId: string) {
    await tx.$queryRaw`SELECT "id" FROM "PackingList" WHERE "id" = ${listId} FOR UPDATE`;
    const list = await tx.packingList.findUnique({ where: { id: listId } });
    if (!list) throw new NotFoundException('Packing list not found');
    if (user.role === 'PACKER' && list.packedById !== user.id) throw new NotFoundException('Packing list not found');
    if (list.status !== PackingListStatus.DRAFT) throw new ConflictException('This list is already confirmed.');
    return list;
  }

  /** Shape a list for the API: attach each carton's derived phase/pg (all fields preserved). */
  private withListShape<
    C extends { status: CartonStatus; confirmedAt: Date | null; uniqueId: string },
    L extends { cartons: C[] },
  >(l: L) {
    return { ...l, cartons: (l.cartons ?? []).map((c) => this.withPhase(c)) };
  }

  // ── internals ──

  /** Lock a carton row FOR UPDATE and return the ORM row (fresh). */
  private async lockCarton(tx: Prisma.TransactionClient, cartonId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Carton" WHERE "id" = ${cartonId} FOR UPDATE`;
    const carton = await tx.carton.findUnique({ where: { id: cartonId } });
    if (!carton) throw new NotFoundException('Carton not found');
    return carton;
  }

  private async lockCartonByPg(tx: Prisma.TransactionClient, pgId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Carton" WHERE "uniqueId" = ${pgId} FOR UPDATE`;
    const carton = await tx.carton.findUnique({ where: { uniqueId: pgId } });
    if (!carton) throw new NotFoundException(`No carton with ID ${pgId}`);
    return carton;
  }

  /** Lock a carton and assert it is the packer's own AND still editable (DRAFT, unconfirmed). */
  private async lockCartonForEdit(tx: Prisma.TransactionClient, user: AuthUser, cartonId: string) {
    const carton = await this.lockCarton(tx, cartonId);
    if (user.role === 'PACKER' && carton.packedById !== user.id) throw new NotFoundException('Carton not found');
    if (carton.status !== CartonStatus.DRAFT || carton.confirmedAt) {
      throw new ConflictException('This carton is confirmed and can no longer be edited. Void it to make changes.');
    }
    return carton;
  }

  /**
   * Derive a human PHASE from (status, confirmedAt), because a confirmed-but-unscanned
   * carton is physically distinct from a fresh draft yet both carry status DRAFT (the enum
   * holds the physical milestone; confirmedAt holds the freeze). Never persisted.
   */
  private withPhase<T extends { status: CartonStatus; confirmedAt: Date | null; uniqueId: string }>(c: T) {
    const phase =
      c.status === CartonStatus.DRAFT ? (c.confirmedAt ? 'CONFIRMED' : 'DRAFT') : c.status;
    return { ...c, phase, pg: c.confirmedAt ? c.uniqueId : null };
  }
}
