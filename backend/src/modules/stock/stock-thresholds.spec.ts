import { StockService, stockPercent } from './stock.service';
import { AnalyticsService } from '../analytics/analytics.service';

/**
 * Admin-set min/max stock levels.
 *
 *  - stockPercent: fullness against max (capacity) or min (reorder point); NULL when
 *    neither is set — never a number with no meaning.
 *  - levels(): each material carries minLevel/maxLevel/pct from its catalogue entry.
 *  - lowStock(): a configured minimum REPLACES the built-in thresholds for that
 *    material (LOW below min, CRITICAL below half of min); unconfigured materials
 *    keep the defaults, so nothing regresses.
 */
describe('stockPercent', () => {
  it('uses max as capacity when set', () => {
    expect(stockPercent(50, null, 200)).toBe(25);
    expect(stockPercent(200, 100, 200)).toBe(100);
  });

  it('falls back to min as the reference (may exceed 100%)', () => {
    expect(stockPercent(150, 100, null)).toBe(150);
  });

  it('is null when no threshold is set — no meaningless number', () => {
    expect(stockPercent(50, null, null)).toBeNull();
    expect(stockPercent(50, 0, null)).toBeNull();
  });
});

describe('StockService.levels — thresholds attached per material', () => {
  it('attaches minLevel/maxLevel/pct from the catalogue by SKU', async () => {
    const prisma = {
      material: {
        findMany: jest.fn().mockResolvedValue([
          { uniqueId: 'MC-1', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 50, stockUnit: 'kg', arrivedAt: new Date('2026-07-01') },
          { uniqueId: 'MC-2', materialName: 'Mystery Filler', sku: null, status: 'READY_FOR_PRODUCTION', balanceKg: 5, stockUnit: 'kg', arrivedAt: new Date('2026-07-02') },
        ]),
      },
      masterCatalogueItem: {
        findMany: jest.fn().mockResolvedValue([{ sku: 'TIO2', minLevel: 40, maxLevel: 200 }]),
      },
    };
    const svc = new StockService(prisma as never, {} as never);
    const res = await svc.levels({});

    const tio2 = res.materials.find((m) => m.sku === 'TIO2')!;
    expect(tio2).toMatchObject({ minLevel: 40, maxLevel: 200, pct: 25 });

    // No SKU → no catalogue match → no thresholds, no percentage.
    const mystery = res.materials.find((m) => m.materialName === 'Mystery Filler')!;
    expect(mystery).toMatchObject({ minLevel: null, maxLevel: null, pct: null });
  });
});

describe('AnalyticsService lowStock — Admin minimums drive the alerts', () => {
  const build = (materials: unknown[], catalogue: unknown[]) => {
    const prisma = {
      material: { findMany: jest.fn().mockResolvedValue(materials) },
      masterCatalogueItem: { findMany: jest.fn().mockResolvedValue(catalogue) },
    };
    return new AnalyticsService(prisma as never);
  };
  // lowStock is private — reach it through a typed cast, not by weakening the class.
  const lowStock = (svc: AnalyticsService) =>
    (svc as unknown as { lowStock: () => Promise<{ alerts: { sku: string | null; level: string; minLevel?: number | null }[] }> }).lowStock();

  it('alerts against the configured minimum, not the built-in default', async () => {
    // 60 kg in stock would be fine by the default thresholds, but min=100 → LOW.
    const res = await lowStock(
      build(
        [{ materialName: 'Titanium Dioxide', sku: 'TIO2', balanceKg: 60, stockUnit: 'kg' }],
        [{ sku: 'TIO2', minLevel: 100 }],
      ),
    );
    expect(res.alerts).toHaveLength(1);
    expect(res.alerts[0]).toMatchObject({ sku: 'TIO2', level: 'LOW', minLevel: 100 });
  });

  it('goes CRITICAL below half the configured minimum', async () => {
    const res = await lowStock(
      build(
        [{ materialName: 'Titanium Dioxide', sku: 'TIO2', balanceKg: 49, stockUnit: 'kg' }],
        [{ sku: 'TIO2', minLevel: 100 }],
      ),
    );
    expect(res.alerts[0].level).toBe('CRITICAL');
  });

  it('a healthy material with a configured minimum raises NO alert', async () => {
    const res = await lowStock(
      build(
        [{ materialName: 'Titanium Dioxide', sku: 'TIO2', balanceKg: 150, stockUnit: 'kg' }],
        [{ sku: 'TIO2', minLevel: 100 }],
      ),
    );
    expect(res.alerts).toHaveLength(0);
  });

  it('materials without a configured minimum keep the built-in defaults', async () => {
    // 3 kg is below the default CRITICAL tier (5 kg) — must still alert as before.
    const res = await lowStock(
      build([{ materialName: 'Odd Pigment', sku: 'ODD', balanceKg: 3, stockUnit: 'kg' }], []),
    );
    expect(res.alerts[0].level).toBe('CRITICAL');
  });
});
