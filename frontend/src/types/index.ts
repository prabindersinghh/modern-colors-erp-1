export type BagStatus =
  | 'available'
  | 'reserved'
  | 'issued'
  | 'consumed'
  | 'expired'
  | 'quarantine'

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

export interface Warehouse {
  id: string
  name: string
  code: string
}

export interface Rack {
  id: string
  code: string
  warehouseId: string
  capacity: number
  occupied: number
}

export interface Supplier {
  id: string
  name: string
  code: string
}

export interface Material {
  id: string
  name: string
  sku: string
  unit: string
  minStock: number
}

export interface InventoryBag {
  id: string
  qrId: string
  materialId: string
  materialName: string
  sku: string
  supplierId: string
  supplierName: string
  originalWeight: number
  remainingWeight: number
  warehouseId: string
  warehouseName: string
  rackId: string
  rackCode: string
  status: BagStatus
  batchNumber: string
  purchaseOrder?: string
  manufacturingDate: string
  expiryDate: string
  receivedAt: string
  remarks?: string
}

export interface MaterialInwardForm {
  materialName: string
  sku: string
  supplier: string
  purchaseOrder: string
  batchNumber: string
  manufacturingDate: string
  expiryDate: string
  weightPerBag: number
  numberOfBags: number
  warehouse: string
  rack: string
  remarks: string
}

export interface GeneratedQrLabel {
  qrId: string
  materialName: string
  bagNumber: number
  weight: number
  status: BagStatus
  batchNumber: string
  sku: string
  supplier: string
  warehouse: string
  rack: string
}

export interface MaterialActivity {
  id: string
  type: 'inward' | 'issue' | 'move' | 'production' | 'adjustment'
  materialName: string
  qrId?: string
  quantity: number
  unit: string
  user: string
  timestamp: string
  description: string
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

export interface InventoryTrendPoint {
  date: string
  totalBags: number
  totalWeight: number
  inward: number
  issued: number
}

export interface LowStockAlert {
  id: string
  materialName: string
  sku: string
  currentStock: number
  minStock: number
  unit: string
  severity: 'critical' | 'warning'
}

export interface ProductionOrderItem {
  id: string
  batchNumber: string
  paintType: string
  supervisor: string
  targetQuantity: number
  date: string
  status: 'planned' | 'in_progress' | 'completed'
  consumedBags: ProductionConsumedBag[]
}

export interface ProductionConsumedBag {
  bagId: string
  qrId: string
  materialName: string
  originalWeight: number
  consumedWeight: number
  remainingWeight: number
}

export interface QrScanResult {
  bag: InventoryBag
  history: MaterialActivity[]
}

export interface ReportFilter {
  startDate?: string
  endDate?: string
  materialId?: string
  supplierId?: string
  warehouseId?: string
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'error' | 'success'
  read: boolean
  timestamp: string
}
