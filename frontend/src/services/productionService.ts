import { mockRequest } from './api'
import { mockDb } from './mockData'
import type { InventoryBag, ProductionConsumedBag, ProductionOrderItem } from '@/types'

let productionOrders: ProductionOrderItem[] = [
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
]

export async function fetchProductionOrders(): Promise<ProductionOrderItem[]> {
  return mockRequest(() => productionOrders)
}

export async function createProductionOrder(
  order: Omit<ProductionOrderItem, 'id' | 'consumedBags' | 'status'>
): Promise<ProductionOrderItem> {
  return mockRequest(() => {
    const newOrder: ProductionOrderItem = {
      ...order,
      id: `prod-${Date.now()}`,
      status: 'planned',
      consumedBags: [],
    }
    productionOrders = [newOrder, ...productionOrders]
    return newOrder
  })
}

export async function scanBagForProduction(
  orderId: string,
  qrId: string
): Promise<{ bag: InventoryBag; order: ProductionOrderItem }> {
  return mockRequest(() => {
    const bag = mockDb.inventoryBags.find((b) => b.qrId === qrId)
    if (!bag) throw new Error('Bag not found')
    if (bag.status === 'consumed') throw new Error('Bag is fully consumed')

    const orderIndex = productionOrders.findIndex((o) => o.id === orderId)
    if (orderIndex === -1) throw new Error('Production order not found')

    const order = { ...productionOrders[orderIndex] }
    const alreadyAdded = order.consumedBags.some((b) => b.bagId === bag.id)
    if (alreadyAdded) throw new Error('Bag already added to this order')

    order.consumedBags = [
      ...order.consumedBags,
      {
        bagId: bag.id,
        qrId: bag.qrId,
        materialName: bag.materialName,
        originalWeight: bag.originalWeight,
        consumedWeight: 0,
        remainingWeight: bag.remainingWeight,
      },
    ]
    order.status = 'in_progress'

    const updated = [...productionOrders]
    updated[orderIndex] = order
    productionOrders = updated

    return { bag, order }
  })
}

export async function updateConsumedQuantity(
  orderId: string,
  bagId: string,
  consumedWeight: number
): Promise<ProductionOrderItem> {
  return mockRequest(() => {
    const orderIndex = productionOrders.findIndex((o) => o.id === orderId)
    if (orderIndex === -1) throw new Error('Production order not found')

    const order = { ...productionOrders[orderIndex] }
    const bagIndex = order.consumedBags.findIndex((b) => b.bagId === bagId)
    if (bagIndex === -1) throw new Error('Bag not in order')

    const consumedBag = order.consumedBags[bagIndex]
    const remainingWeight = Math.max(0, consumedBag.originalWeight - consumedWeight)

    order.consumedBags = [...order.consumedBags]
    order.consumedBags[bagIndex] = {
      ...consumedBag,
      consumedWeight,
      remainingWeight,
    }

    const invIndex = mockDb.inventoryBags.findIndex((b) => b.id === bagId)
    if (invIndex !== -1) {
      const bags = [...mockDb.inventoryBags]
      bags[invIndex] = {
        ...bags[invIndex],
        remainingWeight,
        status: remainingWeight === 0 ? 'consumed' : 'issued',
      }
      mockDb.inventoryBags = bags
    }

    const updated = [...productionOrders]
    updated[orderIndex] = order
    productionOrders = updated

    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'production',
      materialName: consumedBag.materialName,
      qrId: consumedBag.qrId,
      quantity: consumedWeight,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Consumed ${consumedWeight} kg for ${order.batchNumber}`,
    })

    return order
  })
}

export async function completeProductionOrder(orderId: string): Promise<ProductionOrderItem> {
  return mockRequest(() => {
    const orderIndex = productionOrders.findIndex((o) => o.id === orderId)
    if (orderIndex === -1) throw new Error('Production order not found')

    const order = { ...productionOrders[orderIndex], status: 'completed' as const }
    const updated = [...productionOrders]
    updated[orderIndex] = order
    productionOrders = updated
    return order
  })
}

export type { ProductionConsumedBag }
