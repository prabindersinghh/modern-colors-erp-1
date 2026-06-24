// Generic, framework-level types only.
// Phase 1 domain types (PurchaseOrder, Material, QrCode, etc.) will be added here
// as the real API integration is built (see docs/ARCHITECTURE.md). All Phase-2
// domain types (production/warehouse/consumption) were removed from the active app
// and preserved on the `phase2-draft` git branch.

export type SortDirection = 'asc' | 'desc'

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ApiError {
  message: string
  code?: string
}

export interface SelectOption {
  label: string
  value: string
}

export interface KpiMetric {
  id: string
  label: string
  value: number | string
  change?: number
  changeLabel?: string
  unit?: string
  trend?: 'up' | 'down' | 'neutral'
}

export interface AppNotification {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
  read: boolean
  timestamp: string
}
