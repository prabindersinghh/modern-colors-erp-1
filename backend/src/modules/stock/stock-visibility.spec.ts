import { StockService } from './stock.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { DispatchAnalyticsService } from '../analytics/dispatch-analytics.service';

/**
 * THE VISIBILITY CONTRACT — born from a real incident: material was scanned in at
 * Store and could not be found afterwards. Two causes, both pinned here:
 *
 *  1. Company Brain derived "Received" from the ADD ledger, which receiving never
 *     writes (Adds are returns from departments) — a whole truckload scanned in
 *     moved the figure by zero.
 *  2. Stock levels filtered on balanceKg NOT NULL, so an arrived unit with no pack
 *     weight appeared on NO list at all.
 *
 * The contract: a unit that physically arrived must be VISIBLE (flagged when
 * blocked, never hidden), "Received" must reflect arrivals, and Store and Admin
 * must compute their stock snapshot from the same source and agree exactly.
 */
describe('flow "Received" reflects physical arrivals, never the ADD ledger', () => {
  const range = { from: new Date('2026-07-01'), to: new Date('2026-07-31') };

  const build = (opts: {
    arrived: Array<{ weight: number | null; balanceKg: number | null; stockUnit: string }>;
    inStock?: Array<{ balanceKg: number | null; stockUnit: string }>;
    ledgerAdds?: number;
  }) => {
    const prisma = {
      material: {
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.arrivedAt
              ? opts.arrived.map((a) => ({ ...a, receivedWeight: null }))
              : (opts.inStock ?? []),
          ),
        ),
      },
      stockTransaction: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { type: string } }) =>
          Promise.resolve(
            where.type === 'ADD'
              ? Array.from({ length: opts.ledgerAdds ?? 0 }, () => ({
                  quantityKg: 999, // poison value: must never surface in "received"
                  department: null,
                  material: { stockUnit: 'kg' },
                }))
              : [],
          ),
        ),
      },
      productionOutput: { findMany: jest.fn().mockResolvedValue([]) },
      finishedGood: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      batch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new DispatchAnalyticsService(prisma as never);
  };

  it('a scanned-in truckload IS the received figure (the incident scenario)', async () => {
    // 38 sacks of 20 kg scanned in this morning; ADD ledger has 3 unrelated rows.
    const svc = build({
      arrived: Array.from({ length: 38 }, () => ({ weight: 20, balanceKg: 20, stockUnit: 'kg' })),
      ledgerAdds: 3,
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.received.units).toBe(38);
    expect(r.stages.received.totals).toEqual([{ unit: 'kg', total: 760 }]);
    // The ledger's poison value must be nowhere in the received figure.
    expect(r.stages.received.totals.some((t) => t.total % 999 === 0 && t.total > 0)).toBe(false);
  });

  it('a blocked (no-weight) arrival is a COUNTED unit contributing 0 — never invisible', async () => {
    const svc = build({
      arrived: [
        { weight: 25, balanceKg: 25, stockUnit: 'kg' },
        { weight: null, balanceKg: null, stockUnit: 'kg' },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.received.units).toBe(2);
    expect(r.stages.received.blockedUnits).toBe(1);
    expect(r.stages.received.totals).toEqual([{ unit: 'kg', total: 25 }]);
  });

  it('"Still in store" is the live balance snapshot, split by unit, blocked counted', async () => {
    const svc = build({
      arrived: [],
      inStock: [
        { balanceKg: 100, stockUnit: 'kg' },
        { balanceKg: 40, stockUnit: 'L' },
        { balanceKg: null, stockUnit: 'kg' }, // blocked, physically present
      ],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.inStore.totals).toEqual([
      { unit: 'kg', total: 100 },
      { unit: 'L', total: 40 },
    ]);
    expect(r.stages.inStore.blockedUnits).toBe(1);
    // Never a 140 blend.
    expect(r.stages.inStore.totals.some((t) => t.total === 140)).toBe(false);
  });
});

describe('stock levels — an arrived unit with no pack weight is listed and flagged', () => {
  it('appears in its material group, contributes 0, and is counted in needsWeightUnits', async () => {
    const prisma = {
      material: {
        findMany: jest.fn().mockResolvedValue([
          { uniqueId: 'MC-1', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 24, stockUnit: 'kg', arrivedAt: new Date('2026-07-01') },
          // The lost sack: physically here, scanned in, no pack weight.
          { uniqueId: 'MC-2', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: null, stockUnit: 'kg', arrivedAt: new Date('2026-07-21') },
        ]),
      },
      masterCatalogueItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new StockService(prisma as never, {} as never);
    const res = await svc.levels({});

    const tio2 = res.materials.find((m) => m.sku === 'TIO2')!;
    const lost = tio2.units.find((u) => u.uniqueId === 'MC-2');
    expect(lost).toBeDefined(); // IT IS ON THE LIST
    expect(lost!.needsWeight).toBe(true); // marked as needing attention
    expect(tio2.totalBalanceKg).toBe(24); // contributes 0 to totals
    expect(res.needsWeightUnits).toBe(1);
    expect(res.unitCount).toBe(2); // counted as physically present
  });
});

describe('Store and Admin agree — same snapshot, same source', () => {
  /** Generic prisma stub: every model answers with sensible empties, materials with
   *  the shared fixture — so adminOverview and storeOverview see identical data. */
  const fixtureMaterials = [
    { materialName: 'Titanium Dioxide', sku: 'TIO2', balanceKg: 120, stockUnit: 'kg', uniqueId: 'MC-1', status: 'READY_FOR_PRODUCTION', arrivedAt: new Date('2026-07-01') },
    { materialName: 'Solvent ABC', sku: 'SOLV', balanceKg: 60, stockUnit: 'L', uniqueId: 'MC-2', status: 'READY_FOR_PRODUCTION', arrivedAt: new Date('2026-07-02') },
  ];
  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
  });
  const prisma = new Proxy(
    {},
    {
      get: (cache: Record<string, unknown>, prop: string) => {
        if (!(prop in cache)) {
          const m = model();
          if (prop === 'material') m.findMany = jest.fn().mockResolvedValue(fixtureMaterials);
          cache[prop] = m;
        }
        return cache[prop];
      },
    },
  );

  it('adminOverview and storeOverview return the SAME stock snapshot', async () => {
    const svc = new AnalyticsService(prisma as never);
    const [admin, store] = await Promise.all([svc.adminOverview(30), svc.storeOverview(30)]);
    expect(admin.snapshot).toEqual(store.snapshot); // exact agreement, same source
    expect(admin.snapshot.totalsByUnit).toEqual([
      { unit: 'kg', total: 120 },
      { unit: 'L', total: 60 },
    ]);
    expect(admin.snapshot.unitCount).toBe(2);
  });
});
