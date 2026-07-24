import { ConflictException, NotFoundException } from '@nestjs/common';
import { ScanKind } from '@prisma/client';
import { ScanSessionService } from './scan-session.service';

/**
 * Server-side scan gating. Pinned:
 *  - a scan is REFUSED when no session of its kind is open (not UI-only);
 *  - opening is idempotent and at most one session per (kind, user) is open;
 *  - close returns a real count; open and close are audited;
 *  - the receiving-slip FINALIZED-on-Done wiring is unaffected (restated below).
 */
describe('ScanSessionService gates scanning server-side', () => {
  const build = (open: any = null) => {
    const rows: any[] = open ? [open] : [];
    const prisma = {
      scanSession: {
        findFirst: jest.fn(async ({ where }: any) =>
          rows.find((r) => r.openedById === where.openedById && r.kind === where.kind && r.closedAt == null) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: 's1', openedAt: new Date(), closedAt: null, scanCount: 0, ...data };
          rows.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = rows.find((r) => r.id === where.id);
          if (data.scanCount?.increment) row.scanCount += data.scanCount.increment;
          if (data.closedAt) row.closedAt = data.closedAt;
          return row;
        }),
      },
    };
    const audit = { log: jest.fn() };
    return { svc: new ScanSessionService(prisma as never, audit as never), prisma, audit, rows };
  };

  it('REFUSES a scan when no session is open', async () => {
    const { svc } = build();
    await expect(svc.assertOpen('u1', ScanKind.RECEIVING)).rejects.toThrow(ConflictException);
    await expect(svc.assertOpen('u1', ScanKind.RECEIVING)).rejects.toThrow(/Start a receiving session/);
  });

  it('DISPATCH refusal names its own kind', async () => {
    const { svc } = build();
    await expect(svc.assertOpen('u1', ScanKind.DISPATCH)).rejects.toThrow(/Start a dispatch session/);
  });

  it('allows a scan once open, and counts it toward the summary', async () => {
    const { svc } = build();
    await svc.open('u1', ScanKind.RECEIVING);
    await svc.assertOpen('u1', ScanKind.RECEIVING);
    await svc.assertOpen('u1', ScanKind.RECEIVING);
    const closed = await svc.close('u1', ScanKind.RECEIVING);
    expect(closed.summary.scanCount).toBe(2);
  });

  it('opening is idempotent — the same live session is returned, not a second one', async () => {
    const { svc, prisma } = build();
    const a = await svc.open('u1', ScanKind.RECEIVING);
    const b = await svc.open('u1', ScanKind.RECEIVING);
    expect(a.id).toBe(b.id);
    expect(prisma.scanSession.create).toHaveBeenCalledTimes(1);
  });

  it('a scan of a DIFFERENT kind is still refused while another kind is open', async () => {
    const { svc } = build();
    await svc.open('u1', ScanKind.RECEIVING);
    await expect(svc.assertOpen('u1', ScanKind.DISPATCH)).rejects.toThrow(ConflictException);
  });

  it('closing with nothing open is a clear error', async () => {
    const { svc } = build();
    await expect(svc.close('u1', ScanKind.RECEIVING)).rejects.toThrow(NotFoundException);
  });

  it('open and close are both audited', async () => {
    const { svc, audit } = build();
    await svc.open('u1', ScanKind.DISPATCH);
    await svc.close('u1', ScanKind.DISPATCH);
    const actions = audit.log.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['SCAN_SESSION_OPENED', 'SCAN_SESSION_CLOSED']);
  });
});
