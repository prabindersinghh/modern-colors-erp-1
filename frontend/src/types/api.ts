// API domain types mirroring the backend responses.

export type Role =
  | 'ADMIN'
  | 'SUPERVISOR'
  | 'OPERATOR'
  | 'OVERSIGHT'
  | 'PRODUCTION_HEAD'
  | 'DISPATCH' // Phase 3 — finished-goods dispatch only
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
  /** Measure of balanceKg — "kg" or "L" (litres for liquids like solvents). */
  stockUnit: string
  status: MaterialStatus
  /** Manual receiving weight. Historical only — receiving no longer weighs. */
  receivedWeight: number | null
  weighedAt: string | null
  /**
   * Live remaining stock for this unit, seeded at registration from the PO's
   * per-package `weight`. NULL means the invoice stated no pack size, so the unit is
   * blocked from being issued until an operator sets it on the PO.
   */
  balanceKg: number | null
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
  /** Unit of requestedKg/approvedKg/issuedKg — "kg" or "L" (litres for liquids). */
  unit: string
  status: RequestStatus
  approvedKg: number | null
  rejectionReason: string | null
  issuedKg: number
  reviewedAt: string | null
  fulfilledAt: string | null
  // Phase 3 — which batch this line's material is for (per line, not per request).
  batchId?: string | null
  batch?: { id: string; batchNumber: string; status: BatchStatus } | null
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

// FIFO advisory attached to a scanned unit (soft — never blocks).
export interface FifoContext {
  isOldest: boolean
  ageDays: number
  olderUnits: { uniqueId: string; arrivedAt: string | null; balanceKg: number; ageDays: number }[]
  recommended: { uniqueId: string; arrivedAt: string | null; balanceKg: number; ageDays: number } | null
}

// Compact unit shape returned by GET /stock/units/:uniqueId (has the live balance).
export interface StockUnit {
  id: string
  uniqueId: string
  materialName: string
  sku: string | null
  status: MaterialStatus
  receivedWeight: number | null
  balanceKg: number
  /** Measure of balanceKg — "kg" or "L". Labels the movement UI. */
  stockUnit: string
  arrivedAt: string | null
  po?: { poNumber: string | null; supplier: string | null }
  fifo?: FifoContext
}

export type AgeingLevel = 'FRESH' | 'AMBER' | 'RED'
export interface AgeingStock {
  thresholds: { amberDays: number; redDays: number }
  units: { uniqueId: string; materialName: string; sku: string | null; balanceKg: number; stockUnit: string; arrivedAt: string | null; ageDays: number; level: AgeingLevel }[]
  amberCount: number
  redCount: number
  oldestAgeDays: number
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
  material?: { uniqueId: string; materialName: string; sku: string | null; stockUnit?: string }
  requestItem?: { id: string; requestId: string; materialName: string } | null
}

