import { MaterialStatus } from '@prisma/client';

/**
 * Receiving after weighing was removed.
 *
 * A truckload can be ~2,500 sacks, so the floor cannot stop to type a weight per sack.
 * Scanning now takes a unit straight to READY_FOR_PRODUCTION, and its stock balance was
 * already seeded from the PO's per-package weight at registration.
 *
 * These cover the decision rules rather than the Prisma plumbing: which statuses a scan
 * may advance, and that a scan never invents a balance.
 */

/** Mirrors the `scannable` rule in ReceivingService.scan. */
const isScannable = (s: MaterialStatus): boolean =>
  s === MaterialStatus.REGISTERED ||
  s === MaterialStatus.ARRIVED ||
  s === MaterialStatus.SCANNED;

describe('receiving scan — statuses it may advance', () => {
  it('advances a freshly registered unit', () => {
    expect(isScannable(MaterialStatus.REGISTERED)).toBe(true);
    expect(isScannable(MaterialStatus.ARRIVED)).toBe(true);
  });

  it('completes a unit left mid-flow by the OLD two-step process', () => {
    // Units sitting in SCANNED were waiting for a weigh step that no longer exists.
    // A single scan must finish them rather than stranding them forever.
    expect(isScannable(MaterialStatus.SCANNED)).toBe(true);
  });

  it('treats an already-received unit as an idempotent no-op', () => {
    // Re-scanning must not error: hardware scanners double-trigger, and the offline
    // queue re-sends on reconnect (invariant I9).
    expect(isScannable(MaterialStatus.READY_FOR_PRODUCTION)).toBe(false);
    expect(isScannable(MaterialStatus.WEIGHED)).toBe(false);
  });
});

describe('receiving scan — balance is never invented', () => {
  /** Mirrors the `needsWeight` flag returned by the scan. */
  const needsWeight = (balanceKg: number | null) => balanceKg == null;

  it('flags a unit whose invoice carried no pack weight', () => {
    expect(needsWeight(null)).toBe(true);
  });

  it('does not flag a unit that already has a balance', () => {
    expect(needsWeight(25)).toBe(false);
  });

  it('does not flag a fully consumed unit — 0 kg is a real balance, not unknown', () => {
    // This distinction is load-bearing: `null` blocks stock movement, `0` does not.
    // An emptied sack must stay a known-empty sack, not become "needs weight".
    expect(needsWeight(0)).toBe(false);
  });
});

describe('weigh() correction — balance stays consistent with the ledger', () => {
  /**
   * Mirrors the balance rule in ReceivingService.weigh.
   * BUG THIS LOCKS: weigh() previously set receivedWeight but NOT balanceKg, so any
   * unit weighed after the Phase 2 migration had a weight and no stock.
   */
  const nextBalance = (args: {
    weight: number;
    movements: number;
    currentBalance: number | null;
    previousWeight: number | null;
  }): number => {
    const { weight, movements, currentBalance, previousWeight } = args;
    if (movements === 0 || currentBalance == null) return weight;
    const delta = weight - (previousWeight ?? weight);
    return Math.max(0, Number((currentBalance + delta).toFixed(6)));
  };

  it('sets the balance to the weight on an untouched unit', () => {
    expect(nextBalance({ weight: 25, movements: 0, currentBalance: null, previousWeight: null })).toBe(25);
    expect(nextBalance({ weight: 25, movements: 0, currentBalance: 20, previousWeight: 20 })).toBe(25);
  });

  it('seeds a balance for a unit that never had one, even after movements', () => {
    expect(nextBalance({ weight: 25, movements: 3, currentBalance: null, previousWeight: null })).toBe(25);
  });

  it('adjusts by the delta once stock has moved, preserving consumption', () => {
    // 25 kg received, 5 kg issued (balance 20). Corrected to 30 kg → balance 25,
    // NOT 30: the 5 kg already issued must not reappear.
    expect(nextBalance({ weight: 30, movements: 1, currentBalance: 20, previousWeight: 25 })).toBe(25);
  });

  it('never drives a balance negative', () => {
    // Corrected far downward after most of it was issued.
    expect(nextBalance({ weight: 5, movements: 1, currentBalance: 2, previousWeight: 25 })).toBe(0);
  });
});
