import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AnalyticsController } from './analytics.controller';
import { DispatchAnalyticsService } from './dispatch-analytics.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * Dispatch analytics + the Company Brain flow.
 *
 * Two things must hold and are easy to get wrong:
 *  - ACCESS. The flow spans raw material through to dispatch, so it crosses every
 *    isolation boundary the rest of the system maintains. It must be Admin-only, while
 *    dispatch analytics is shared by the Dispatch worker and Admin.
 *  - UNITS. Litres and kilograms are not interchangeable. Summing them, or computing a
 *    yield across them, produces a confident-looking number that is simply wrong.
 */
describe('analytics access control', () => {
  const reflector = new Reflector();
  const rolesFor = (handler: keyof AnalyticsController) =>
    reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      AnalyticsController.prototype[handler] as never,
      AnalyticsController,
    ]);

  it('lets Dispatch and Admin see dispatch analytics — and nobody else', () => {
    const roles = rolesFor('dispatchOverview');
    expect(roles).toEqual(expect.arrayContaining([Role.DISPATCH, Role.OVERSIGHT]));
    for (const r of [Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.PRODUCTION_HEAD]) {
      expect(roles).not.toContain(r);
    }
  });

  it('restricts the factory-wide flow to Admin only', () => {
    // This is the owner's view. A production head seeing it would cross the department
    // isolation the rest of Phase 2 enforces; Dispatch seeing it would expose raw
    // material stock they have no business in.
    const roles = rolesFor('flow');
    expect(roles).toEqual([Role.OVERSIGHT]);
    for (const r of [Role.DISPATCH, Role.ADMIN, Role.PRODUCTION_HEAD, Role.OPERATOR, Role.SUPERVISOR]) {
      expect(roles).not.toContain(r);
    }
  });
});

