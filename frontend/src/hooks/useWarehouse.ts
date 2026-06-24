import { useCallback } from 'react'
import { fetchRacksWithBags, moveBagBetweenRacks } from '@/services/warehouseService'
import { useAsync } from './useAsync'

export function useWarehouse() {
  const fetcher = useCallback(() => fetchRacksWithBags(), [])
  const { data, loading, error, refetch } = useAsync(fetcher, [fetcher])

  const moveBag = useCallback(
    async (bagId: string, targetRackId: string) => {
      await moveBagBetweenRacks(bagId, targetRackId)
      await refetch()
    },
    [refetch]
  )

  return {
    racks: data ?? [],
    loading,
    error,
    refetch,
    moveBag,
  }
}
