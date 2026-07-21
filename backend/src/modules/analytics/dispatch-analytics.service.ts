import { Injectable } from '@nestjs/common';
import { Department, FgStatus, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { unitTotals, mergeUnitTotals, kgOnly } from '../../common/unit-total';

/** Local copies of the shared window helpers, kept private to this service. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - (n - 1));
  return d;
}
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dayBuckets(days: number): string[] {
  const keys: string[] = [];
  const start = daysAgo(days);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    keys.push(dayKey(d));
  }
  return keys;
}

const DEPARTMENTS: Department[] = [Department.PU, Department.ENAMEL, Department.POWDER];

/**
 * Analytics for the DISPATCH role, and the dispatch slice of the owner's view.
 *
 * Deliberately scoped to finished goods ONLY. A dispatch worker has no business seeing
 * raw-material stock, production requests or Phase 1 receiving data, so none of it is
 * queried here — the isolation is in the data access, not just in the UI.
 *
 * The same numbers power the Admin dashboard's dispatch section, so the two can never
 * disagree about how much went out.
 */
@Injectable()
export class DispatchAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param days rolling window for the trend/volume figures
   * @param department when set, restrict to one department's output (Admin drill-down).
   *        The DISPATCH role never passes this — it ships the whole factory.
   */
  async overview(days = 30, department?: Department) {
    const since = daysAgo(days);
    const batchWhere = department ? { batch: { department } } : {};

    const [
      dispatchedInWindow,
      readyUnits,
      dispatchedToday,
      totalDispatchedAllTime,
      byDeptRows,
      recent,
      batchRows,
      returnsWindow,
      returnsAllTime,
    ] = await Promise.all([
      // Units dispatched inside the window, with the timestamps needed for the
      // "how long did it sit?" figure, and batch/product for the breakdowns.
      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.DISPATCHED, dispatchedAt: { gte: since }, ...batchWhere },
        select: {
          id: true,
          dispatchedAt: true,
          createdAt: true,
          sizePerPackage: true,
          sizeUnit: true,
          productName: true,
          batch: { select: { id: true, batchNumber: true, department: true } },
        },
      }),

      // The backlog: produced and waiting. Not window-bound — a drum sitting since
      // last month is exactly what the dispatch worker needs to see.
      this.prisma.finishedGood.findMany({
        where: { status: { in: [FgStatus.GENERATED, FgStatus.READY] }, ...batchWhere },
        select: {
          id: true,
          uniqueId: true,
          createdAt: true,
          sizePerPackage: true,
          sizeUnit: true,
          productName: true,
          batch: { select: { batchNumber: true, department: true } },
        },
      }),

      this.prisma.finishedGood.count({
        where: { status: FgStatus.DISPATCHED, dispatchedAt: { gte: startOfToday() }, ...batchWhere },
      }),

      this.prisma.finishedGood.count({ where: { status: FgStatus.DISPATCHED, ...batchWhere } }),

      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.DISPATCHED, dispatchedAt: { gte: since }, ...batchWhere },
        select: { batch: { select: { department: true } } },
      }),

      this.prisma.finishedGood.findMany({
        where: { status: FgStatus.DISPATCHED, ...batchWhere },
        select: {
          uniqueId: true,
          productName: true,
          dispatchedAt: true,
          sizePerPackage: true,
          sizeUnit: true,
          dispatchedBy: { select: { name: true } },
          batch: { select: { batchNumber: true, department: true } },
        },
        orderBy: { dispatchedAt: 'desc' },
        take: 10,
      }),

      // Per-batch completion, so partially-shipped batches are visible.
      this.prisma.batch.findMany({
        where: department ? { department } : {},
        select: {
          id: true,
          batchNumber: true,
          department: true,
          finishedGoods: { select: { status: true } },
        },
      }),

      // Returns — window and all-time, split by outcome.
      this.prisma.finishedGood.groupBy({
        by: ['status'],
        where: {
          status: { in: [FgStatus.SCRAPPED, FgStatus.REFURBISHED] },
          returnedAt: { gte: since },
          ...batchWhere,
        },
        _count: { _all: true },
      }),
      this.prisma.finishedGood.groupBy({
        by: ['status'],
        where: { status: { in: [FgStatus.SCRAPPED, FgStatus.REFURBISHED] }, ...batchWhere },
        _count: { _all: true },
      }),
    ]);

    // ---- trend ------------------------------------------------------------
    const buckets = dayBuckets(days);
    const index = new Map(buckets.map((k) => [k, { date: k, units: 0 }]));
    for (const fg of dispatchedInWindow) {
      if (!fg.dispatchedAt) continue;
      const slot = index.get(dayKey(fg.dispatchedAt));
      if (slot) slot.units += 1;
    }
    const series = buckets.map((k) => index.get(k)!);

    // ---- by department ----------------------------------------------------
    const deptCounts = new Map<string, number>(DEPARTMENTS.map((d) => [d, 0]));
    for (const r of byDeptRows) {
      const d = r.batch?.department;
      if (d) deptCounts.set(d, (deptCounts.get(d) ?? 0) + 1);
    }
    const byDepartment = DEPARTMENTS.map((d) => ({ department: d, units: deptCounts.get(d) ?? 0 }));

    // ---- batch completion -------------------------------------------------
    let fullyDispatched = 0;
    let partiallyDispatched = 0;
    let notStarted = 0;
    for (const b of batchRows) {
      const total = b.finishedGoods.length;
      if (total === 0) continue; // batch produced nothing yet — not a dispatch concern
      const out = b.finishedGoods.filter((f) => f.status === FgStatus.DISPATCHED).length;
      if (out === 0) notStarted++;
      else if (out === total) fullyDispatched++;
      else partiallyDispatched++;
    }

    // ---- turnaround: FG created -> dispatched ------------------------------
    const hours = dispatchedInWindow
      .filter((f) => f.dispatchedAt)
      .map((f) => (f.dispatchedAt!.getTime() - f.createdAt.getTime()) / 36e5)
      .filter((h) => h >= 0);
    const avgHoursToDispatch = hours.length
      ? Number((hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1))
      : null;

    // ---- volume -----------------------------------------------------------
    // Litres and kilograms are NOT interchangeable, so they are reported separately
    // rather than summed into a meaningless single number.
    const volume = (rows: { sizePerPackage: number; sizeUnit: string }[]) => {
      let litres = 0;
      let kg = 0;
      for (const r of rows) {
        if ((r.sizeUnit ?? '').toUpperCase().startsWith('L')) litres += r.sizePerPackage;
        else kg += r.sizePerPackage;
      }
      return { litres: Number(litres.toFixed(3)), kg: Number(kg.toFixed(3)) };
    };

    // Oldest waiting unit — the thing most likely to be forgotten.
    const oldestReady = readyUnits.reduce<Date | null>(
      (oldest, u) => (!oldest || u.createdAt < oldest ? u.createdAt : oldest),
      null,
    );
    const oldestReadyDays = oldestReady
      ? Math.floor((Date.now() - oldestReady.getTime()) / 864e5)
      : null;

    // ---- FG ageing — how long finished goods sit before dispatch ----------
    // Mirrors the raw-material ageing idea with FG-appropriate thresholds:
    // amber ≥ 7 days waiting, red ≥ 14 (paint should not sit for a month).
    const FG_AMBER = 7;
    const FG_RED = 14;
    const aged = readyUnits.map((u) => ({
      ...u,
      ageDays: Math.floor((Date.now() - u.createdAt.getTime()) / 864e5),
    }));
    const fgAgeing = {
      thresholds: { amberDays: FG_AMBER, redDays: FG_RED },
      fresh: { units: aged.filter((u) => u.ageDays < FG_AMBER).length },
      amber: {
        units: aged.filter((u) => u.ageDays >= FG_AMBER && u.ageDays < FG_RED).length,
        volume: volume(aged.filter((u) => u.ageDays >= FG_AMBER && u.ageDays < FG_RED)),
      },
      red: {
        units: aged.filter((u) => u.ageDays >= FG_RED).length,
        volume: volume(aged.filter((u) => u.ageDays >= FG_RED)),
      },
      oldest: aged
        .sort((a, b) => b.ageDays - a.ageDays)
        .slice(0, 8)
        .map((u) => ({
          uniqueId: u.uniqueId,
          productName: u.productName,
          batchNumber: u.batch?.batchNumber ?? null,
          department: u.batch?.department ?? null,
          size: `${u.sizePerPackage} ${u.sizeUnit}`,
          ageDays: u.ageDays,
          level: u.ageDays >= FG_RED ? 'RED' : u.ageDays >= FG_AMBER ? 'AMBER' : 'FRESH',
        })),
    };

    // ---- Every dispatched good, batch-wise (window) ------------------------
    const byBatchMap = new Map<
      string,
      { batchId: string; batchNumber: string; department: string; productName: string; units: number; litres: number; kg: number; lastDispatchedAt: Date | null }
    >();
    for (const f of dispatchedInWindow) {
      const b = f.batch;
      if (!b) continue;
      const g = byBatchMap.get(b.id) ?? {
        batchId: b.id,
        batchNumber: b.batchNumber,
        department: b.department,
        productName: f.productName,
        units: 0,
        litres: 0,
        kg: 0,
        lastDispatchedAt: null,
      };
      g.units += 1;
      if ((f.sizeUnit ?? '').toUpperCase().startsWith('L')) g.litres = Number((g.litres + f.sizePerPackage).toFixed(3));
      else g.kg = Number((g.kg + f.sizePerPackage).toFixed(3));
      if (f.dispatchedAt && (!g.lastDispatchedAt || f.dispatchedAt > g.lastDispatchedAt)) g.lastDispatchedAt = f.dispatchedAt;
      byBatchMap.set(b.id, g);
    }
    const dispatchedByBatch = [...byBatchMap.values()].sort(
      (a, b) => (b.lastDispatchedAt?.getTime() ?? 0) - (a.lastDispatchedAt?.getTime() ?? 0),
    );

    // ---- Per-finished-good (product) rollup (window) -----------------------
    const byProductMap = new Map<string, { productName: string; units: number; litres: number; kg: number }>();
    for (const f of dispatchedInWindow) {
      const g = byProductMap.get(f.productName) ?? { productName: f.productName, units: 0, litres: 0, kg: 0 };
      g.units += 1;
      if ((f.sizeUnit ?? '').toUpperCase().startsWith('L')) g.litres = Number((g.litres + f.sizePerPackage).toFixed(3));
      else g.kg = Number((g.kg + f.sizePerPackage).toFixed(3));
      byProductMap.set(f.productName, g);
    }
    const dispatchedByProduct = [...byProductMap.values()].sort((a, b) => b.units - a.units);

    // ---- Returns ----------------------------------------------------------
    const rN = (rows: { status: FgStatus; _count: { _all: number } }[], s: FgStatus) =>
      rows.find((r) => r.status === s)?._count._all ?? 0;
    const returns = {
      window: {
        scrapped: rN(returnsWindow, FgStatus.SCRAPPED),
        refurbished: rN(returnsWindow, FgStatus.REFURBISHED),
      },
      allTime: {
        scrapped: rN(returnsAllTime, FgStatus.SCRAPPED),
        refurbished: rN(returnsAllTime, FgStatus.REFURBISHED),
      },
    };

    return {
      windowDays: days,
      department: department ?? null,
      totals: {
        dispatchedToday,
        dispatchedInWindow: dispatchedInWindow.length,
        dispatchedAllTime: totalDispatchedAllTime,
        readyForDispatch: readyUnits.length,
        oldestReadyDays,
        avgHoursToDispatch,
      },
      volume: {
        dispatchedInWindow: volume(dispatchedInWindow),
        awaitingDispatch: volume(readyUnits),
      },
      series,
      byDepartment,
      batches: { fullyDispatched, partiallyDispatched, notStarted },
      fgAgeing,
      dispatchedByBatch,
      dispatchedByProduct,
      returns,
      recent: recent.map((r) => ({
        uniqueId: r.uniqueId,
        productName: r.productName,
        dispatchedAt: r.dispatchedAt,
        size: `${r.sizePerPackage} ${r.sizeUnit}`,
        by: r.dispatchedBy?.name ?? null,
        batchNumber: r.batch?.batchNumber ?? null,
        department: r.batch?.department ?? null,
      })),
    };
  }

  /**
   * The factory-wide flow — the "Company Brain".
   *
   * Answers one question with measured numbers: what came in, what was issued, what was
   * made, and what went out, for an arbitrary date range.
   *
   * Every figure is read from the existing ledger, batches, outputs and dispatch
   * records; nothing is estimated. Litres and kilograms are kept apart because adding
   * them would produce a number that means nothing.
   */
  async flow(from: Date, to: Date) {
    const range = { gte: from, lte: to };

    const [receivedRows, issuedRows, discardedRows, outputs, fgCreated, fgDispatched, batches] =
      await Promise.all([
        // Raw material IN — the ADD ledger is the only honest source. Read with each
        // row's material unit so the total can be split by unit, never blended.
        this.prisma.stockTransaction.findMany({
          where: { type: StockTxnType.ADD, createdAt: range },
          select: { quantityKg: true, material: { select: { stockUnit: true } } },
        }),

        // Issued to each department.
        this.prisma.stockTransaction.findMany({
          where: { type: StockTxnType.DEDUCT, department: { not: null }, createdAt: range },
          select: { department: true, quantityKg: true, material: { select: { stockUnit: true } } },
        }),

        this.prisma.stockTransaction.findMany({
          where: { type: StockTxnType.DISCARD, createdAt: range },
          select: { quantityKg: true, material: { select: { stockUnit: true } } },
        }),

        // Production output, by department, confirmed only.
        this.prisma.productionOutput.findMany({
          where: { confirmed: true, productionDate: range },
          select: {
            packageCount: true,
            sizePerPackage: true,
            sizeUnit: true,
            productName: true,
            batch: { select: { department: true, batchNumber: true } },
          },
        }),

        this.prisma.finishedGood.count({ where: { createdAt: range } }),

        this.prisma.finishedGood.findMany({
          where: { status: FgStatus.DISPATCHED, dispatchedAt: range },
          select: {
            sizePerPackage: true,
            sizeUnit: true,
            batch: { select: { department: true } },
          },
        }),

        this.prisma.batch.findMany({
          where: { createdAt: range },
          select: { id: true, department: true },
        }),
      ]);

    // Raw material is measured in kg OR litres. Group by unit and never blend the two.
    const receivedTotals = unitTotals(receivedRows.map((r) => ({ unit: r.material?.stockUnit ?? 'kg', qty: r.quantityKg })));
    const discardedTotals = unitTotals(discardedRows.map((r) => ({ unit: r.material?.stockUnit ?? 'kg', qty: r.quantityKg })));

    const issuedByDept = DEPARTMENTS.map((d) => {
      const rows = issuedRows.filter((r) => r.department === d);
      return {
        department: d,
        totals: unitTotals(rows.map((r) => ({ unit: r.material?.stockUnit ?? 'kg', qty: r.quantityKg }))),
        movements: rows.length,
      };
    });
    const issuedTotals = mergeUnitTotals(issuedByDept.map((d) => d.totals));
    // Yield and in-process compare finished KG against raw KG, so they use the
    // kilogram-only slice of what was issued — a litres figure has no place in a kg ratio.
    const issuedKgOnly = kgOnly(issuedTotals);

    // Produced, per department, split by unit because L and Kg cannot be added.
    const producedByDept = DEPARTMENTS.map((d) => {
      const rows = outputs.filter((o) => o.batch?.department === d);
      let litres = 0;
      let kg = 0;
      let packages = 0;
      for (const o of rows) {
        const total = o.packageCount * o.sizePerPackage;
        packages += o.packageCount;
        if ((o.sizeUnit ?? '').toUpperCase().startsWith('L')) litres += total;
        else kg += total;
      }
      return {
        department: d,
        litres: Number(litres.toFixed(3)),
        kg: Number(kg.toFixed(3)),
        packages,
        batches: batches.filter((b) => b.department === d).length,
      };
    });

    const dispatchedByDept = DEPARTMENTS.map((d) => {
      const rows = fgDispatched.filter((f) => f.batch?.department === d);
      let litres = 0;
      let kg = 0;
      for (const r of rows) {
        if ((r.sizeUnit ?? '').toUpperCase().startsWith('L')) litres += r.sizePerPackage;
        else kg += r.sizePerPackage;
      }
      return {
        department: d,
        units: rows.length,
        litres: Number(litres.toFixed(3)),
        kg: Number(kg.toFixed(3)),
      };
    });

    const producedTotals = producedByDept.reduce(
      (a, d) => ({
        litres: Number((a.litres + d.litres).toFixed(3)),
        kg: Number((a.kg + d.kg).toFixed(3)),
        packages: a.packages + d.packages,
      }),
      { litres: 0, kg: 0, packages: 0 },
    );
    const dispatchedTotals = dispatchedByDept.reduce(
      (a, d) => ({
        units: a.units + d.units,
        litres: Number((a.litres + d.litres).toFixed(3)),
        kg: Number((a.kg + d.kg).toFixed(3)),
      }),
      { units: 0, litres: 0, kg: 0 },
    );

    /**
     * Yield: finished output measured against raw material issued.
     *
     * Only meaningful for the KG side — comparing litres of paint to kilograms of
     * pigment is a category error, so it is reported as null rather than a
     * confident-looking wrong number.
     */
    const yieldPct =
      issuedKgOnly > 0 && producedTotals.kg > 0
        ? Number(((producedTotals.kg / issuedKgOnly) * 100).toFixed(1))
        : null;

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      stages: {
        received: { totals: receivedTotals, movements: receivedRows.length },
        issued: { totals: issuedTotals, byDepartment: issuedByDept },
        discarded: { totals: discardedTotals },
        batches: { opened: batches.length },
        produced: { ...producedTotals, byDepartment: producedByDept, fgUnitsCreated: fgCreated },
        dispatched: { ...dispatchedTotals, byDepartment: dispatchedByDept },
      },
      derived: {
        yieldPct,
        // Issued to production but not yet finished goods — KG only (see issuedKgOnly).
        inProcessKg: Number(Math.max(0, issuedKgOnly - producedTotals.kg).toFixed(3)),
        awaitingDispatchUnits: Math.max(0, fgCreated - dispatchedTotals.units),
      },
    };
  }
}
