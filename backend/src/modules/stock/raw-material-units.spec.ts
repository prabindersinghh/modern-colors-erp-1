import { StockService } from './stock.service';
import { deriveStockUnit } from '../material/material.service';

/**
 * Raw-material litre support. Two things must hold:
 *  - a unit's measure is inferred correctly from the PO line text, and
 *  - factory-wide stock totals NEVER add litres and kilograms into one number (the same
 *    category error the dispatch analytics already guard against).
 */
describe('deriveStockUnit — litres vs kilograms from the PO line unit', () => {
  it('reads litre-like units as L', () => {
    for (const t of ['L', 'l', 'Ltr', 'ltr', 'LTR', 'ltrs', 'Litre', 'litres', 'Liter', 'liters', 'L.']) {
      expect(deriveStockUnit(t)).toBe('L');
    }
  });

  it('defaults everything else to kg — including tricky L-words that are not litres', () => {
    for (const t of ['kg', 'Kg', 'KG', 'Bag', 'Drum', 'Can', 'bags', 'Lot', 'Nos', 'Lb', '', null, undefined]) {
      expect(deriveStockUnit(t)).toBe('kg');
    }
  });
});

describe('StockService.levels — totals are split by unit, never mixed', () => {
  const build = (materials: Array<Record<string, unknown>>) => {
    const prisma = { material: { findMany: jest.fn().mockResolvedValue(materials) } } as never;
    return new StockService(prisma, {} as never);
  };

  it('keeps kilograms and litres as separate totals', async () => {
    const svc = build([
      { uniqueId: 'MC-1', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 24, stockUnit: 'kg', arrivedAt: new Date('2026-07-01') },
      { uniqueId: 'MC-2', materialName: 'Titanium Dioxide', sku: 'TIO2', status: 'READY_FOR_PRODUCTION', balanceKg: 10, stockUnit: 'kg', arrivedAt: new Date('2026-07-02') },
      { uniqueId: 'MC-3', materialName: 'Solvent ABC', sku: 'SOLV', status: 'READY_FOR_PRODUCTION', balanceKg: 200, stockUnit: 'L', arrivedAt: new Date('2026-07-03') },
    ]);
    const out = await svc.levels({});

    const kg = out.totalsByUnit.find((t) => t.unit === 'kg');
    const litres = out.totalsByUnit.find((t) => t.unit === 'L');
    expect(kg).toMatchObject({ totalBalance: 34, unitCount: 2 });
    expect(litres).toMatchObject({ totalBalance: 200, unitCount: 1 });

    // The classic bug this prevents: 34 + 200 = 234 of "something".
    expect(out.totalsByUnit.some((t) => t.totalBalance === 234)).toBe(false);
    // grandTotalKg is kilograms ONLY, so it can never silently include litres.
    expect(out.grandTotalKg).toBe(34);

    // Each material carries its own measure.
    expect(out.materials.find((m) => m.sku === 'SOLV')?.stockUnit).toBe('L');
    expect(out.materials.find((m) => m.sku === 'TIO2')?.stockUnit).toBe('kg');
  });

  it('lists kilograms first in the per-unit totals', async () => {
    const svc = build([
      { uniqueId: 'MC-3', materialName: 'Solvent', sku: 'S', status: 'READY_FOR_PRODUCTION', balanceKg: 5, stockUnit: 'L', arrivedAt: new Date('2026-07-03') },
      { uniqueId: 'MC-1', materialName: 'Pigment', sku: 'P', status: 'READY_FOR_PRODUCTION', balanceKg: 5, stockUnit: 'kg', arrivedAt: new Date('2026-07-01') },
    ]);
    const out = await svc.levels({});
    expect(out.totalsByUnit[0].unit).toBe('kg');
  });
});