// GET /stock/levels — live per-material stock (Store / Admin).
export interface StockLevelMaterial {
  materialName: string
  sku: string | null
  /** Measure of totalBalanceKg — "kg" or "L". */
  stockUnit: string
  totalBalanceKg: number
  unitCount: number
  // Oldest-first (FIFO order), each with received date + age + ageing level.
  units: {
    uniqueId: string
    balanceKg: number
    status: MaterialStatus
    arrivedAt: string | null
    ageDays: number
    ageingLevel: AgeingLevel
  }[]
}
export interface StockLevels {
  materials: StockLevelMaterial[]
  /** Factory-wide totals, one per measure — litres and kilograms are never summed together. */
  totalsByUnit: { unit: string; totalBalance: number; unitCount: number }[]
  /** Kilogram-only total (retained for compatibility). */
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

// ── Phase 2: Analytics dashboards (Step 8 enhancement) ──
export type StockAlertLevel = 'CRITICAL' | 'LOW'

export interface StockAlert {
  materialName: string
  sku: string | null
  totalKg: number
  unitCount: number
  level: StockAlertLevel
}
export interface LowStock {
  thresholds: { criticalKg: number; lowKg: number }
  alerts: StockAlert[]
  criticalCount: number
  lowCount: number
}

export interface MovementPoint {
  date: string
  ADD: number
  DEDUCT: number
  DISCARD: number
}
export interface MovementTotals {
  today: Record<StockTxnType, number>
  window: Record<StockTxnType, number>
  allTime: Record<StockTxnType, number>
  windowDays: number
}
export interface MaterialTotal {
  materialName: string
  sku: string | null
  totalKg: number
}

export interface AdminAnalytics {
  windowDays: number
  lowStock: LowStock
  ageing: AgeingStock
  snapshot: { grandTotalKg: number; unitCount: number; materialCount: number }
  totals: MovementTotals
  series: MovementPoint[]
  requestsByStatus: Record<RequestStatus, number>
  consumptionByDept: { department: Department; deductedKg: number }[]
  topConsumed: MaterialTotal[]
  fulfilment: Record<Department, { requestedKg: number; approvedKg: number; issuedKg: number }>
  recentActivity: {
    movements: (StockTransaction & { material?: { uniqueId: string; materialName: string; sku: string | null } })[]
    reviews: { id: string; department: Department; status: RequestStatus; reviewedAt: string | null; reviewedBy: { name: string } | null }[]
  }
}

export interface StoreAnalytics {
  windowDays: number
  lowStock: LowStock
  ageing: AgeingStock
  snapshot: { grandTotalKg: number; unitCount: number; materialCount: number }
  totals: MovementTotals
  series: MovementPoint[]
  queue: { pendingLines: number; openRequests: number }
  topRequested: MaterialTotal[]
  recentIssues: (StockTransaction & { material?: { uniqueId: string; materialName: string; sku: string | null } })[]
}

export interface MyAnalytics {
  department: Department
  windowDays: number
  requestsByStatus: Record<RequestStatus, number>
  fulfilment: { requestedKg: number; approvedKg: number; issuedKg: number }
  consumptionSeries: MovementPoint[]
  totals: MovementTotals
  recentRequests: {
    id: string
    status: RequestStatus
    createdAt: string
    reviewedAt: string | null
    note: string | null
    items: { status: RequestStatus; requestedKg: number; approvedKg: number | null; issuedKg: number }[]
  }[]
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

// ── Phase 3: Batches, Finished Goods & Dispatch ──
export type BatchStatus = 'OPEN' | 'OUTPUT_RECORDED' | 'CONFIRMED' | 'CLOSED'
export type FgStatus = 'GENERATED' | 'READY' | 'DISPATCHED'

export interface Batch {
  id: string
  batchNumber: string
  department: Department
  status: BatchStatus
  note: string | null
  createdAt: string
  createdBy?: { id: string; name: string }
  locked: boolean
  totals: {
    lineCount: number
    requestCount: number
    requestedKg: number
    approvedKg: number
    issuedKg: number
  }
  _count?: { requestItems: number; productionOutputs: number; finishedGoods: number }
}

export interface ProductionOutput {
  id: string
  batchId: string
  productName: string
  packageCount: number
  sizePerPackage: number
  sizeUnit: string
  productionDate: string
  shade: string | null
  productSku: string | null
  notes: string | null
  confirmed: boolean
  confirmedAt: string | null
  fgGeneratedAt: string | null
  createdAt: string
  batch?: { id: string; batchNumber: string; department: Department; status: BatchStatus }
  recordedBy?: { id: string; name: string }
  confirmedBy?: { id: string; name: string } | null
  _count?: { finishedGoods: number }
}

export interface FinishedGood {
  id: string
  uniqueId: string
  productName: string
  sizePerPackage: number
  sizeUnit: string
  status: FgStatus
  dispatchedAt: string | null
  dispatchNote: string | null
  createdAt: string
  batch?: { id: string; batchNumber: string; department: Department }
  output?: { id: string; productName: string; productionDate: string; shade: string | null }
  dispatchedBy?: { id: string; name: string } | null
  qrCode?: { payload: unknown; imageRef: string | null }
}

export interface DispatchReady {
  total: number
  batches: {
    batchId: string
    batchNumber: string
    department: string
    productName: string
    pending: number
    units: FinishedGood[]
  }[]
}

export interface DispatchHistory {
  recent: FinishedGood[]
  todayCount: number
  totalPending: number
}

export interface BatchTrace {
  batch: { id: string; batchNumber: string; department: Department; status: BatchStatus; note: string | null; createdAt: string; createdBy?: { name: string } }
  in: {
    lineCount: number
    requestCount: number
    totalIssuedKg: number
    materials: {
      lineId: string
      materialName: string
      sku: string | null
      requestedKg: number
      approvedKg: number | null
      issuedKg: number
      status: RequestStatus
      issues: { transactionId: string; quantityKg: number; at: string; by?: { name: string }; unit: { uniqueId: string; materialName: string; supplier: string | null; poNumber: string | null; arrivedAt: string | null } | null }[]
    }[]
    sources: { poId: string | null; poNumber: string | null; supplier: string | null; unitIds: string[] }[]
  }
  out: {
    outputCount: number
    confirmedCount: number
    fgTotal: number
    fgDispatched: number
    outputs: (ProductionOutput & { finishedGoods: { id: string; uniqueId: string; status: FgStatus; dispatchedAt: string | null; dispatchedBy?: { name: string } | null }[] })[]
  }
}

// GET /stock/ageing — plain "how old is my stock" view (Store / Admin).
export interface StockAgeingRow {
  uniqueId: string
  materialName: string
  sku: string | null
  balanceKg: number
  stockUnit: string
  arrivedAt: string | null
  ageDays: number
  level: AgeingLevel
  supplier: string | null
  poNumber: string | null
}
export interface StockAgeing {
  thresholds: { amberDays: number; redDays: number }
  units: StockAgeingRow[]
  buckets: {
    fresh: { label: string; unitCount: number; totalKg: number }
    amber: { label: string; unitCount: number; totalKg: number }
    red: { label: string; unitCount: number; totalKg: number }
  }
  oldestAgeDays: number
  totalUnits: number
}

// ── Dispatch analytics (Phase 3) ─────────────────────────────────────────────
export interface DispatchAnalytics {
  windowDays: number
  department: Department | null
  totals: {
    dispatchedToday: number
    dispatchedInWindow: number
    dispatchedAllTime: number
    readyForDispatch: number
    oldestReadyDays: number | null
    avgHoursToDispatch: number | null
  }
  volume: {
    dispatchedInWindow: { litres: number; kg: number }
    awaitingDispatch: { litres: number; kg: number }
  }
  series: { date: string; units: number }[]
  byDepartment: { department: Department; units: number }[]
  batches: { fullyDispatched: number; partiallyDispatched: number; notStarted: number }
  recent: {
    uniqueId: string
    productName: string
    dispatchedAt: string | null
    size: string
    by: string | null
    batchNumber: string | null
    department: Department | null
  }[]
}

// ── Company Brain: factory-wide flow (Admin only) ────────────────────────────
export interface FactoryFlow {
  range: { from: string; to: string }
  stages: {
    received: { kg: number; movements: number }
    issued: { kg: number; byDepartment: { department: Department; kg: number; movements: number }[] }
    discarded: { kg: number }
    batches: { opened: number }
    produced: {
      litres: number
      kg: number
      packages: number
      fgUnitsCreated: number
      byDepartment: { department: Department; litres: number; kg: number; packages: number; batches: number }[]
    }
    dispatched: {
      units: number
      litres: number
      kg: number
      byDepartment: { department: Department; units: number; litres: number; kg: number }[]
    }
  }
  derived: { yieldPct: number | null; inProcessKg: number; awaitingDispatchUnits: number }
}
