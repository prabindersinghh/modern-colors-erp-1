// API domain types mirroring the backend responses.

export type Role = 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'OVERSIGHT' | 'PRODUCTION_HEAD'
export type Department = 'PU' | 'ENAMEL' | 'POWDER'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  department: Department | null // Phase 2 — set only for PRODUCTION_HEAD
}

export interface LoginResponse {
  accessToken: string
  user: AuthUser
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type POStatus = 'PO_UPLOADED' | 'AI_EXTRACTED' | 'OPERATOR_VERIFIED' | 'REGISTERED'
export type POSource = 'AI' | 'MANUAL'
export type MatchType = 'EXACT' | 'SIMILAR' | 'NONE'
export type MaterialStatus =
  | 'REGISTERED'
  | 'ARRIVED'
  | 'SCANNED'
  | 'WEIGHED'
  | 'READY_FOR_PRODUCTION'

export interface CatalogueItem {
  id: string
  materialName: string
  sku: string
  hsnCode: string | null
  category: string | null
  unit: string | null
  standardPackaging: string | null
  active: boolean
}

export interface POLineItem {
  id: string
  materialName: string
  hsnCode: string | null
  sku: string | null
  quantity: number
  unit: string | null
  weight: number | null
  batchNumber: string | null
  matchType: MatchType
  matchedCatalogueId: string | null
  matchedCatalogue?: CatalogueItem | null
  edited: boolean
}

export interface PurchaseOrder {
  id: string
  poNumber: string | null
  supplier: string | null
  fileName: string | null
  status: POStatus
  source: POSource
  deliveryDate: string | null
  createdAt: string
  uploadedBy?: { id: string; name: string }
  lineItems?: POLineItem[]
  _count?: { lineItems?: number; materials?: number }
}

export interface Material {
  id: string
  uniqueId: string
  materialName: string
  sku: string | null
  hsnCode: string | null
  supplier: string | null
  batchNumber: string | null
  unit: string | null
  weight: number | null
  status: MaterialStatus
  receivedWeight: number | null
  weighedAt: string | null
  createdAt: string
  qrCode?: { imageRef: string | null } | null
  po?: { poNumber: string | null }
}

export interface DashboardSummary {
  todaysPurchaseOrders: number
  materialsReceived: { total: number; today: number }
  pendingScanning: number
  pendingWeighing: number
  readyForProduction: number
  supplierStats: { label: string; count: number }[]
  materialStats: { label: string; count: number }[]
  poStatusBreakdown: Record<string, number>
}

export interface AuditEntry {
  id: string
  entityType: string
  entityId: string
  action: string
  device: string | null
  createdAt: string
  actor?: { name: string; email: string; role: Role } | null
}

export interface ApiKeyStatus {
  configured: boolean
  masked: string | null
  updatedAt: string | null
}

// ── Phase 2 ──
export type RequestStatus = 'PENDING' | 'APPROVED' | 'PARTIAL' | 'REJECTED'

export interface ProductionRequest {
  id: string
  department: Department
  materialName: string
  sku: string | null
  catalogueItemId: string | null
  requestedKg: number
  status: RequestStatus
  approvedKg: number | null
  rejectionReason: string | null
  issuedKg: number
  fulfilledAt: string | null
  createdAt: string
  requestedBy?: { id: string; name: string; department: Department | null }
  reviewedBy?: { id: string; name: string } | null
}

export interface RequestSummary {
  total: number
  byStatus: Record<RequestStatus, number>
  totalRequestedKg: number
  totalIssuedKg: number
}
