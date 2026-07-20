import { ReceivingService } from './receiving.service';

/**
 * `recent()` seeds the receiving screen's running log so an operator opening it mid-shift
 * sees context instead of an empty list. It must return only units that were actually
 * received, newest first, and carry the same needsWeight signal a live scan does.
 */
describe('ReceivingService.recent — seeds the running log', () => {
  const build = (rows: Array<Record<string, unknown>> = []) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { material: { findMany } } as never;
    return { svc: new ReceivingService(prisma, {} as never), findMany };
  };

  it('returns received units newest-first with a needsWeight flag', async () => {
    const { svc, findMany } = build([
      { uniqueId: 'MC-000002', materialName: 'Solvent ABC', balanceKg: null, scannedAt: new Date('2026-07-21') },
      { uniqueId: 'MC-000001', materialName: 'Titanium Dioxide', balanceKg: 24, scannedAt: new Date('2026-07-20') },
    ]);
    const out = await svc.recent(12);

    expect(out.map((r) => r.uniqueId)).toEqual(['MC-000002', 'MC-000001']);
    expect(out[0].needsWeight).toBe(true); // null balance → blocked from issue
    expect(out[1].needsWeight).toBe(false);

    // Only units that were actually scanned in, newest first.
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ scannedAt: { not: null } });
    expect(arg.orderBy).toEqual({ scannedAt: 'desc' });
  });

  it('clamps take to a sane range', async () => {
    const { svc, findMany } = build();
    await svc.recent(9999);
    expect(findMany.mock.calls[0][0].take).toBe(50);
    await svc.recent(0);
    expect(findMany.mock.calls[1][0].take).toBe(1);
  });

  it('treats 0 kg as a known balance, not "needs weight"', async () => {
    // Load-bearing: null blocks stock movement, 0 does not. An emptied sack that was
    // received must not resurface in the log as if its weight were unknown.
    const { svc } = build([{ uniqueId: 'MC-1', materialName: 'X', balanceKg: 0, scannedAt: new Date() }]);
    const out = await svc.recent();
    expect(out[0].needsWeight).toBe(false);
  });
});
