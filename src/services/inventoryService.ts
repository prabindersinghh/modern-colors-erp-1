import { buildQueryString, mockRequest } from './api'
import { mockDb } from './mockData'
import type {
  BagStatus,
  InventoryBag,
  MaterialActivity,
  PaginatedResponse,
  SortDirection,
} from '@/types'

export interface InventoryFilters {
  material?: string
  supplier?: string
  status?: BagStatus | ''
  warehouse?: string
  rack?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: keyof InventoryBag
  sortDirection?: SortDirection
}

export async function fetchInventoryBags(
  filters: InventoryFilters = {}
): Promise<PaginatedResponse<InventoryBag>> {
  return mockRequest(() => {
    const {
      material,
      supplier,
      status,
      warehouse,
      rack,
      search,
      page = 1,
      pageSize = 15,
      sortBy = 'receivedAt',
      sortDirection = 'desc',
    } = filters

    let filtered = [...mockDb.inventoryBags]

    if (material) {
      filtered = filtered.filter(
        (b) => b.materialId === material || b.materialName.toLowerCase().includes(material.toLowerCase())
      )
    }
    if (supplier) {
      filtered = filtered.filter(
        (b) => b.supplierId === supplier || b.supplierName.toLowerCase().includes(supplier.toLowerCase())
      )
    }
    if (status) {
      filtered = filtered.filter((b) => b.status === status)
    }
    if (warehouse) {
      filtered = filtered.filter(
        (b) => b.warehouseId === warehouse || b.warehouseName.toLowerCase().includes(warehouse.toLowerCase())
      )
    }
    if (rack) {
      filtered = filtered.filter(
        (b) => b.rackId === rack || b.rackCode.toLowerCase() === rack.toLowerCase()
      )
    }
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (b) =>
          b.qrId.toLowerCase().includes(q) ||
          b.materialName.toLowerCase().includes(q) ||
          b.sku.toLowerCase().includes(q) ||
          b.batchNumber.toLowerCase().includes(q)
      )
    }

    filtered.sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }
      return 0
    })

    const total = filtered.length
    const start = (page - 1) * pageSize
    const data = filtered.slice(start, start + pageSize)

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  })
}

export async function fetchBagByQr(qrId: string): Promise<InventoryBag | null> {
  return mockRequest(() => {
    return mockDb.inventoryBags.find((b) => b.qrId === qrId) ?? null
  })
}

export async function fetchBagById(id: string): Promise<InventoryBag | null> {
  return mockRequest(() => {
    return mockDb.inventoryBags.find((b) => b.id === id) ?? null
  })
}

export async function issueMaterial(
  bagId: string,
  quantity: number
): Promise<InventoryBag> {
  return mockRequest(() => {
    const bags = mockDb.inventoryBags
    const index = bags.findIndex((b) => b.id === bagId)
    if (index === -1) throw new Error('Bag not found')

    const bag = { ...bags[index] }
    bag.remainingWeight = Math.max(0, bag.remainingWeight - quantity)
    bag.status = bag.remainingWeight === 0 ? 'consumed' : 'issued'

    const updated = [...bags]
    updated[index] = bag
    mockDb.inventoryBags = updated

    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'issue',
      materialName: bag.materialName,
      qrId: bag.qrId,
      quantity,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Issued ${quantity} kg from ${bag.qrId}`,
    })

    return bag
  })
}

export async function moveBagToRack(
  bagId: string,
  rackId: string
): Promise<InventoryBag> {
  return mockRequest(() => {
    const rack = mockDb.racks.find((r) => r.id === rackId)
    if (!rack) throw new Error('Rack not found')

    const bags = mockDb.inventoryBags
    const index = bags.findIndex((b) => b.id === bagId)
    if (index === -1) throw new Error('Bag not found')

    const bag = { ...bags[index], rackId: rack.id, rackCode: rack.code }
    const updated = [...bags]
    updated[index] = bag
    mockDb.inventoryBags = updated

    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'move',
      materialName: bag.materialName,
      qrId: bag.qrId,
      quantity: bag.remainingWeight,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Moved to rack ${rack.code}`,
    })

    return bag
  })
}

export async function updateBagWeight(
  bagId: string,
  remainingWeight: number
): Promise<InventoryBag> {
  return mockRequest(() => {
    const bags = mockDb.inventoryBags
    const index = bags.findIndex((b) => b.id === bagId)
    if (index === -1) throw new Error('Bag not found')

    const bag = { ...bags[index], remainingWeight }
    const updated = [...bags]
    updated[index] = bag
    mockDb.inventoryBags = updated

    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'adjustment',
      materialName: bag.materialName,
      qrId: bag.qrId,
      quantity: remainingWeight,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Weight adjusted to ${remainingWeight} kg`,
    })

    return bag
  })
}

export async function fetchBagHistory(bagId: string): Promise<MaterialActivity[]> {
  return mockRequest(() => {
    const bag = mockDb.inventoryBags.find((b) => b.id === bagId)
    if (!bag) return []
    return mockDb.activities.filter(
      (a) => a.qrId === bag.qrId || a.materialName === bag.materialName
    )
  })
}

export function getInventoryQueryString(filters: InventoryFilters): string {
  return buildQueryString({
    material: filters.material,
    supplier: filters.supplier,
    status: filters.status,
    warehouse: filters.warehouse,
    rack: filters.rack,
    search: filters.search,
    page: filters.page,
    pageSize: filters.pageSize,
    sortBy: filters.sortBy as string,
    sortDirection: filters.sortDirection,
  })
}
