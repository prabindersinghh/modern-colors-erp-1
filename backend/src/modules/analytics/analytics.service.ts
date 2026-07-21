import { Injectable } from '@nestjs/common';
import { Department, Prisma, RequestStatus, StockTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { ownDepartment } from '../../common/auth/department-scope';
import {
  DEPARTMENTS,
  LOW_STOCK,
  normalizeWindow,
  StockAlertLevel,
} from './analytics.constants';
import { ageDays, ageingLevel, fifoSort, AGEING } from '../stock/fifo.util';
import { unitTotals, kgOnly, type UnitTotal } from '../../common/unit-total';

const emptyStatus = (): Record<RequestStatus, number> => ({
  PENDING: 0,
  IN_PROGRESS: 0,
  APPROVED: 0,
  PARTIAL: 0,
  REJECTED: 0,
});

/** Bucket transactions into per-type, per-unit totals (never blends kilograms + litres). */
function byTypeUnit(
  rows: { type: StockTxnType; quantityKg: number; material: { stockUnit: string } | null }[],
): Record<StockTxnType, UnitTotal[]> {
  const buckets: Record<StockTxnType, { unit: string; qty: number }[]> = { ADD: [], DEDUCT: [], DISCARD: [] };
  for (const r of rows) buckets[r.type].push({ unit: r.material?.stockUnit ?? 'kg', qty: r.quantityKg });
  return {
    ADD: unitTotals(buckets.ADD),
    DEDUCT: unitTotals(buckets.DEDUCT),
    DISCARD: unitTotals(buckets.DISCARD),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - (n - 1)); // inclusive window of n days ending today
  return d;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build an ordered list of YYYY-MM-DD keys for the last `days` days (inclusive). */
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

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────── shared building blocks ───────────────────────

  /**
   * Low-stock alerts: materials whose TOTAL on-hand KG (summed over weighed units)
   * is below the LOW tier. Factory-wide (not department-scoped — stock isn't owned by
   * a department). Sorted most-critical first.
   */
  private async lowStock() {
    const units = await this.prisma.material.findMany({
      where: { balanceKg: { not: null } },
      select: { materialName: true, sku: true, balanceKg: true, stockUnit: true },
    });
    // Each alert is a SINGLE material, so its total is one unit — never a cross-unit
    // blend. `stockUnit` labels it.
    const groups = new Map<string, { materialName: string; sku: string | null; stockUnit: string; totalKg: number; unitCount: number }>();
    for (const u of units) {
      const key = u.sku?.trim().toLowerCase() || u.materialName.trim().toLowerCase();
      const g = groups.get(key) ?? { materialName: u.materialName, sku: u.sku, stockUnit: u.stockUnit || 'kg', totalKg: 0, unitCount: 0 };
      g.totalKg = Number((g.totalKg + (u.balanceKg ?? 0)).toFixed(6));
      g.unitCount += 1;
      groups.set(key, g);
    }

    // Admin-set per-material minimums (catalogue) take precedence over the built-in
    // defaults: LOW below the minimum, CRITICAL below half of it. Materials without a
    // configured minimum keep today's LOW_STOCK constants — nothing regresses.
    const skus = [...groups.values()].map((g) => g.sku).filter((s): s is string => !!s);
    const cat = skus.length
      ? await this.prisma.masterCatalogueItem.findMany({
          where: { sku: { in: skus }, minLevel: { not: null } },
          select: { sku: true, minLevel: true },
        })
      : [];
    const minBySku = new Map(cat.map((c) => [c.sku.toLowerCase(), c.minLevel!]));

    const alerts = [...groups.values()]
      .map((g) => {
        const min = g.sku ? (minBySku.get(g.sku.toLowerCase()) ?? null) : null;
        const level: StockAlertLevel | null =
          min != null
            ? g.totalKg < min / 2
              ? 'CRITICAL'
              : g.totalKg < min
                ? 'LOW'
                : null
            : g.totalKg < LOW_STOCK.CRITICAL_KG
              ? 'CRITICAL'
              : g.totalKg < LOW_STOCK.LOW_KG
                ? 'LOW'
                : null;
        return level ? { ...g, minLevel: min, level } : null;
      })
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .sort((a, b) => a.totalKg - b.totalKg);
    return {
      thresholds: { criticalKg: LOW_STOCK.CRITICAL_KG, lowKg: LOW_STOCK.LOW_KG },
      alerts,
      criticalCount: alerts.filter((a) => a.level === 'CRITICAL').length,
      lowCount: alerts.filter((a) => a.level === 'LOW').length,
    };
  }

  /**
   * Ageing stock (FIFO operational alert): individual in-stock units sorted oldest-first,
   * flagged AMBER (≥30d) / RED (≥60d) by arrival age. Factory-wide (stock isn't dept-
   * owned). Returns the oldest `take` flagged units + counts. Pairs with low-stock.
   */
  private async ageingStock(take = 8) {
    const now = new Date();
    const units = await this.prisma.material.findMany({
      where: { balanceKg: { gt: 0 } },
      select: { uniqueId: true, materialName: true, sku: true, balanceKg: true, stockUnit: true, arrivedAt: true },
    });
    const ordered = fifoSort(units).map((u) => {
      const days = ageDays(u.arrivedAt, now);
      return {
        uniqueId: u.uniqueId,
        materialName: u.materialName,
        sku: u.sku,
        balanceKg: u.balanceKg ?? 0,
        stockUnit: u.stockUnit,
        arrivedAt: u.arrivedAt,
        ageDays: days,
        level: ageingLevel(days),
      };
    });
    const flagged = ordered.filter((u) => u.level !== 'FRESH');
    return {
      thresholds: { amberDays: AGEING.AMBER_DAYS, redDays: AGEING.RED_DAYS },
      units: flagged.slice(0, take), // oldest-first
      amberCount: flagged.filter((u) => u.level === 'AMBER').length,
      redCount: flagged.filter((u) => u.level === 'RED').length,
      oldestAgeDays: ordered[0]?.ageDays ?? 0,
    };
  }

  /**
   * Movement time-series bucketed by day for the last `days` days. Optionally scoped
   * to a single department (for a production head — only their own DEDUCTs). One query,
   * bucketed in JS.
   */
  private async movementSeries(days: number, department?: Department) {
    const since = daysAgo(days);
    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        createdAt: { gte: since },
        ...(department ? { department } : {}),
      },
      select: { type: true, quantityKg: true, createdAt: true },
    });
    const buckets = dayBuckets(days);
    const index = new Map(buckets.map((k) => [k, { date: k, ADD: 0, DEDUCT: 0, DISCARD: 0 }]));
    for (const r of rows) {
      const slot = index.get(dayKey(r.createdAt));
      if (slot) slot[r.type] = Number((slot[r.type] + r.quantityKg).toFixed(6));
    }
    return buckets.map((k) => index.get(k)!);
  }

  /**
   * Movement totals per type (ADD/DEDUCT/DISCARD) for today / window / all-time, each
   * split BY UNIT so kilograms and litres are never blended. The unit lives on the
   * material, not the transaction, so we read the rows once (with their material's unit)
   * and bucket in JS rather than a groupBy that can't reach the relation.
   */
  private async movementTotals(days: number, department?: Department) {
    const rows = await this.prisma.stockTransaction.findMany({
      where: { ...(department ? { department } : {}) },
      select: { type: true, quantityKg: true, createdAt: true, material: { select: { stockUnit: true } } },
    });
    const todayStart = startOfToday();
    const windowStart = daysAgo(days);
    const pick = (from?: Date) => byTypeUnit(from ? rows.filter((r) => r.createdAt >= from) : rows);
    return { today: pick(todayStart), window: pick(windowStart), allTime: pick(), windowDays: days };
  }

  /** On-hand stock snapshot (factory-wide), totals split by unit. */
  private async stockSnapshot() {
    const mats = await this.prisma.material.findMany({
      where: { balanceKg: { not: null } },
      select: { materialName: true, sku: true, balanceKg: true, stockUnit: true },
    });
    const totalsByUnit = unitTotals(mats.map((m) => ({ unit: m.stockUnit, qty: m.balanceKg })));
    const keys = new Set(mats.map((d) => d.sku?.trim().toLowerCase() || d.materialName.trim().toLowerCase()));
    return {
      totalsByUnit,
      grandTotalKg: kgOnly(totalsByUnit), // kilogram-only; never a blended figure
      unitCount: mats.length,
      materialCount: keys.size,
    };
  }

  // ─────────────────────── Admin (factory-wide) ───────────────────────

  async adminOverview(days?: number) {
    const w = normalizeWindow(days);
    const [
      lowStock,
      ageing,
      snapshot,
      totals,
      series,
      reqByStatus,
      consumptionByDept,
      topConsumed,
      fulfilment,
      recentMovements,
      recentReviews,
    ] = await Promise.all([
      this.lowStock(),
      this.ageingStock(),
      this.stockSnapshot(),
      this.movementTotals(w),
      this.movementSeries(w),
      this.prisma.productionRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      // Consumption (DEDUCT) by department — window. Read with each row's material unit
      // so the per-department totals can be split by unit rather than blended.
      this.prisma.stockTransaction.findMany({
        where: { type: StockTxnType.DEDUCT, department: { not: null }, createdAt: { gte: daysAgo(w) } },
        select: { department: true, quantityKg: true, material: { select: { stockUnit: true } } },
      }),
      // Top materials by consumption (DEDUCT) — window.
      this.topConsumedMaterials(w),
      this.fulfilmentByDept(),
      this.prisma.stockTransaction.findMany({
        include: {
          actor: { select: { id: true, name: true } },
          material: { select: { uniqueId: true, materialName: true, sku: true, stockUnit: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.productionRequest.findMany({
        where: { reviewedAt: { not: null } },
        select: {
          id: true,
          department: true,
          status: true,
          reviewedAt: true,
          reviewedBy: { select: { name: true } },
        },
        orderBy: { reviewedAt: 'desc' },
        take: 8,
      }),
    ]);

    const requestsByStatus = emptyStatus();
    for (const g of reqByStatus) requestsByStatus[g.status] = g._count._all;

    const consumption = DEPARTMENTS.map((d) => ({
      department: d,
      totals: unitTotals(
        consumptionByDept
          .filter((c) => c.department === d)
          .map((c) => ({ unit: c.material?.stockUnit ?? 'kg', qty: c.quantityKg })),
      ),
    }));

    return {
      windowDays: w,
      lowStock,
      ageing,
      snapshot,
      totals,
      series,
      requestsByStatus,
      consumptionByDept: consumption,
      topConsumed,
      fulfilment,
      recentActivity: { movements: recentMovements, reviews: recentReviews },
    };
  }

  // ─────────────────────── Store ───────────────────────

  async storeOverview(days?: number) {
    const w = normalizeWindow(days);
    const [lowStock, ageing, snapshot, totals, series, pending, topRequested, recentIssues] = await Promise.all([
      this.lowStock(),
      this.ageingStock(),
      this.stockSnapshot(),
      this.movementTotals(w),
      this.movementSeries(w),
      // Pending queue: lines still awaiting Store action, and parent requests pending/in-progress.
      this.prisma.productionRequestItem.count({ where: { status: RequestStatus.PENDING } }),
      this.topRequestedMaterials(w),
      this.prisma.stockTransaction.findMany({
        where: { type: StockTxnType.DEDUCT },
        include: {
          actor: { select: { id: true, name: true } },
          material: { select: { uniqueId: true, materialName: true, sku: true, stockUnit: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const parentsPending = await this.prisma.productionRequest.count({
      where: { status: { in: [RequestStatus.PENDING, RequestStatus.IN_PROGRESS] } },
    });

    return {
      windowDays: w,
      lowStock,
      ageing,
      snapshot,
      totals,
      series,
      queue: { pendingLines: pending, openRequests: parentsPending },
      topRequested,
      recentIssues,
    };
  }

  // ─────────────────────── Production Head (own department only) ───────────────────────

  async myOverview(user: AuthUser, days?: number) {
    const department = ownDepartment(user); // 403 unless a head with a department
    const w = normalizeWindow(days);

    const [reqByStatus, itemAgg, series, totals, recent] = await Promise.all([
      this.prisma.productionRequest.groupBy({
        by: ['status'],
        where: { department },
        _count: { _all: true },
      }),
      this.prisma.productionRequestItem.groupBy({
        by: ['unit'],
        where: { request: { department } },
        _sum: { requestedKg: true, approvedKg: true, issuedKg: true },
      }),
      this.movementSeries(w, department), // ONLY this department's movements
      this.movementTotals(w, department),
      this.prisma.productionRequest.findMany({
        where: { department },
        select: {
          id: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          note: true,
          items: { select: { status: true, requestedKg: true, unit: true, approvedKg: true, issuedKg: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const requestsByStatus = emptyStatus();
    for (const g of reqByStatus) requestsByStatus[g.status] = g._count._all;

    return {
      department,
      windowDays: w,
      requestsByStatus,
      fulfilment: {
        requested: unitTotals(itemAgg.map((r) => ({ unit: r.unit, qty: r._sum.requestedKg ?? 0 }))),
        approved: unitTotals(itemAgg.map((r) => ({ unit: r.unit, qty: r._sum.approvedKg ?? 0 }))),
        issued: unitTotals(itemAgg.map((r) => ({ unit: r.unit, qty: r._sum.issuedKg ?? 0 }))),
      },
      consumptionSeries: series,
      totals,
      recentRequests: recent,
    };
  }

  // ─────────────────────── helpers ───────────────────────

  /** Top N materials by DEDUCT quantity over the window (optionally dept-scoped). */
  private async topConsumedMaterials(days: number, department?: Department, n = 6) {
    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        type: StockTxnType.DEDUCT,
        createdAt: { gte: daysAgo(days) },
        ...(department ? { department } : {}),
      },
      select: { quantityKg: true, material: { select: { materialName: true, sku: true, stockUnit: true } } },
    });
    return this.rollupByMaterial(
      rows.map((r) => ({ materialName: r.material.materialName, sku: r.material.sku, unit: r.material.stockUnit, quantityKg: r.quantityKg })),
      n,
    );
  }

  /** Top N materials by REQUESTED quantity over the window. */
  private async topRequestedMaterials(days: number, n = 6) {
    const rows = await this.prisma.productionRequestItem.findMany({
      where: { createdAt: { gte: daysAgo(days) } },
      select: { materialName: true, sku: true, requestedKg: true, unit: true },
    });
    return this.rollupByMaterial(
      rows.map((r) => ({ materialName: r.materialName, sku: r.sku, unit: r.unit, quantityKg: r.requestedKg })),
      n,
    );
  }

  // One material = one unit, so `totalKg` here is never a cross-unit blend; `unit` labels it.
  private rollupByMaterial(
    rows: { materialName: string; sku: string | null; unit: string; quantityKg: number }[],
    n: number,
  ) {
    const groups = new Map<string, { materialName: string; sku: string | null; unit: string; totalKg: number }>();
    for (const r of rows) {
      const key = r.sku?.trim().toLowerCase() || r.materialName.trim().toLowerCase();
      const g = groups.get(key) ?? { materialName: r.materialName, sku: r.sku, unit: r.unit || 'kg', totalKg: 0 };
      g.totalKg = Number((g.totalKg + r.quantityKg).toFixed(6));
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.totalKg - a.totalKg).slice(0, n);
  }

  /** Per-department requested / approved / issued (all-time), each split by unit. */
  private async fulfilmentByDept() {
    const out: Record<string, { requested: UnitTotal[]; approved: UnitTotal[]; issued: UnitTotal[] }> = {};
    await Promise.all(
      DEPARTMENTS.map(async (d) => {
        // Group by the line's own `unit` scalar — kg and L never merge into one figure.
        const rows = await this.prisma.productionRequestItem.groupBy({
          by: ['unit'],
          where: { request: { department: d } },
          _sum: { requestedKg: true, approvedKg: true, issuedKg: true },
        });
        out[d] = {
          requested: unitTotals(rows.map((r) => ({ unit: r.unit, qty: r._sum.requestedKg ?? 0 }))),
          approved: unitTotals(rows.map((r) => ({ unit: r.unit, qty: r._sum.approvedKg ?? 0 }))),
          issued: unitTotals(rows.map((r) => ({ unit: r.unit, qty: r._sum.issuedKg ?? 0 }))),
        };
      }),
    );
    return out;
  }
}
