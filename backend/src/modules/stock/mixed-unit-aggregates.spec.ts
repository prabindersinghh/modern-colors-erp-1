import { StockService } from './stock.service';
import { DispatchAnalyticsService } from '../analytics/dispatch-analytics.service';

/**
 * THE GUARD: with mixed-unit stock (kilograms AND litres), no aggregate view may ever
 * produce a single summed number across the two.
 *
 * The failure this prevents: stock is all-kg today, so a blended total happens to be
 * "correct". The day one solvent is stocked in litres, a naive sum silently puts a
 * physically meaningless figure on the owner's dashboard. These tests insert exactly
 * that mixed data and walk the trees of every aggregate response asserting the blended
 * number appears nowhere.
 */

/** Every numeric leaf in an object tree, with its path — so a blend can't hide anywhere. */
function numericLeaves(obj: unknown, path = ''): Array<{ path: string; value: number }> {
  if (typeof obj === 'number') return [{ path, value: obj }];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => numericLeaves(v, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      numericLeaves(v, path ? `${path}.${k}` : k),
    );
  }
  return [];
}

// Fixture: 100 kg + 40 kg of pigment, 200 L of solvent.
// The forbidden blends: 140+200=340, 100+200=300, 40+200=240.
const KG_A = 100;
const KG_B = 40;
const LITRES = 200;
const FORBIDDEN = [KG_A + KG_B + LITRES, KG_A + LITRES, KG_B + LITRES];

const expectNoBlends = (result: unknown) => {
  const leaves = numericLeaves(result);
  const blended = leaves.filter((l) => FORBIDDEN.includes(l.value));
  expect(blended).toEqual([]); // fails with the offending path if a blend appears
};

describe('stock levels with mixed-unit stock', () => {
  const materials = [
    { uniqueId: 'MC-1', materialName: 'Pigment Red', sku: 'PIG-R', status: 'READY_FOR_PRODUCTION', balanceKg: KG_A, stockUnit: 'kg', arrivedAt: new Date('2026-07-01') },
    { uniqueId: 'MC-2', materialName: 'Pigment Red', sku: 'PIG-R', status: 'READY_FOR_PRODUCTION', balanceKg: KG_B, stockUnit: 'kg', arrivedAt: new Date('2026-07-02') },
    { uniqueId: 'MC-3', materialName: 'Solvent ABC', sku: 'SOLV', status: 'READY_FOR_PRODUCTION', balanceKg: LITRES, stockUnit: 'L', arrivedAt: new Date('2026-05-01') }, // old → RED bucket
  ];
  const svc = () =>
    new StockService(
      {
        material: { findMany: jest.fn().mockResolvedValue(materials) },
        masterCatalogueItem: { findMany: jest.fn().mockResolvedValue([]) },
      } as never,
      {} as never,
    );

  it('levels: totals are split by unit and contain no blended figure', async () => {
    const out = await svc().levels({});
    expectNoBlends(out);
    expect(out.totalsByUnit).toEqual([
      { unit: 'kg', total: KG_A + KG_B },
      { unit: 'L', total: LITRES },
    ]);
    expect(out.grandTotalKg).toBe(KG_A + KG_B); // kg-only, litres excluded
  });

  it('ageing buckets: each bucket reports per-unit totals, never one number', async () => {
    const out = await svc().ageing({});
    expectNoBlends(out);
    // The old solvent lands in RED as litres; the fresh pigment in FRESH as kg.
    expect(out.buckets.red.totals).toEqual([{ unit: 'L', total: LITRES }]);
    expect(out.buckets.fresh.totals).toEqual([{ unit: 'kg', total: KG_A + KG_B }]);
    // Every bucket's totals is an array of {unit,total} — no bare totalKg field remains.
    for (const b of Object.values(out.buckets)) {
      expect(Array.isArray(b.totals)).toBe(true);
      expect(b).not.toHaveProperty('totalKg');
    }
  });
});

describe('Company Brain flow with mixed-unit raw material', () => {
  const build = () => {
    const txn = (type: string, qty: number, unit: string, department: string | null = null) => ({
      type, quantityKg: qty, department, material: { stockUnit: unit },
    });
    const prisma = {
      stockTransaction: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { type: string } }) => {
          if (where.type === 'ADD')
            return Promise.resolve([txn('ADD', KG_A, 'kg'), txn('ADD', KG_B, 'kg'), txn('ADD', LITRES, 'L')]);
          if (where.type === 'DEDUCT')
            return Promise.resolve([txn('DEDUCT', KG_A, 'kg', 'PU'), txn('DEDUCT', LITRES, 'L', 'PU')]);
          return Promise.resolve([]); // DISCARD
        }),
      },
      productionOutput: { findMany: jest.fn().mockResolvedValue([]) },
      finishedGood: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      batch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new DispatchAnalyticsService(prisma as never);
  };

  it('received / issued / discarded are per-unit; no blended figure anywhere', async () => {
    const r = await build().flow(new Date('2026-07-01'), new Date('2026-07-31'));
    expectNoBlends(r);
    expect(r.stages.received.totals).toEqual([
      { unit: 'kg', total: KG_A + KG_B },
      { unit: 'L', total: LITRES },
    ]);
    expect(r.stages.issued.totals).toEqual([
      { unit: 'kg', total: KG_A },
      { unit: 'L', total: LITRES },
    ]);
  });

  it('yield and in-process compare kg to kg only — litres never enter the ratio', async () => {
    const r = await build().flow(new Date('2026-07-01'), new Date('2026-07-31'));
    // Nothing produced → no yield; and in-process is the KG slice of issued (100),
    // NOT kg+L (300).
    expect(r.derived.yieldPct).toBeNull();
    expect(r.derived.inProcessKg).toBe(KG_A);
  });
});
