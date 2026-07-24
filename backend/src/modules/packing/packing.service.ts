import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CartonStatus, FgStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isFinishedGoodId } from '../finished-goods/fg-family';
import { LabelReprintService } from '../label-reprint/label-reprint.service';
import { buildCartonLabel } from './carton-label';
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

  /** Scan a unit into UNDER_PACKING. Double-scan guarded; must currently be GENERATED. */
  async scanIn(user: AuthUser, uniqueId: string, device?: string) {
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
    return this.prisma.$transaction(async (tx) => {
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
      return this.carton(user, carton.id);
    });
  }

  /** Remove a unit from a DRAFT carton (the unit stays UNDER_PACKING, back in the pool). */
  async removeItem(user: AuthUser, cartonId: string, fgUniqueId: string) {
    const id = fgUniqueId.trim();
    return this.prisma.$transaction(async (tx) => {
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
      return this.carton(user, carton.id);
    });
  }

  /**
   * THE HARD GATE. Confirm a DRAFT carton: mint its PG id, FREEZE the contents. Mirrors the
   * production-output confirm. Refuses an empty carton and refuses to confirm twice.
   */
  async confirmCarton(user: AuthUser, cartonId: string) {
    return this.prisma.$transaction(async (tx) => {
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
      return this.carton(user, carton.id);
    });
  }

  /**
   * Scan the PG to mark the carton PACKED — the physical seal step. The carton must be
   * confirmed (frozen) and not yet packed; its contents follow it to PACKED.
   */
  async markPacked(user: AuthUser, pgUniqueId: string, device?: string) {
    const id = pgUniqueId.trim();
    if (!isCartonId(id)) throw new BadRequestException(`${id} is not a carton (PG-) code.`);
    return this.prisma.$transaction(async (tx) => {
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
      return this.carton(user, carton.id);
    });
  }

  /**
   * Void a carton and RELEASE its contents. A confirmed carton is frozen — this is the
   * only way to change one: its units go back to UNDER_PACKING (repackable), its PG is
   * retired forever. Allowed unless the carton is already dispatched or voided.
   */
  async voidCarton(user: AuthUser, cartonId: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('A reason is required to void a carton.');
    return this.prisma.$transaction(async (tx) => {
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
      return this.carton(user, carton.id);
    });
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
    const pdf = await buildCartonLabel({
      uniqueId: c.uniqueId,
      packedAt: c.packedAt,
      packedBy: c.packedBy?.name ?? null,
      items: c.items.map((it) => ({
        uniqueId: it.finishedGood.uniqueId,
        productName: it.finishedGood.productName,
        family: it.finishedGood.family,
        size: `${it.finishedGood.sizePerPackage} ${it.finishedGood.sizeUnit}`,
        batchNumber: it.finishedGood.batch?.batchNumber ?? null,
      })),
    });
    await this.reprints.consumePrint(scope, user.id, 'PDF');
    return pdf;
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
