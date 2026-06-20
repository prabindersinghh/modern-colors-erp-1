import { mockRequest } from './api'
import { mockDb } from './mockData'
import type { InventoryBag, Rack } from '@/types'

export interface RackWithBags extends Rack {
  warehouseName: string
  bags: InventoryBag[]
}

export async function fetchRacksWithBags(): Promise<RackWithBags[]> {
  return mockRequest(() => {
    return mockDb.racks.map((rack) => {
      const warehouse = mockDb.warehouses.find((w) => w.id === rack.warehouseId)
      const bags = mockDb.inventoryBags.filter(
        (b) => b.rackId === rack.id && b.status !== 'consumed'
      )
      return {
        ...rack,
        warehouseName: warehouse?.name ?? '',
        occupied: bags.length,
        bags,
      }
    })
  })
}

export async function moveBagBetweenRacks(
  bagId: string,
  targetRackId: string
): Promise<InventoryBag> {
  return mockRequest(() => {
    const rack = mockDb.racks.find((r) => r.id === targetRackId)
    if (!rack) throw new Error('Target rack not found')

    const bags = mockDb.inventoryBags
    const index = bags.findIndex((b) => b.id === bagId)
    if (index === -1) throw new Error('Bag not found')

    const updatedBag: InventoryBag = {
      ...bags[index],
      rackId: rack.id,
      rackCode: rack.code,
      warehouseId: rack.warehouseId,
      warehouseName:
        mockDb.warehouses.find((w) => w.id === rack.warehouseId)?.name ??
        bags[index].warehouseName,
    }

    const updated = [...bags]
    updated[index] = updatedBag
    mockDb.inventoryBags = updated

    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'move',
      materialName: updatedBag.materialName,
      qrId: updatedBag.qrId,
      quantity: updatedBag.remainingWeight,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Moved to rack ${rack.code}`,
    })

    return updatedBag
  })
}

export async function fetchWarehouseRacks(warehouseId?: string): Promise<Rack[]> {
  return mockRequest(() => {
    if (warehouseId) {
      return mockDb.racks.filter((r) => r.warehouseId === warehouseId)
    }
    return mockDb.racks
  })
}
