import { useCallback } from 'react'
import { fetchDashboardData } from '@/services/dashboardService'
import { useAsync } from './useAsync'

export function useDashboard() {
  const fetcher = useCallback(() => fetchDashboardData(), [])
  return useAsync(fetcher, [fetcher])
}
