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

const emptyStatus = (): Record<RequestStatus, number> => ({
  PENDING: 0,
  IN_PROGRESS: 0,
  APPROVED: 0,
  PARTIAL: 0,
  REJECTED: 0,
});

const emptyTxn = (): Record<StockTxnType, number> => ({ ADD: 0, DEDUCT: 0, DISCARD: 0 });

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
      select: { materialName: true, sku: true, balanceKg: true },
    });
    const groups = new Map<string, { materialName: string; sku: string | null; totalKg: number; unitCount: number }>();
    for (const u of units) {
      const key = u.sku?.trim().toLowerCase() || u.materialName.trim().toLowerCase();
      const g = groups.get(key) ?? { materialName: u.materialName, sku: u.sku, totalKg: 0, unitCount: 0 };
      g.totalKg = Number((g.totalKg + (u.balanceKg ?? 0)).toFixed(6));
      g.unitCount += 1;
      groups.set(key, g);
    }
    const alerts = [...groups.values()]
      .filter((g) => g.totalKg < LOW_STOCK.LOW_KG)
      .map((g) => ({
        ...g,
        level: (g.totalKg < LOW_STOCK.CRITICAL_KG ? 'CRITICAL' : 'LOW') as StockAlertLevel,
      }))
      .sort((a, b) => a.totalKg - b.totalKg);
    return {
      thresholds: { criticalKg: LOW_STOCK.CRITICAL_KG, lowKg: LOW_STOCK.LOW_KG },
      alerts,
      criticalCount: alerts.filter((a) => a.level === 'CRITICAL').length,
      lowCount: alerts.filter((a) => a.level === 'LOW').length,
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

  /** Movement totals for a set of windows (today / window / all-time). */
  private async movementTotals(days: number, department?: Department) {
    const deptWhere = department ? { department } : {};
    const [today, windowed, all] = await Promise.all([
      this.prisma.stockTransaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: startOfToday() }, ...deptWhere },
        _sum: { quantityKg: true },
      }),
      this.prisma.stockTransaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: daysAgo(days) }, ...deptWhere },
        _sum: { quantityKg: true },
      }),
      this.prisma.stockTransaction.groupBy({
        by: ['type'],
        where: { ...deptWhere },
        _sum: { quantityKg: true },
      }),
    ]);
    const fill = (rows: { type: StockTxnType; _sum: { quantityKg: number | null } }[]) => {
      const t = emptyTxn();
      for (const r of rows) t[r.type] = Number((r._sum.quantityKg ?? 0).toFixed(6));
      return t;
    };
    return { today: fill(today), window: fill(windowed), allTime: fill(all), windowDays: days };
  }

  /** On-hand stock snapshot (factory-wide). */
  private async stockSnapshot() {
    const agg = await this.prisma.material.aggregate({
      where: { balanceKg: { not: null } },
      _sum: { balanceKg: true },
      _count: { _all: true },
    });
    const distinct = await this.prisma.material.findMany({
      where: { balanceKg: { not: null } },
      select: { materialName: true, sku: true },
    });
    const keys = new Set(distinct.map((d) => d.sku?.trim().toLowerCase() || d.materialName.trim().toLowerCase()));
    return {
      grandTotalKg: Number((agg._sum.balanceKg ?? 0).toFixed(6)),
      unitCount: agg._count._all,
      materialCount: keys.size,
    };
  }

  // ─────────────────────── Admin (factory-wide) ───────────────────────

  async adminOverview(days?: number) {
    const w = normalizeWindow(days);
    const [
      lowStock,
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
      this.stockSnapshot(),
      this.movementTotals(w),
      this.movementSeries(w),
      this.prisma.productionRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      // Consumption (DEDUCT) by department — window.
      this.prisma.stockTransaction.groupBy({
        by: ['department'],
        where: { type: StockTxnType.DEDUCT, department: { not: null }, createdAt: { gte: daysAgo(w) } },
        _sum: { quantityKg: true },
      }),
      // Top materials by consumption (DEDUCT) — window.
      this.topConsumedMaterials(w),
      this.fulfilmentByDept(),
      this.prisma.stockTransaction.findMany({
        include: {
          actor: { select: { id: true, name: true } },
          material: { select: { uniqueId: true, materialName: true, sku: true } },
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
      deductedKg: Number(
        (consumptionByDept.find((c) => c.department === d)?._sum.quantityKg ?? 0).toFixed(6),
      ),
    }));

    return {
      windowDays: w,
      lowStock,
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
    const [lowStock, snapshot, totals, series, pending, topRequested, recentIssues] = await Promise.all([
      this.lowStock(),
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
          material: { select: { uniqueId: true, materialName: true, sku: true } },
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
      this.prisma.productionRequestItem.aggregate({
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
          items: { select: { status: true, requestedKg: true, approvedKg: true, issuedKg: true } },
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
        requestedKg: Number((itemAgg._sum.requestedKg ?? 0).toFixed(6)),
        approvedKg: Number((itemAgg._sum.approvedKg ?? 0).toFixed(6)),
        issuedKg: Number((itemAgg._sum.issuedKg ?? 0).toFixed(6)),
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
      select: { quantityKg: true, material: { select: { materialName: true, sku: true } } },
    });
    return this.rollupByMaterial(rows.map((r) => ({ ...r.material, quantityKg: r.quantityKg })), n);
  }

  /** Top N materials by REQUESTED quantity over the window. */
  private async topRequestedMaterials(days: number, n = 6) {
    const rows = await this.prisma.productionRequestItem.findMany({
      where: { createdAt: { gte: daysAgo(days) } },
      select: { materialName: true, sku: true, requestedKg: true },
    });
    return this.rollupByMaterial(
      rows.map((r) => ({ materialName: r.materialName, sku: r.sku, quantityKg: r.requestedKg })),
      n,
    );
  }

  private rollupByMaterial(
    rows: { materialName: string; sku: string | null; quantityKg: number }[],
    n: number,
  ) {
    const groups = new Map<string, { materialName: string; sku: string | null; totalKg: number }>();
    for (const r of rows) {
      const key = r.sku?.trim().toLowerCase() || r.materialName.trim().toLowerCase();
      const g = groups.get(key) ?? { materialName: r.materialName, sku: r.sku, totalKg: 0 };
      g.totalKg = Number((g.totalKg + r.quantityKg).toFixed(6));
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.totalKg - a.totalKg).slice(0, n);
  }

  /** Per-department requested / approved / issued (all-time). */
  private async fulfilmentByDept() {
    const out: Record<string, { requestedKg: number; approvedKg: number; issuedKg: number }> = {};
    await Promise.all(
      DEPARTMENTS.map(async (d) => {
        const agg = await this.prisma.productionRequestItem.aggregate({
          where: { request: { department: d } },
          _sum: { requestedKg: true, approvedKg: true, issuedKg: true },
        });
        out[d] = {
          requestedKg: Number((agg._sum.requestedKg ?? 0).toFixed(6)),
          approvedKg: Number((agg._sum.approvedKg ?? 0).toFixed(6)),
          issuedKg: Number((agg._sum.issuedKg ?? 0).toFixed(6)),
        };
      }),
    );
    return out;
  }
}
