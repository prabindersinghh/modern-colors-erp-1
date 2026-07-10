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
export type RequestStatus = 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'PARTIAL' | 'REJECTED'

export interface ProductionRequestItem {
  id: string
  materialName: string
  sku: string | null
  catalogueItemId: string | null
  requestedKg: number
  status: RequestStatus
  approvedKg: number | null
  rejectionReason: string | null
  issuedKg: number
  reviewedAt: string | null
  fulfilledAt: string | null
}

export interface ProductionRequest {
  id: string
  department: Department
  note: string | null
  status: RequestStatus // overall (derived from items)
  reviewedAt: string | null
  createdAt: string
  requestedBy?: { id: string; name: string; department: Department | null }
  reviewedBy?: { id: string; name: string } | null
  items: ProductionRequestItem[]
}

export interface RequestSummary {
  requests: { total: number; byStatus: Record<RequestStatus, number> }
  items: {
    total: number
    byStatus: Record<RequestStatus, number>
    totalRequestedKg: number
    totalIssuedKg: number
  }
}

// ── Phase 2: Stock movement (Step 6) ──
export type StockTxnType = 'ADD' | 'DEDUCT' | 'DISCARD'

// Compact unit shape returned by GET /stock/units/:uniqueId (has the live balance).
export interface StockUnit {
  id: string
  uniqueId: string
  materialName: string
  sku: string | null
  status: MaterialStatus
  receivedWeight: number | null
  balanceKg: number
  po?: { poNumber: string | null; supplier: string | null }
}

export interface StockTransaction {
  id: string
  materialId: string
  type: StockTxnType
  quantityKg: number
  department: Department | null
  requestItemId: string | null
  balanceAfter: number
  note: string | null
  createdAt: string
  actor?: { id: string; name: string }
  material?: { uniqueId: string; materialName: string; sku: string | null }
  requestItem?: { id: string; requestId: string; materialName: string } | null
}

// GET /stock/levels — live per-material stock (Store / Admin).
export interface StockLevelMaterial {
  materialName: string
  sku: string | null
  totalBalanceKg: number
  unitCount: number
  units: { uniqueId: string; balanceKg: number; status: MaterialStatus }[]
}
export interface StockLevels {
  materials: StockLevelMaterial[]
  grandTotalKg: number
  unitCount: number
}

// Body for POST /stock/transactions.
export interface CreateStockTransaction {
  uniqueId: string
  type: StockTxnType
  quantityKg: number
  department?: Department
  requestItemId?: string
  note?: string
  device?: string
}

// ── Phase 2: Admin oversight (Step 8) ──
// GET /production-requests/overview — factory-wide rollup (ADMIN/OVERSIGHT).
export interface Overview {
  requestMatrix: Record<Department, Record<RequestStatus, number>>
  fulfilment: Record<Department, { requestedKg: number; approvedKg: number; issuedKg: number }>
  stock: { grandTotalKg: number; unitCount: number; materialCount: number }
  movements: {
    allTime: Record<StockTxnType, number>
    recent: Record<StockTxnType, number>
    sinceDays: number
    byDepartment: Record<string, { ADD: number; DEDUCT: number }>
  }
  recentActivity: {
    reviews: {
      id: string
      department: Department
      status: RequestStatus
      reviewedAt: string | null
      reviewedBy: { name: string } | null
    }[]
    movements: (StockTransaction & {
      material?: { uniqueId: string; materialName: string; sku: string | null }
    })[]
  }
}
