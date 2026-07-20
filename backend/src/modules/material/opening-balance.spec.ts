import { derivePackWeight } from '../ai-extraction/derive-pack-weight';

/**
 * Opening stock balance — the rule that replaced manual receiving weights.
 *
 * BEFORE: a unit got `receivedWeight` from an operator typing it at receiving, and its
 * `balanceKg` came from a one-time backfill in the Phase 2 migration. Weighing 2,500
 * sacks per truckload was unworkable, and `weigh()` never actually set `balanceKg`, so
 * anything weighed after that migration was stranded with no stock.
 *
 * AFTER: `balanceKg` is seeded at REGISTRATION from the PO's per-package weight.
 * Receiving is scan-only.
 *
 * These tests lock the decision rule itself. The exact expression is duplicated from
 * MaterialService.registerUnits deliberately — it is three lines, and the property that
 * matters (never 0, never negative, null when unknown) is what must not drift.
 */

/** Mirrors the rule in MaterialService.registerUnits. */
const openingBalance = (lineWeight: number | null | undefined): number | null =>
  lineWeight != null && lineWeight > 0 ? lineWeight : null;

describe('opening balance from PO per-package weight', () => {
  it('seeds each unit with the PO line weight', () => {
    // "100 bags x 10 kg" — every one of the 100 units opens at 10 kg.
    expect(openingBalance(10)).toBe(10);
    expect(openingBalance(25)).toBe(25);
    expect(openingBalance(200)).toBe(200);
  });

  it('keeps fractional pack sizes intact', () => {
    // 500 g sachets must not round to 0 or 1.
    expect(openingBalance(0.5)).toBe(0.5);
  });

  it('yields NULL — never 0 — when the PO has no weight', () => {
    // This is the load-bearing case. stock.service blocks movement on a NULL balance;
    // 0 would pass that check and let an unweighed sack "issue" nothing at all.
    expect(openingBalance(null)).toBeNull();
    expect(openingBalance(undefined)).toBeNull();
  });

  it('treats 0 and negative PO weights as unknown, not as a real balance', () => {
    expect(openingBalance(0)).toBeNull();
    expect(openingBalance(-5)).toBeNull();
  });
});

describe('end-to-end: invoice text -> opening balance', () => {
  const balanceFor = (src: Parameters<typeof derivePackWeight>[0], extracted?: number | null) => {
    const w = extracted ?? derivePackWeight(src)?.weight ?? null;
    return openingBalance(w);
  };

  it('Rallison "Pack Size 25 Kg 1 BAG" -> 25 kg per unit', () => {
    expect(balanceFor({ packingNote: 'Pack Size 25 Kg 1 BAG' })).toBe(25);
  });

  it('Vimal "Packing: 4 Drums x 25 Kgs" -> 25 kg per unit (was NULL in production)', () => {
    expect(balanceFor({ packingNote: 'Packing: 4 Drums x 25 Kgs' })).toBe(25);
  });

  it('Vimal "AEROSIL 200 (10KGS)" description -> 10 kg per unit', () => {
    expect(balanceFor({ materialName: 'AEROSIL 200 (10KGS)' })).toBe(10);
  });

  it('P.K. Dyes bulk "2,300.000 KG" -> NULL, unit is blocked until an operator fixes it', () => {
    expect(balanceFor({ materialName: 'CARB-10 B', quantity: 1, totalKg: 2300 })).toBeNull();
  });

  it('an extracted weight always wins over anything derived', () => {
    // If the model stated 20, we do not silently substitute the 25 in the description.
    expect(balanceFor({ materialName: 'THING (25KGS)' }, 20)).toBe(20);
  });
});
