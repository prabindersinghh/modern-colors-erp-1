// API domain types mirroring the backend responses.

export type Role =
  | 'ADMIN'
  | 'SUPERVISOR'
  | 'OPERATOR'
  | 'OVERSIGHT'
  | 'PRODUCTION_HEAD'
  | 'DISPATCH' // Phase 3 — finished-goods dispatch only
  | 'REVIEWER' // Segregation of duties — view-only: invoice + slip, nothing else
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
  minLevel?: number | null
  maxLevel?: number | null
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
  /** When the truck arrived (Gate-stated). Falls back to createdAt for older invoices. */
  arrivedAt: string | null
  createdAt: string
  uploadedById?: string
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
  beforeJson?: unknown
  afterJson?: unknown
  actor?: { id?: string; name: string; email: string; role: Role } | null
}

/** Per-login activity count from the audit engine's summary. */
export interface AuditSummaryRow {
  actor: { id: string; name: string | null; email: string; role: Role } | null
  actorId: string | null
  count: number
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
    requestedTotals: UnitTotal[]
    issuedTotals: UnitTotal[]
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
  /** Null until Store confirms — at extraction no unit exists yet. */
  unitCount: number | null
  /** Admin-set thresholds (catalogue) and fullness %; null when not configured. */
  minLevel: number | null
  maxLevel: number | null
  pct: number | null
  // Oldest-first (FIFO order), each with received date + age + ageing level.
  units: {
    uniqueId: string
    balanceKg: number
    /** Physically here but no pack weight — listed and flagged, never hidden. */
    needsWeight: boolean
    status: MaterialStatus
    arrivedAt: string | null
    ageDays: number
    ageingLevel: AgeingLevel
  }[]
}
export interface StockLevels {
  materials: StockLevelMaterial[]
  /** Factory-wide totals, one per measure — litres and kilograms are never summed together. */
  totalsByUnit: UnitTotal[]
  /** Kilogram-only total (retained for compatibility). */
  grandTotalKg: number
  unitCount: number
  /** Arrived units with no pack weight — in the factory, flagged, excluded from totals. */
  needsWeightUnits: number
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

// ── User management (factory Admin) ──
export interface ManagedUser {
  id: string
  email: string
  name: string
  role: Role
  department: Department | null
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  /** True for the logins that came with the system, false for ones the Admin created.
   *  Optional because the UI and the API deploy separately — an older API omits it,
   *  and a missing flag must show nothing rather than guess "created by you". */
  seeded?: boolean
  /** Seeded logins only: still on the published default password. */
  usingDefaultPassword?: boolean
}

/** Per-person activity in the window — PU vs PU2, separately. */
export interface TeamActivityRow {
  id: string
  name: string
  email: string
  requestsRaised: number
  batchesCreated: number
  outputsRecorded: number
  outputsConfirmed: number
  unitsDispatched: number
  returnsProcessed: number
}

// ── Phase 2: Analytics dashboards (Step 8 enhancement) ──
export type StockAlertLevel = 'CRITICAL' | 'LOW'

/**
 * A quantity total that is ALWAYS unit-aware. The backend groups by unit and never
 * blends kilograms and litres — one entry when uniform, several when mixed. Render with
 * `formatUnitTotals` (lib/units), which yields "97.8 kg" or "1,200 kg · 340 L".
 */
export interface UnitTotal {
  unit: string
  total: number
}

export interface StockAlert {
  materialName: string
  sku: string | null
  stockUnit: string
  totalKg: number
  unitCount: number
  /** The Admin-set minimum that triggered this alert (null = built-in default). */
  minLevel?: number | null
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
/** Each type's total split by unit — kg and L are never summed into one figure. */
export interface MovementTotals {
  today: Record<StockTxnType, UnitTotal[]>
  window: Record<StockTxnType, UnitTotal[]>
  allTime: Record<StockTxnType, UnitTotal[]>
  windowDays: number
}
export interface MaterialTotal {
  materialName: string
  sku: string | null
  unit: string
  totalKg: number
}

/** Per-department requested / approved / issued, each split by unit. */
export interface Fulfilment {
  requested: UnitTotal[]
  approved: UnitTotal[]
  issued: UnitTotal[]
}

/** On-hand snapshot — totals split by unit; grandTotalKg is the kilogram-only slice. */
export interface StockSnapshot {
  totalsByUnit: UnitTotal[]
  grandTotalKg: number
  unitCount: number
  materialCount: number
}

export interface AdminAnalytics {
  windowDays: number
  lowStock: LowStock
  ageing: AgeingStock
  snapshot: StockSnapshot
  totals: MovementTotals
  series: MovementPoint[]
  requestsByStatus: Record<RequestStatus, number>
  consumptionByDept: { department: Department; totals: UnitTotal[] }[]
  topConsumed: MaterialTotal[]
  fulfilment: Record<Department, Fulfilment>
  team: TeamActivityRow[]
  recentActivity: {
    movements: (StockTransaction & { material?: { uniqueId: string; materialName: string; sku: string | null; stockUnit?: string } })[]
    reviews: { id: string; department: Department; status: RequestStatus; reviewedAt: string | null; reviewedBy: { name: string } | null }[]
  }
}

export interface StoreAnalytics {
  windowDays: number
  lowStock: LowStock
  ageing: AgeingStock
  snapshot: StockSnapshot
  totals: MovementTotals
  series: MovementPoint[]
  queue: { pendingLines: number; openRequests: number }
  topRequested: MaterialTotal[]
  recentIssues: (StockTransaction & { material?: { uniqueId: string; materialName: string; sku: string | null; stockUnit?: string } })[]
}

export interface MyAnalytics {
  department: Department
  windowDays: number
  requestsByStatus: Record<RequestStatus, number>
  fulfilment: Fulfilment
  consumptionSeries: MovementPoint[]
  totals: MovementTotals
  team: TeamActivityRow[]
  recentRequests: {
    id: string
    status: RequestStatus
    createdAt: string
    reviewedAt: string | null
    note: string | null
    items: { status: RequestStatus; requestedKg: number; unit: string; approvedKg: number | null; issuedKg: number }[]
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
      material?: { uniqueId: string; materialName: string; sku: string | null; stockUnit?: string }
    })[]
  }
}

