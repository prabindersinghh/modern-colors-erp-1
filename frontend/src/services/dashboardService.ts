import { mockRequest } from './api'
import { mockDb } from './mockData'
import type {
  InventoryTrendPoint,
  KpiMetric,
  LowStockAlert,
  MaterialActivity,
  ProductionOrderItem,
} from '@/types'

export interface DashboardData {
  kpis: KpiMetric[]
  recentActivity: MaterialActivity[]
  inventoryTrends: InventoryTrendPoint[]
  lowStockAlerts: LowStockAlert[]
  todaysProduction: ProductionOrderItem[]
  qrActivityCount: number
}

export async function fetchDashboardData(): Promise<DashboardData> {
  return mockRequest(() => {
    const bags = mockDb.inventoryBags
    const availableBags = bags.filter((b) => b.status === 'available')
    const totalWeight = availableBags.reduce((sum, b) => sum + b.remainingWeight, 0)
    const lowStockCount = mockDb.materials.filter((m) => {
      const stock = bags
        .filter((b) => b.materialId === m.id && b.status !== 'consumed')
        .reduce((sum, b) => sum + b.remainingWeight, 0)
      return stock < m.minStock
    }).length

    const kpis: KpiMetric[] = [
      {
        id: 'total-bags',
        label: 'Total Bags in Stock',
        value: availableBags.length,
        change: 12,
        changeLabel: 'vs last week',
        trend: 'up',
      },
      {
        id: 'total-weight',
        label: 'Total Inventory Weight',
        value: totalWeight.toFixed(0),
        unit: 'kg',
        change: 8.5,
        changeLabel: 'vs last week',
        trend: 'up',
      },
      {
        id: 'inward-today',
        label: 'Inward Today',
        value: 12,
        change: 3,
        changeLabel: 'bags received',
        trend: 'up',
      },
      {
        id: 'low-stock',
        label: 'Low Stock Items',
        value: lowStockCount,
        change: lowStockCount > 0 ? -2 : 0,
        changeLabel: 'materials below min',
        trend: lowStockCount > 0 ? 'down' : 'neutral',
      },
      {
        id: 'production-active',
        label: 'Active Production',
        value: 2,
        unit: 'batches',
        trend: 'neutral',
      },
      {
        id: 'qr-scans',
        label: 'QR Scans Today',
        value: 47,
        change: 15,
        changeLabel: 'vs yesterday',
        trend: 'up',
      },
    ]

    const inventoryTrends: InventoryTrendPoint[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return {
        date: d.toISOString().slice(0, 10),
        totalBags: 180 + i * 8 + Math.floor(Math.random() * 10),
        totalWeight: 4200 + i * 120,
        inward: 10 + Math.floor(Math.random() * 15),
        issued: 8 + Math.floor(Math.random() * 12),
      }
    })

    const lowStockAlerts: LowStockAlert[] = mockDb.materials
      .map((m) => {
        const currentStock = bags
          .filter((b) => b.materialId === m.id)
          .reduce((sum, b) => sum + b.remainingWeight, 0)
        return { material: m, currentStock }
      })
      .filter(({ material, currentStock }) => currentStock < material.minStock)
      .map(({ material, currentStock }) => ({
        id: material.id,
        materialName: material.name,
        sku: material.sku,
        currentStock,
        minStock: material.minStock,
        unit: material.unit,
        severity: currentStock < material.minStock * 0.5 ? 'critical' : 'warning',
      }))

    const todaysProduction: ProductionOrderItem[] = [
      {
        id: 'prod-1',
        batchNumber: 'PB-2026-042',
        paintType: 'Premium Emulsion White',
        supervisor: 'Suresh Reddy',
        targetQuantity: 500,
        date: new Date().toISOString(),
        status: 'in_progress',
        consumedBags: [],
      },
      {
        id: 'prod-2',
        batchNumber: 'PB-2026-043',
        paintType: 'Exterior Red 500',
        supervisor: 'Priya Sharma',
        targetQuantity: 300,
        date: new Date().toISOString(),
        status: 'planned',
        consumedBags: [],
      },
    ]

    return {
      kpis,
      recentActivity: mockDb.activities.slice(0, 8),
      inventoryTrends,
      lowStockAlerts,
      todaysProduction,
      qrActivityCount: 47,
    }
  })
}