describe('DispatchAnalyticsService.flow — unit correctness', () => {
  /**
   * Minimal Prisma double. The service reads raw-material transactions row-by-row
   * (with each row's material.stockUnit) so totals can be split by unit; the double
   * routes stockTransaction.findMany by transaction type the same way.
   */
  const build = (over: {
    /** Units that physically ARRIVED in range (receiving) — feeds "received". */
    arrived?: Array<{ qty: number | null; unit: string }>;
    /** Live balances — feeds "still in store". null qty = blocked (no pack weight). */
    inStock?: Array<{ qty: number | null; unit: string }>;
    /** ADD-ledger rows (returns from departments) — must NOT feed "received". */
    added?: Array<{ quantityKg: number; unit: string }>;
    issued?: Array<{ quantityKg: number; unit: string; department: string }>;
    outputs?: Array<Record<string, unknown>>;
  } = {}) => {
    const txnRows = (rows: Array<{ quantityKg: number; unit: string; department?: string }>) =>
      rows.map((r) => ({
        quantityKg: r.quantityKg,
        department: r.department ?? null,
        material: { stockUnit: r.unit },
      }));
    const base = {
      material: {
        // flow() asks for arrivals (where.arrivedAt) and the live snapshot (where.OR).
        findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
          if (where.arrivedAt) {
            return Promise.resolve(
              (over.arrived ?? []).map((r) => ({
                weight: r.qty,
                receivedWeight: null,
                balanceKg: r.qty,
                stockUnit: r.unit,
              })),
            );
          }
          return Promise.resolve(
            (over.inStock ?? []).map((r) => ({ balanceKg: r.qty, stockUnit: r.unit })),
          );
        }),
      },
      stockTransaction: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { type: string } }) => {
          if (where.type === 'ADD') return Promise.resolve(txnRows(over.added ?? []));
          if (where.type === 'DEDUCT') return Promise.resolve(txnRows(over.issued ?? []));
          return Promise.resolve([]); // DISCARD
        }),
      },
      productionOutput: { findMany: jest.fn().mockResolvedValue(over.outputs ?? []) },
      finishedGood: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      batch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new DispatchAnalyticsService(base as never);
  };

  const range = { from: new Date('2026-07-01'), to: new Date('2026-07-31') };

  it('never sums litres and kilograms together', async () => {
    const svc = build({
      outputs: [
        { packageCount: 10, sizePerPackage: 20, sizeUnit: 'L', productName: 'A', batch: { department: 'PU' } },
        { packageCount: 4, sizePerPackage: 25, sizeUnit: 'Kg', productName: 'B', batch: { department: 'PU' } },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    // 10x20 L = 200 L and 4x25 kg = 100 kg must stay apart, NOT become 300 of anything.
    expect(r.stages.produced.litres).toBe(200);
    expect(r.stages.produced.kg).toBe(100);
    expect(r.stages.produced.packages).toBe(14);
  });

  it('splits mixed-unit RAW material per unit — received/issued never blend', async () => {
    const svc = build({
      arrived: [{ qty: 100, unit: 'kg' }, { qty: 200, unit: 'L' }],
      issued: [{ quantityKg: 60, unit: 'kg', department: 'PU' }, { quantityKg: 50, unit: 'L', department: 'PU' }],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.received.totals).toEqual([
      { unit: 'kg', total: 100 },
      { unit: 'L', total: 200 },
    ]);
    expect(r.stages.issued.totals).toEqual([
      { unit: 'kg', total: 60 },
      { unit: 'L', total: 50 },
    ]);
    // The forbidden blends must not exist anywhere: 300 in, 110 issued.
    expect(r.stages.received.totals.some((t) => t.total === 300)).toBe(false);
    expect(r.stages.issued.totals.some((t) => t.total === 110)).toBe(false);
  });

  it('returns a null yield when output is litres and input is kilograms', async () => {
    const svc = build({
      arrived: [{ qty: 500, unit: 'kg' }],
      issued: [{ quantityKg: 400, unit: 'kg', department: 'PU' }],
      outputs: [
        { packageCount: 10, sizePerPackage: 20, sizeUnit: 'L', productName: 'A', batch: { department: 'PU' } },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    // 200 L against 400 kg is a category error — report nothing rather than a wrong %.
    expect(r.stages.produced.kg).toBe(0);
    expect(r.derived.yieldPct).toBeNull();
  });

  it('computes yield only when both sides are in kilograms', async () => {
    const svc = build({
      added: [{ quantityKg: 500, unit: 'kg' }],
      issued: [{ quantityKg: 400, unit: 'kg', department: 'PU' }],
      outputs: [
        { packageCount: 12, sizePerPackage: 25, sizeUnit: 'Kg', productName: 'A', batch: { department: 'PU' } },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.produced.kg).toBe(300); // 12 x 25
    expect(r.derived.yieldPct).toBe(75); // 300 / 400
  });

  it('yield uses ONLY the kg slice of issued when litres were issued too', async () => {
    // 400 kg + 100 L issued, 300 kg produced. Yield must be 300/400 = 75%, not
    // 300/500 = 60% — the litres have no place in a kg ratio.
    const svc = build({
      added: [{ quantityKg: 500, unit: 'kg' }],
      issued: [
        { quantityKg: 400, unit: 'kg', department: 'PU' },
        { quantityKg: 100, unit: 'L', department: 'PU' },
      ],
      outputs: [
        { packageCount: 12, sizePerPackage: 25, sizeUnit: 'Kg', productName: 'A', batch: { department: 'PU' } },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.derived.yieldPct).toBe(75);
  });

  it('never reports a negative in-process figure', async () => {
    // Producing more than was issued in the window (material issued earlier) must not
    // surface as a negative quantity.
    const svc = build({
      added: [{ quantityKg: 10, unit: 'kg' }],
      issued: [{ quantityKg: 5, unit: 'kg', department: 'PU' }],
      outputs: [
        { packageCount: 100, sizePerPackage: 25, sizeUnit: 'Kg', productName: 'A', batch: { department: 'PU' } },
      ],
    });
    const r = await svc.flow(range.from, range.to);
    expect(r.derived.inProcessKg).toBeGreaterThanOrEqual(0);
  });

  it('reports every department, including ones with no activity', async () => {
    // A department missing from the response would silently vanish from the owner's
    // by-department table rather than showing an honest zero.
    const svc = build();
    const r = await svc.flow(range.from, range.to);
    expect(r.stages.issued.byDepartment.map((d) => d.department)).toEqual(['PU', 'ENAMEL', 'POWDER']);
    expect(r.stages.produced.byDepartment).toHaveLength(3);
    expect(r.stages.dispatched.byDepartment).toHaveLength(3);
  });
});
