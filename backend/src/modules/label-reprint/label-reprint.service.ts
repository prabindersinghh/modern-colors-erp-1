import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LabelScope, Prisma, ReprintStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** What a print covers. Exactly one target, mirrored by a CHECK constraint in the DB. */
export type PrintScope =
  | { kind: 'PO_LABELS'; poId: string }
  | { kind: 'MC_UNIT_LABEL'; materialId: string }
  | { kind: 'FG_OUTPUT_LABELS'; outputId: string }
  | { kind: 'FG_UNIT_LABEL'; finishedGoodId: string }
  | { kind: 'CARTON_LABEL'; cartonId: string };

/** The most prints one approval may grant. A quota, not a blank cheque. */
export const MAX_PRINTS_PER_APPROVAL = 100;

/** How a print was authorised — recorded in the audit trail. */
export type PrintAuthority =
  | { via: 'FIRST_PRINT' }
  | { via: 'CORRECTION' }
  | { via: 'APPROVAL'; requestId: string; remainingAfter: number };

const scopeWhere = (scope: PrintScope): Prisma.LabelReprintRequestWhereInput => {
  switch (scope.kind) {
    case 'PO_LABELS':
      return { scope: LabelScope.PO_LABELS, poId: scope.poId };
    case 'MC_UNIT_LABEL':
      return { scope: LabelScope.MC_UNIT_LABEL, materialId: scope.materialId };
    case 'FG_OUTPUT_LABELS':
      return { scope: LabelScope.FG_OUTPUT_LABELS, outputId: scope.outputId };
    case 'FG_UNIT_LABEL':
      return { scope: LabelScope.FG_UNIT_LABEL, finishedGoodId: scope.finishedGoodId };
    case 'CARTON_LABEL':
      return { scope: LabelScope.CARTON_LABEL, cartonId: scope.cartonId };
  }
};

const scopeLabel = (scope: PrintScope): string => {
  switch (scope.kind) {
    case 'PO_LABELS':
      return 'these invoice labels';
    case 'FG_OUTPUT_LABELS':
      return "this output's labels";
    case 'CARTON_LABEL':
      return "this carton's label";
    default:
      return 'this label';
  }
};

/**
 * Label reprints — the lock.
 *
 * MINTING IS NOT TOUCHED. A QR is still created exactly once, at registration (MC) or
 * at output confirm (FG), and this service is never involved in that. What it gates is
 * printing labels that have ALREADY been printed: the same stored payload, through the
 * same renderer, onto more paper.
 *
 * The shape of the lock:
 *  - the FIRST print of any label is free and silent — no request, no approval;
 *  - every later print needs an APPROVED request, which carries a quota the factory
 *    Admin chooses (one more print, or several). Each print spends one; when the quota
 *    is gone the request is CONSUMED and the labels are locked again;
 *  - a finished-goods unit flagged `qrReprintNeeded` by a correction carries its own
 *    single-use allowance, because the correction (an OVERSIGHT act in its own right)
 *    is what made the printed sticker wrong.
 *
 * All four raw-material export formats — roll PDF, PNG zip, CSV and single-unit PNG —
 * share ONE allowance, because they all yield the same physical sticker. Switching
 * format is not a way to get a second free print.
 */
