import { FgStatus } from '@prisma/client';
import { DispatchService } from './dispatch.service';

/**
 * Per-batch dispatch progress — "34 of 50 dispatched · 68%".
 *
 * The rules: pct = dispatched / (dispatched + pending); scrapped and refurbished
 * originals are excluded from BOTH sides (they are no longer part of what the batch
 * ships), so progress can still honestly reach 100%.
 */
describe('DispatchService.ready — batch progress', () => {
  const unit = (batchId: string, uniqueId: string) => ({
    batchId,
    uniqueId,
    createdAt: new Date('2026-07-20'),
    batch: { id: batchId, batchNumber: `B-${batchId}`, department: 'PU' },
    productName: 'Weathershield White',
  });

  const build = (pending: unknown[], counts: { batchId: string; status: FgStatus; n: number }[]) => {
    const prisma = {
      finishedGood: {
        findMany: jest.fn().mockResolvedValue(pending),
        groupBy: jest
          .fn()
          .mockResolvedValue(counts.map((c) => ({ batchId: c.batchId, status: c.status, _count: { _all: c.n } }))),
      },
    };
    return new DispatchService(prisma as never, {} as never, { assertOpen: async () => "s" } as never);
  };

  it('reports dispatched / total / pct per batch', async () => {
    // Batch b1: 16 pending here + 34 already dispatched → 34 of 50 = 68%.
    const pending = Array.from({ length: 16 }, (_, i) => unit('b1', `FG-${i}`));
    const svc = build(pending, [
      { batchId: 'b1', status: FgStatus.DISPATCHED, n: 34 },
      { batchId: 'b1', status: FgStatus.GENERATED, n: 16 },
    ]);
    const res = await svc.ready();
    expect(res.batches).toHaveLength(1);
    expect(res.batches[0]).toMatchObject({ pending: 16, dispatched: 34, total: 50, pct: 68 });
  });

  it('excludes scrapped/refurbished originals from the progress figure', async () => {
    // 2 pending + 8 dispatched + 3 scrapped + 1 refurbished → total is 10, not 14.
    const pending = [unit('b1', 'FG-1'), unit('b1', 'FG-2')];
    const svc = build(pending, [
      { batchId: 'b1', status: FgStatus.DISPATCHED, n: 8 },
      { batchId: 'b1', status: FgStatus.GENERATED, n: 2 },
      { batchId: 'b1', status: FgStatus.SCRAPPED, n: 3 },
      { batchId: 'b1', status: FgStatus.REFURBISHED, n: 1 },
    ]);
    const res = await svc.ready();
    expect(res.batches[0]).toMatchObject({ pending: 2, dispatched: 8, total: 10, pct: 80 });
  });

  it('a fresh batch with nothing dispatched reads 0%', async () => {
    const pending = [unit('b2', 'FG-9')];
    const svc = build(pending, [{ batchId: 'b2', status: FgStatus.GENERATED, n: 1 }]);
    const res = await svc.ready();
    expect(res.batches[0]).toMatchObject({ pending: 1, dispatched: 0, total: 1, pct: 0 });
  });
});
