import { mockRequest } from './api'
import { mockDb } from './mockData'
import type { InventoryBag, ReportFilter } from '@/types'

export interface InventoryReportRow {
  materialName: string
  sku: string
  totalBags: number
  totalWeight: number
  availableWeight: number
  warehouse: string
}

export interface ProductionReportRow {
  batchNumber: string
  paintType: string
  supervisor: string
  targetQuantity: number
  status: string
  date: string
  materialsConsumed: number
}

export interface SupplierReportRow {
  supplierName: string
  totalDeliveries: number
  totalWeight: number
  materials: string[]
}

export interface LowStockReportRow {
  materialName: string
  sku: string
  currentStock: number
  minStock: number
  deficit: number
  unit: string
}

export async function fetchInventoryReport(
  _filter?: ReportFilter
): Promise<InventoryReportRow[]> {
  return mockRequest(() => {
    const grouped = new Map<string, InventoryReportRow>()

    mockDb.inventoryBags.forEach((bag) => {
      const key = `${bag.materialId}-${bag.warehouseId}`
      const existing = grouped.get(key)
      if (existing) {
        existing.totalBags += 1
        existing.totalWeight += bag.originalWeight
        existing.availableWeight += bag.remainingWeight
      } else {
        grouped.set(key, {
          materialName: bag.materialName,
          sku: bag.sku,
          totalBags: 1,
          totalWeight: bag.originalWeight,
          availableWeight: bag.remainingWeight,
          warehouse: bag.warehouseName,
        })
      }
    })

    return Array.from(grouped.values())
  })
}

export async function fetchProductionReport(
  _filter?: ReportFilter
): Promise<ProductionReportRow[]> {
  return mockRequest(() => [
    {
      batchNumber: 'PB-2026-042',
      paintType: 'Premium Emulsion White',
      supervisor: 'Suresh Reddy',
      targetQuantity: 500,
      status: 'In Progress',
      date: new Date().toISOString(),
      materialsConsumed: 3,
    },
    {
      batchNumber: 'PB-2026-041',
      paintType: 'Exterior Red 500',
      supervisor: 'Priya Sharma',
      targetQuantity: 300,
      status: 'Completed',
      date: new Date(Date.now() - 86400000).toISOString(),
      materialsConsumed: 5,
    },
    {
      batchNumber: 'PB-2026-040',
      paintType: 'Interior Matt Blue',
      supervisor: 'Amit Patel',
      targetQuantity: 400,
      status: 'Completed',
      date: new Date(Date.now() - 172800000).toISOString(),
      materialsConsumed: 4,
    },
  ])
}

export async function fetchLowStockReport(): Promise<LowStockReportRow[]> {
  return mockRequest(() => {
    return mockDb.materials
      .map((m) => {
        const currentStock = mockDb.inventoryBags
          .filter((b) => b.materialId === m.id)
          .reduce((sum, b) => sum + b.remainingWeight, 0)
        return {
          materialName: m.name,
          sku: m.sku,
          currentStock,
          minStock: m.minStock,
          deficit: Math.max(0, m.minStock - currentStock),
          unit: m.unit,
        }
      })
      .filter((r) => r.currentStock < r.minStock)
  })
}

export async function fetchSupplierReport(
  _filter?: ReportFilter
): Promise<SupplierReportRow[]> {
  return mockRequest(() => {
    const grouped = new Map<string, SupplierReportRow>()

    mockDb.inventoryBags.forEach((bag) => {
      const existing = grouped.get(bag.supplierId)
      if (existing) {
        existing.totalDeliveries += 1
        existing.totalWeight += bag.originalWeight
        if (!existing.materials.includes(bag.materialName)) {
          existing.materials.push(bag.materialName)
        }
      } else {
        grouped.set(bag.supplierId, {
          supplierName: bag.supplierName,
          totalDeliveries: 1,
          totalWeight: bag.originalWeight,
          materials: [bag.materialName],
        })
      }
    })

    return Array.from(grouped.values())
  })
}

export function exportToCsv<T>(
  filename: string,
  rows: T[]
): void {
  if (rows.length === 0) return

  const headers = Object.keys(rows[0] as object)

  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const value = (row as Record<string, unknown>)[h]
          return `"${String(value ?? '').replace(/"/g, '""')}"`
        })
        .join(',')
    ),
  ].join('\n')

  const blob = new Blob([csvContent], {
    type: 'text/csv;charset=utf-8;',
  })

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

export function exportToPdfPlaceholder(reportName: string): void {
  window.print()
  console.info(`PDF export for ${reportName} - connect to backend for production PDF generation`)
}

export type { InventoryBag }