// ── Phase 3: Batches, Finished Goods & Dispatch ──
export type BatchStatus = 'OPEN' | 'OUTPUT_RECORDED' | 'CONFIRMED' | 'CLOSED'
export type FgStatus = 'GENERATED' | 'READY' | 'DISPATCHED' | 'SCRAPPED' | 'REFURBISHED'

export interface Batch {
  id: string
  batchNumber: string
  department: Department
  status: BatchStatus
  note: string | null
  createdAt: string
  createdBy?: { id: string; name: string }
  locked: boolean
  /** Dispatch visibility for the head: of this batch's FG units, how many shipped. */
  fg?: { total: number; dispatched: number; awaiting: number; scrapped: number; refurbished: number; pct: number }
  totals: {
    lineCount: number
    requestCount: number
    /** Each split by unit — a batch fed by kg and L never reports one blended figure. */
    requested: UnitTotal[]
    approved: UnitTotal[]
    issued: UnitTotal[]
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
  /** Dispatch status of this output's FG units — null until QRs are generated. */
  fgStats?: { total: number; dispatched: number; awaiting: number; scrapped: number; refurbished: number; pct: number } | null
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
  // Returns
  returnedAt?: string | null
  returnNote?: string | null
  returnedBy?: { id: string; name: string } | null
  /** Set on a refurbished unit: the original identity it replaced. */
  refurbishedFrom?: { uniqueId: string } | null
  /** Set on a returned original that was refurbished: its replacement. */
  refurbishedInto?: { uniqueId: string; status: FgStatus } | null
}

export interface DispatchReady {
  total: number
  batches: {
    batchId: string
    batchNumber: string
    department: string
    productName: string
    pending: number
    dispatched: number
    total: number
    /** 0-100 — how much of the batch has already shipped. */
    pct: number
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
    /** Issued totals grouped by measure — kg and L are never added together. */
    totalIssuedByUnit: UnitTotal[]
    materials: {
      lineId: string
      materialName: string
      sku: string | null
      requestedKg: number
      approvedKg: number | null
      issuedKg: number
      /** Measure of the three figures above — "kg" or "L". */
      unit: string
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
    fresh: { label: string; unitCount: number; totals: UnitTotal[] }
    amber: { label: string; unitCount: number; totals: UnitTotal[] }
    red: { label: string; unitCount: number; totals: UnitTotal[] }
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
  /** How long finished goods sit before dispatch (amber ≥7d, red ≥14d). */
  fgAgeing: {
    thresholds: { amberDays: number; redDays: number }
    fresh: { units: number }
    amber: { units: number; volume: { litres: number; kg: number } }
    red: { units: number; volume: { litres: number; kg: number } }
    oldest: {
      uniqueId: string
      productName: string
      batchNumber: string | null
      department: Department | null
      size: string
      ageDays: number
      level: 'FRESH' | 'AMBER' | 'RED'
    }[]
  }
  /** Every dispatched good in the window, batch-wise. */
  dispatchedByBatch: {
    batchId: string
    batchNumber: string
    department: Department
    productName: string
    units: number
    litres: number
    kg: number
    lastDispatchedAt: string | null
  }[]
  /** Per-product rollup of dispatched goods in the window. */
  dispatchedByProduct: { productName: string; units: number; litres: number; kg: number }[]
  returns: {
    window: { scrapped: number; refurbished: number }
    allTime: { scrapped: number; refurbished: number }
  }
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
    // Raw material is kg OR litres — carried as a per-unit breakdown, never blended.
    /** Units that physically ARRIVED (receiving scan) in the range. */
    received: { totals: UnitTotal[]; units: number; blockedUnits: number }
    /** Live snapshot of what sits in the factory NOW (same source as stock levels). */
    inStore: { totals: UnitTotal[]; blockedUnits: number }
    issued: { totals: UnitTotal[]; byDepartment: { department: Department; totals: UnitTotal[]; movements: number }[] }
    discarded: { totals: UnitTotal[] }
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

// ── Label reprint approvals (the lock) ──

export interface SlipLine {
  materialName: string
  sku: string | null
  quantity: number
  unit: string | null
  packWeight: number | null
  /** "kg" or "L" — labelled per line, never summed across lines. */
  measure: string
  idFrom: string
  idTo: string
}

export interface ReceivingSlip {
  id: string
  slipNumber: string
  poId: string
  supplier: string | null
  receivedDate: string
  lines: SlipLine[]
  unitCount: number
  status: 'DRAFT' | 'AWAITING_STORE' | 'FINALIZED'
  generatedAt: string
  handedOverAt?: string | null
  confirmedAt?: string | null
  finalizedAt: string | null
  scannedCount: number | null
  generatedBy?: { name: string | null; email: string } | null
  finalizedBy?: { name: string | null; email: string } | null
}

/** One inward as the Reviewer sees it: the invoice, and its slip if it has one. */
export interface Inward {
  id: string
  poNumber: string | null
  supplier: string | null
  fileName: string | null
  status: POStatus
  createdAt: string
  confirmedAt: string | null
  hasInvoiceFile: boolean
  slip: ReceivingSlip | null
}

export type ReprintScope = 'PO_LABELS' | 'MC_UNIT_LABEL' | 'FG_OUTPUT_LABELS' | 'FG_UNIT_LABEL'
export type ReprintStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED'

export interface ReprintRequest {
  id: string
  scope: ReprintScope
  reason: string
  status: ReprintStatus
  requestedAt: string
  requestedBy?: { email: string; name: string | null } | null
  decidedBy?: { email: string; name: string | null } | null
  decidedAt: string | null
  decisionNote: string | null
  /** How many prints the factory Admin allowed, and how many are gone. */
  printsApproved: number
  printsUsed: number
  po?: { poNumber: string | null; supplier: string | null } | null
  material?: { uniqueId: string; materialName: string } | null
  output?: { productName: string; batch: { batchNumber: string } } | null
  finishedGood?: { uniqueId: string; productName: string } | null
}

/** The whole contract for one label set: has it been printed, and may it print now? */
export interface ReprintStatusView {
  alreadyPrinted: boolean
  mayPrint: boolean
  request: ReprintRequest | null
}
