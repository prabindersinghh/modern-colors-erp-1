import { useCallback, useState } from 'react'
import {
  fetchInventoryBags,
  type InventoryFilters,
} from '@/services/inventoryService'
import type { InventoryBag, PaginatedResponse } from '@/types'
import { useAsync } from './useAsync'

const defaultFilters: InventoryFilters = {
  page: 1,
  pageSize: 15,
  sortBy: 'receivedAt',
  sortDirection: 'desc',
}

export function useInventory(initialFilters: InventoryFilters = {}) {
  const [filters, setFilters] = useState<InventoryFilters>({
    ...defaultFilters,
    ...initialFilters,
  })

  const fetcher = useCallback(
    () => fetchInventoryBags(filters),
    [filters]
  )

  const { data, loading, error, refetch } = useAsync<PaginatedResponse<InventoryBag>>(
    fetcher,
    [fetcher]
  )

  const updateFilters = useCallback((updates: Partial<InventoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates, page: updates.page ?? 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }))
  }, [])

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }))
  }, [])

  const setSort = useCallback(
    (sortBy: InventoryFilters['sortBy'], sortDirection: InventoryFilters['sortDirection']) => {
      setFilters((prev) => ({ ...prev, sortBy, sortDirection }))
    },
    []
  )

  return {
    bags: data?.data ?? [],
    total: data?.total ?? 0,
    page: data?.page ?? 1,
    pageSize: data?.pageSize ?? 15,
    totalPages: data?.totalPages ?? 0,
    filters,
    loading,
    error,
    refetch,
    updateFilters,
    setPage,
    setSearch,
    setSort,
  }
}
