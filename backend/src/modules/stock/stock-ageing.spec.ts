import { StockService } from './stock.service';
import { AGEING } from './fifo.util';

/**
 * The stock-ageing view (client feedback item 2): every in-stock unit bucketed by how
 * long it has been held, oldest first, with per-bucket KG totals. Prisma is faked so we
 * exercise the bucketing/ordering without a database.
 */
describe('StockService.ageing (30-day stock ageing view)', () => {
  const DAY = 86_400_000;
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

  function serviceWith(units: any[]) {
    const prisma: any = { material: { findMany: async () => units } };
    return new StockService(prisma, { log: async () => undefined } as any);
  }

  const units = [
    { uniqueId: 'MC-004', materialName: 'D', sku: null, balanceKg: 4, arrivedAt: daysAgo(1), po: null },
    { uniqueId: 'MC-001', materialName: 'A', sku: 'A1', balanceKg: 10, arrivedAt: daysAgo(90), po: { poNumber: 'PO-1', supplier: 'Acme' } },
    { uniqueId: 'MC-003', materialName: 'C', sku: null, balanceKg: 6, arrivedAt: daysAgo(31), po: null },
    { uniqueId: 'MC-002', materialName: 'B', sku: null, balanceKg: 5, arrivedAt: daysAgo(65), po: null },
  ];

  it('returns units oldest-first', async () => {
    const res = await serviceWith(units).ageing();
    expect(res.units.map((u) => u.uniqueId)).toEqual(['MC-001', 'MC-002', 'MC-003', 'MC-004']);
  });

  it('buckets by the shared 30/60-day thresholds', async () => {
    const res = await serviceWith(units).ageing();
    expect(res.thresholds).toEqual({ amberDays: AGEING.AMBER_DAYS, redDays: AGEING.RED_DAYS });
    // 90d and 65d are RED; 31d is AMBER; 1d is FRESH
    expect(res.buckets.red.unitCount).toBe(2);
    expect(res.buckets.red.totalKg).toBe(15); // 10 + 5
    expect(res.buckets.amber.unitCount).toBe(1);
    expect(res.buckets.amber.totalKg).toBe(6);
    expect(res.buckets.fresh.unitCount).toBe(1);
    expect(res.buckets.fresh.totalKg).toBe(4);
  });

  it('reports the oldest age and total unit count', async () => {
    const res = await serviceWith(units).ageing();
    expect(res.oldestAgeDays).toBeGreaterThanOrEqual(89);
    expect(res.totalUnits).toBe(4);
  });

  it('carries supplier / PO through for each unit', async () => {
    const res = await serviceWith(units).ageing();
    const oldest = res.units[0];
    expect(oldest.supplier).toBe('Acme');
    expect(oldest.poNumber).toBe('PO-1');
  });

  it('handles an empty stock list', async () => {
    const res = await serviceWith([]).ageing();
    expect(res.units).toEqual([]);
    expect(res.totalUnits).toBe(0);
    expect(res.oldestAgeDays).toBe(0);
    expect(res.buckets.red.totalKg).toBe(0);
  });
});