@Injectable()
export class LabelReprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── reading the lock ──

  /** Have any of the labels in this scope been printed before? */
  async alreadyPrinted(scope: PrintScope): Promise<boolean> {
    if (scope.kind === 'MC_UNIT_LABEL') {
      const m = await this.prisma.material.findUnique({
        where: { id: scope.materialId },
        select: { labelPrintedAt: true },
      });
      return !!m?.labelPrintedAt;
    }
    if (scope.kind === 'PO_LABELS') {
      return (
        (await this.prisma.material.count({
          where: { poId: scope.poId, labelPrintedAt: { not: null } },
        })) > 0
      );
    }
    if (scope.kind === 'FG_OUTPUT_LABELS') {
      return (
        (await this.prisma.finishedGood.count({
          where: { outputId: scope.outputId, labelPrintedAt: { not: null } },
        })) > 0
      );
    }
    if (scope.kind === 'CARTON_LABEL') {
      const c = await this.prisma.carton.findUnique({
        where: { id: scope.cartonId },
        select: { labelPrintedAt: true },
      });
      return !!c?.labelPrintedAt;
    }
    const fg = await this.prisma.finishedGood.findUnique({
      where: { id: scope.finishedGoodId },
      select: { labelPrintedAt: true },
    });
    return !!fg?.labelPrintedAt;
  }

  /** The live (pending or approved) request for a scope, if any. */
  async liveRequest(scope: PrintScope) {
    return this.prisma.labelReprintRequest.findFirst({
      where: {
        ...scopeWhere(scope),
        status: { in: [ReprintStatus.PENDING, ReprintStatus.APPROVED] },
      },
      orderBy: { requestedAt: 'desc' },
      include: { requestedBy: { select: { email: true, name: true } } },
    });
  }

  /**
   * Refuse early, before any PDF is rendered. This is a read-only pre-check; the
   * authoritative consume happens in {@link consumePrint} inside a transaction, so two
   * simultaneous prints can never both spend the last of a quota.
   */
  async assertMayPrint(scope: PrintScope): Promise<void> {
    if (!(await this.alreadyPrinted(scope))) return; // first print — always free

    if (scope.kind === 'FG_UNIT_LABEL') {
      const fg = await this.prisma.finishedGood.findUnique({
        where: { id: scope.finishedGoodId },
        select: { qrReprintNeeded: true },
      });
      if (fg?.qrReprintNeeded) return; // correction carries its own allowance
    }

    const live = await this.liveRequest(scope);
    if (live?.status === ReprintStatus.APPROVED && live.printsUsed < live.printsApproved) return;

    throw new ForbiddenException(
      live?.status === ReprintStatus.PENDING
        ? `A reprint of ${scopeLabel(scope)} is waiting for the factory Admin to approve it.`
        : `${scopeLabel(scope)[0].toUpperCase()}${scopeLabel(scope).slice(1)} have already been printed. ` +
          'Request a reprint and have the factory Admin approve it first.',
    );
  }

  // ── spending the lock ──

  /**
   * Record that a print happened, consuming an allowance if this was a reprint.
   *
   * Runs in one transaction and re-checks the quota inside it: the UPDATE that spends a
   * print carries `printsUsed < printsApproved` in its WHERE, so a concurrent print
   * cannot overspend. Called AFTER the PDF renders, so a rendering failure never burns
   * somebody's quota — and if this throws, the caller must not return the file.
   */
  async consumePrint(scope: PrintScope, actorId: string, format: string): Promise<PrintAuthority> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const printedBefore = await this.countPrinted(tx, scope);

      // ---- first print: free, and stamps every label in the scope ----
      if (printedBefore === 0) {
        await this.stampPrinted(tx, scope, now);
        await this.audit.log(
          {
            entityType: 'Label',
            entityId: this.targetId(scope),
            action: 'LABEL_PRINTED',
            actorId,
            after: { scope: scope.kind, format, first: true },
          },
          tx,
        );
        return { via: 'FIRST_PRINT' as const };
      }

      // ---- a correction made the sticker wrong: single-use, self-authorising ----
      if (scope.kind === 'FG_UNIT_LABEL') {
        const cleared = await tx.finishedGood.updateMany({
          where: { id: scope.finishedGoodId, qrReprintNeeded: true },
          data: { qrReprintNeeded: false, labelPrintedAt: now },
        });
        if (cleared.count === 1) {
          await this.audit.log(
            {
              entityType: 'Label',
              entityId: scope.finishedGoodId,
              action: 'LABEL_REPRINTED',
              actorId,
              after: { scope: scope.kind, format, source: 'CORRECTION' },
            },
            tx,
          );
          return { via: 'CORRECTION' as const };
        }
      }

      // ---- otherwise: spend one print from an approved quota ----
      const approved = await tx.labelReprintRequest.findFirst({
        where: {
          ...scopeWhere(scope),
          status: ReprintStatus.APPROVED,
        },
        orderBy: { decidedAt: 'asc' },
      });
      if (!approved || approved.printsUsed >= approved.printsApproved) {
        throw new ForbiddenException(
          `${scopeLabel(scope)[0].toUpperCase()}${scopeLabel(scope).slice(1)} have already been printed. ` +
            'Request a reprint and have the factory Admin approve it first.',
        );
      }

      // The WHERE re-states the quota, so this UPDATE is the real gate.
      const spent = await tx.labelReprintRequest.updateMany({
        where: { id: approved.id, status: ReprintStatus.APPROVED, printsUsed: { lt: approved.printsApproved } },
        data: { printsUsed: { increment: 1 }, lastPrintedAt: now },
      });
      if (spent.count !== 1) {
        throw new ForbiddenException('That reprint approval was just used up. Please request another.');
      }

      const after = await tx.labelReprintRequest.findUniqueOrThrow({ where: { id: approved.id } });
      const exhausted = after.printsUsed >= after.printsApproved;
      if (exhausted) {
        await tx.labelReprintRequest.update({
          where: { id: approved.id },
          data: { status: ReprintStatus.CONSUMED },
        });
      }
      await this.stampPrinted(tx, scope, now);

      await this.audit.log(
        {
          entityType: 'Label',
          entityId: this.targetId(scope),
          action: 'LABEL_REPRINTED',
          actorId,
          after: {
            scope: scope.kind,
            format,
            source: 'APPROVAL',
            requestId: approved.id,
            printsUsed: after.printsUsed,
            printsApproved: after.printsApproved,
            approvalExhausted: exhausted,
          },
        },
        tx,
      );

      return {
        via: 'APPROVAL' as const,
        requestId: approved.id,
        remainingAfter: after.printsApproved - after.printsUsed,
      };
    });
  }

  // ── the request/approve workflow ──

  /** Raise a reprint request. Only meaningful once the labels have been printed. */
  async request(actorId: string, scope: PrintScope, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('A reason is required to reprint labels.');

    await this.assertTargetExists(scope);

    if (!(await this.alreadyPrinted(scope))) {
      throw new BadRequestException(
        'These labels have not been printed yet — the first print needs no approval.',
      );
    }

    const live = await this.liveRequest(scope);
    if (live) {
      throw new ConflictException(
        live.status === ReprintStatus.PENDING
          ? 'A reprint request for these labels is already waiting for approval.'
          : 'These labels already have an approved reprint that has not been used up.',
      );
    }

    const created = await this.prisma.labelReprintRequest.create({
      data: {
        scope: LabelScope[scope.kind],
        poId: scope.kind === 'PO_LABELS' ? scope.poId : null,
        materialId: scope.kind === 'MC_UNIT_LABEL' ? scope.materialId : null,
        outputId: scope.kind === 'FG_OUTPUT_LABELS' ? scope.outputId : null,
        finishedGoodId: scope.kind === 'FG_UNIT_LABEL' ? scope.finishedGoodId : null,
        cartonId: scope.kind === 'CARTON_LABEL' ? scope.cartonId : null,
        reason: why,
        requestedById: actorId,
      },
    });

    await this.audit.log({
      entityType: 'Label',
      entityId: this.targetId(scope),
      action: 'LABEL_REPRINT_REQUESTED',
      actorId,
      after: { scope: scope.kind, reason: why, requestId: created.id },
    });
    return created;
  }

  /**
   * Approve a request for a chosen number of prints.
   *
   * The approver may not be the requester: OVERSIGHT can itself print raw-material
   * labels, so without this the door would let one person authorise their own reprint.
   */
  async approve(actorId: string, id: string, prints: number, note?: string) {
    if (!Number.isInteger(prints) || prints < 1 || prints > MAX_PRINTS_PER_APPROVAL) {
      throw new BadRequestException(
        `Approve between 1 and ${MAX_PRINTS_PER_APPROVAL} prints.`,
      );
    }
    const req = await this.pending(id);
    if (req.requestedById === actorId) {
      throw new ForbiddenException('A reprint cannot be approved by the person who requested it.');
    }

    const updated = await this.prisma.labelReprintRequest.update({
      where: { id },
      data: {
        status: ReprintStatus.APPROVED,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
        printsApproved: prints,
      },
    });

    await this.audit.log({
      entityType: 'Label',
      entityId: this.targetIdOf(req),
      action: 'LABEL_REPRINT_APPROVED',
      actorId,
      before: { status: ReprintStatus.PENDING },
      after: { requestId: id, scope: req.scope, printsApproved: prints, note: note?.trim() || null },
    });
    return updated;
  }

  async reject(actorId: string, id: string, note?: string) {
    const req = await this.pending(id);
    const updated = await this.prisma.labelReprintRequest.update({
      where: { id },
      data: {
        status: ReprintStatus.REJECTED,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    await this.audit.log({
      entityType: 'Label',
      entityId: this.targetIdOf(req),
      action: 'LABEL_REPRINT_REJECTED',
      actorId,
      before: { status: ReprintStatus.PENDING },
      after: { requestId: id, scope: req.scope, note: note?.trim() || null },
    });
    return updated;
  }

  /** Everything the factory Admin needs to decide, newest first. */
  async list(status?: ReprintStatus) {
    return this.prisma.labelReprintRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      take: 200,
      include: {
        requestedBy: { select: { email: true, name: true } },
        decidedBy: { select: { email: true, name: true } },
        po: { select: { poNumber: true, supplier: true } },
        material: { select: { uniqueId: true, materialName: true } },
        output: { select: { productName: true, batch: { select: { batchNumber: true } } } },
        finishedGood: { select: { uniqueId: true, productName: true } },
        carton: { select: { uniqueId: true, status: true } },
      },
    });
  }

  // ── helpers ──

  private async pending(id: string) {
    const req = await this.prisma.labelReprintRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('No such reprint request.');
    if (req.status !== ReprintStatus.PENDING) {
      throw new ConflictException(`That request has already been ${req.status.toLowerCase()}.`);
    }
    return req;
  }

  private targetId(scope: PrintScope): string {
    switch (scope.kind) {
      case 'PO_LABELS':
        return scope.poId;
      case 'MC_UNIT_LABEL':
        return scope.materialId;
      case 'FG_OUTPUT_LABELS':
        return scope.outputId;
      case 'FG_UNIT_LABEL':
        return scope.finishedGoodId;
      case 'CARTON_LABEL':
        return scope.cartonId;
    }
  }

  private targetIdOf(req: {
    poId: string | null;
    materialId: string | null;
    outputId: string | null;
    finishedGoodId: string | null;
    cartonId?: string | null;
  }): string {
    return req.poId ?? req.materialId ?? req.outputId ?? req.finishedGoodId ?? req.cartonId ?? '';
  }

  /** The target must exist, so a request can never be raised against nothing. */
  private async assertTargetExists(scope: PrintScope): Promise<void> {
    const found =
      scope.kind === 'PO_LABELS'
        ? await this.prisma.purchaseOrder.findUnique({ where: { id: scope.poId }, select: { id: true } })
        : scope.kind === 'MC_UNIT_LABEL'
          ? await this.prisma.material.findUnique({ where: { id: scope.materialId }, select: { id: true } })
          : scope.kind === 'FG_OUTPUT_LABELS'
            ? await this.prisma.productionOutput.findUnique({ where: { id: scope.outputId }, select: { id: true } })
            : scope.kind === 'CARTON_LABEL'
              ? await this.prisma.carton.findUnique({ where: { id: scope.cartonId }, select: { id: true } })
              : await this.prisma.finishedGood.findUnique({ where: { id: scope.finishedGoodId }, select: { id: true } });
    if (!found) throw new NotFoundException('Those labels no longer exist.');
  }

  private async countPrinted(tx: Prisma.TransactionClient, scope: PrintScope): Promise<number> {
    if (scope.kind === 'MC_UNIT_LABEL') {
      return tx.material.count({ where: { id: scope.materialId, labelPrintedAt: { not: null } } });
    }
    if (scope.kind === 'PO_LABELS') {
      return tx.material.count({ where: { poId: scope.poId, labelPrintedAt: { not: null } } });
    }
    if (scope.kind === 'FG_OUTPUT_LABELS') {
      return tx.finishedGood.count({ where: { outputId: scope.outputId, labelPrintedAt: { not: null } } });
    }
    if (scope.kind === 'CARTON_LABEL') {
      return tx.carton.count({ where: { id: scope.cartonId, labelPrintedAt: { not: null } } });
    }
    return tx.finishedGood.count({
      where: { id: scope.finishedGoodId, labelPrintedAt: { not: null } },
    });
  }

  /**
   * Stamp every label in the scope as printed. Printing a whole roll marks all of its
   * units, so pulling one unit's PNG afterwards is correctly seen as a reprint.
   */
  private async stampPrinted(tx: Prisma.TransactionClient, scope: PrintScope, at: Date): Promise<void> {
    if (scope.kind === 'MC_UNIT_LABEL') {
      await tx.material.update({ where: { id: scope.materialId }, data: { labelPrintedAt: at } });
      return;
    }
    if (scope.kind === 'PO_LABELS') {
      await tx.material.updateMany({ where: { poId: scope.poId }, data: { labelPrintedAt: at } });
      return;
    }
    if (scope.kind === 'FG_OUTPUT_LABELS') {
      await tx.finishedGood.updateMany({ where: { outputId: scope.outputId }, data: { labelPrintedAt: at } });
      return;
    }
    if (scope.kind === 'CARTON_LABEL') {
      await tx.carton.update({ where: { id: scope.cartonId }, data: { labelPrintedAt: at } });
      return;
    }
    await tx.finishedGood.update({ where: { id: scope.finishedGoodId }, data: { labelPrintedAt: at } });
  }
}
