import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ScanKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Server-enforced Start/Done sessions for scanning.
 *
 * A scan of a given kind is refused unless the actor has an open session of that kind —
 * see {@link assertOpen}. Open and close are audited, and the close returns a summary
 * count. The partial unique index in the migration guarantees at most one open session
 * per (kind, user); a race to open a second surfaces here as a clear conflict.
 */
@Injectable()
export class ScanSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The caller's currently-open session of a kind, or null. */
  current(userId: string, kind: ScanKind) {
    return this.prisma.scanSession.findFirst({
      where: { openedById: userId, kind, closedAt: null },
    });
  }

  /**
   * Session history — who scanned, from when to when, how many. OVERSIGHT sees EVERY
   * session (the owner's total-visibility rule); everyone else sees only their own. A
   * read only: no scan can be started or closed through here.
   */
  list(user: { id: string; role: string }, kind?: ScanKind) {
    const all = user.role === 'OVERSIGHT';
    return this.prisma.scanSession.findMany({
      where: { ...(all ? {} : { openedById: user.id }), ...(kind ? { kind } : {}) },
      include: { openedBy: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
  }

  async open(userId: string, kind: ScanKind) {
    const existing = await this.current(userId, kind);
    if (existing) return existing; // idempotent: reopening returns the live one
    try {
      const session = await this.prisma.scanSession.create({
        data: { kind, openedById: userId },
      });
      await this.audit.log({
        entityType: 'ScanSession',
        entityId: session.id,
        action: 'SCAN_SESSION_OPENED',
        actorId: userId,
        after: { kind },
      });
      return session;
    } catch (e) {
      // The partial unique index rejected a concurrent second open.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const live = await this.current(userId, kind);
        if (live) return live;
      }
      throw e;
    }
  }

  async close(userId: string, kind: ScanKind) {
    const session = await this.current(userId, kind);
    if (!session) throw new NotFoundException('No open session to close.');
    const closed = await this.prisma.scanSession.update({
      where: { id: session.id },
      data: { closedAt: new Date() },
    });
    await this.audit.log({
      entityType: 'ScanSession',
      entityId: session.id,
      action: 'SCAN_SESSION_CLOSED',
      actorId: userId,
      before: { openedAt: session.openedAt },
      after: { kind, scanCount: closed.scanCount },
    });
    return { ...closed, summary: { scanCount: closed.scanCount, openedAt: session.openedAt, closedAt: closed.closedAt } };
  }

  /**
   * THE GATE — every scan endpoint calls this first. Refuses when no session of the
   * kind is open, and counts the scan against the open session so the close summary is
   * a real total. Returns the session id so callers can attribute if they wish.
   */
  async assertOpen(userId: string, kind: ScanKind): Promise<string> {
    const session = await this.current(userId, kind);
    if (!session) {
      const message =
        kind === ScanKind.RECEIVING
          ? 'Start a receiving session before scanning sacks in.'
          : kind === ScanKind.PACKING
            ? 'Start a packing session before scanning units in.'
            : 'Start a dispatch session before scanning goods out.';
      throw new ConflictException(message);
    }
    await this.prisma.scanSession.update({
      where: { id: session.id },
      data: { scanCount: { increment: 1 } },
    });
    return session.id;
  }
}
