import { useCallback, useState } from 'react'
import {
  scanBagForProduction,
  updateConsumedQuantity,
  createProductionOrder,
  completeProductionOrder,
} from '@/services/productionService'
import type { ProductionOrderItem } from '@/types'

export function useProduction() {
  const [order, setOrder] = useState<ProductionOrderItem | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createOrder = useCallback(
    async (data: Omit<ProductionOrderItem, 'id' | 'consumedBags' | 'status'>) => {
      setError(null)
      try {
        const newOrder = await createProductionOrder(data)
        setOrder(newOrder)
        return newOrder
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create order')
        return null
      }
    },
    []
  )

  const scanBag = useCallback(
    async (qrId: string) => {
      if (!order) return null
      setScanning(true)
      setError(null)
      try {
        const result = await scanBagForProduction(order.id, qrId)
        setOrder(result.order)
        return result.bag
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scan failed')
        return null
      } finally {
        setScanning(false)
      }
    },
    [order]
  )

  const updateConsumption = useCallback(
    async (bagId: string, consumedWeight: number) => {
      if (!order) return null
      setError(null)
      try {
        const updated = await updateConsumedQuantity(order.id, bagId, consumedWeight)
        setOrder(updated)
        return updated
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update consumption')
        return null
      }
    },
    [order]
  )

  const complete = useCallback(async () => {
    if (!order) return null
    setError(null)
    try {
      const completed = await completeProductionOrder(order.id)
      setOrder(completed)
      return completed
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete order')
      return null
    }
  }, [order])

  return {
    order,
    scanning,
    error,
    createOrder,
    scanBag,
    updateConsumption,
    complete,
    setOrder,
  }
}
