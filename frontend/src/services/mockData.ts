import type {
  InventoryBag,
  Material,
  MaterialActivity,
  Rack,
  Supplier,
  Warehouse,
} from '@/types'

const warehouses: Warehouse[] = [
  { id: 'wh-1', name: 'Raw Material Store', code: 'RMS' },
  { id: 'wh-2', name: 'Pigment Store', code: 'PST' },
  { id: 'wh-3', name: 'Finished Goods', code: 'FGS' },
]

const racks: Rack[] = [
  { id: 'rack-a1', code: 'A1', warehouseId: 'wh-1', capacity: 50, occupied: 32 },
  { id: 'rack-a2', code: 'A2', warehouseId: 'wh-1', capacity: 50, occupied: 45 },
  { id: 'rack-a3', code: 'A3', warehouseId: 'wh-1', capacity: 50, occupied: 18 },
  { id: 'rack-b1', code: 'B1', warehouseId: 'wh-1', capacity: 50, occupied: 28 },
  { id: 'rack-b2', code: 'B2', warehouseId: 'wh-1', capacity: 50, occupied: 12 },
  { id: 'rack-b3', code: 'B3', warehouseId: 'wh-1', capacity: 50, occupied: 38 },
  { id: 'rack-p1', code: 'P1', warehouseId: 'wh-2', capacity: 40, occupied: 22 },
  { id: 'rack-p2', code: 'P2', warehouseId: 'wh-2', capacity: 40, occupied: 15 },
]

const suppliers: Supplier[] = [
  { id: 'sup-1', name: 'ChemCorp Industries', code: 'CCI' },
  { id: 'sup-2', name: 'Titan Pigments Ltd', code: 'TPL' },
  { id: 'sup-3', name: 'Global Resins Co.', code: 'GRC' },
  { id: 'sup-4', name: 'Mineral Supplies Inc', code: 'MSI' },
]

const materials: Material[] = [
  { id: 'mat-1', name: 'Titanium Dioxide', sku: 'RM-TIO2-001', unit: 'kg', minStock: 500 },
  { id: 'mat-2', name: 'Calcium Carbonate', sku: 'RM-CACO3-002', unit: 'kg', minStock: 1000 },
  { id: 'mat-3', name: 'Acrylic Resin', sku: 'RM-ACR-003', unit: 'kg', minStock: 300 },
  { id: 'mat-4', name: 'Iron Oxide Red', sku: 'RM-FE2O3-004', unit: 'kg', minStock: 200 },
  { id: 'mat-5', name: 'Dispersing Agent', sku: 'RM-DSP-005', unit: 'kg', minStock: 100 },
]

const today = new Date()
const daysAgo = (n: number) => {
  const d = new Date(today)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

let bagCounter = 48

const createBag = (
  overrides: Partial<InventoryBag> & Pick<InventoryBag, 'qrId' | 'materialName' | 'sku' | 'materialId'>
): InventoryBag => {
  bagCounter += 1
  const warehouse = warehouses[0]
  const rack = racks[Math.floor(Math.random() * 6)]
  const supplier = suppliers[Math.floor(Math.random() * suppliers.length)]
  const weight = overrides.originalWeight ?? 25

  return {
    id: `bag-${bagCounter}`,
    supplierId: supplier.id,
    supplierName: supplier.name,
    originalWeight: weight,
    remainingWeight: overrides.remainingWeight ?? weight,
    warehouseId: warehouse.id,
    warehouseName: warehouse.name,
    rackId: rack.id,
    rackCode: rack.code,
    status: 'available',
    batchNumber: 'BATCH-2026-0615',
    purchaseOrder: 'PO-2026-0142',
    manufacturingDate: daysAgo(30),
    expiryDate: daysAgo(-365),
    receivedAt: daysAgo(5),
    ...overrides,
  }
}

let inventoryBags: InventoryBag[] = [
  createBag({
    qrId: 'RM-TIO2-20260615-0001',
    materialId: 'mat-1',
    materialName: 'Titanium Dioxide',
    sku: 'RM-TIO2-001',
    supplierId: 'sup-2',
    supplierName: 'Titan Pigments Ltd',
    rackId: 'rack-a1',
    rackCode: 'A1',
    originalWeight: 25,
    remainingWeight: 25,
  }),
  createBag({
    qrId: 'RM-TIO2-20260615-0002',
    materialId: 'mat-1',
    materialName: 'Titanium Dioxide',
    sku: 'RM-TIO2-001',
    supplierId: 'sup-2',
    supplierName: 'Titan Pigments Ltd',
    rackId: 'rack-a1',
    rackCode: 'A1',
    originalWeight: 25,
    remainingWeight: 18.5,
    status: 'issued',
  }),
  createBag({
    qrId: 'RM-CACO3-20260610-0001',
    materialId: 'mat-2',
    materialName: 'Calcium Carbonate',
    sku: 'RM-CACO3-002',
    supplierId: 'sup-4',
    supplierName: 'Mineral Supplies Inc',
    rackId: 'rack-a2',
    rackCode: 'A2',
    originalWeight: 50,
    remainingWeight: 50,
  }),
  createBag({
    qrId: 'RM-ACR-20260608-0001',
    materialId: 'mat-3',
    materialName: 'Acrylic Resin',
    sku: 'RM-ACR-003',
    supplierId: 'sup-3',
    supplierName: 'Global Resins Co.',
    rackId: 'rack-b1',
    rackCode: 'B1',
    originalWeight: 200,
    remainingWeight: 145,
    status: 'issued',
  }),
  createBag({
    qrId: 'RM-FE2O3-20260605-0001',
    materialId: 'mat-4',
    materialName: 'Iron Oxide Red',
    sku: 'RM-FE2O3-004',
    supplierId: 'sup-1',
    supplierName: 'ChemCorp Industries',
    rackId: 'rack-b3',
    rackCode: 'B3',
    originalWeight: 25,
    remainingWeight: 8,
    status: 'available',
  }),
  createBag({
    qrId: 'RM-DSP-20260601-0001',
    materialId: 'mat-5',
    materialName: 'Dispersing Agent',
    sku: 'RM-DSP-005',
    supplierId: 'sup-1',
    supplierName: 'ChemCorp Industries',
    rackId: 'rack-a3',
    rackCode: 'A3',
    originalWeight: 20,
    remainingWeight: 5,
    status: 'available',
  }),
]

const activities: MaterialActivity[] = [
  {
    id: 'act-1',
    type: 'inward',
    materialName: 'Titanium Dioxide',
    qrId: 'RM-TIO2-20260615-0001',
    quantity: 25,
    unit: 'kg',
    user: 'Rajesh Kumar',
    timestamp: daysAgo(0),
    description: 'Received 12 bags from Titan Pigments Ltd',
  },
  {
    id: 'act-2',
    type: 'issue',
    materialName: 'Acrylic Resin',
    qrId: 'RM-ACR-20260608-0001',
    quantity: 55,
    unit: 'kg',
    user: 'Priya Sharma',
    timestamp: daysAgo(0),
    description: 'Issued for Production Batch PB-2026-042',
  },
  {
    id: 'act-3',
    type: 'move',
    materialName: 'Calcium Carbonate',
    qrId: 'RM-CACO3-20260610-0001',
    quantity: 50,
    unit: 'kg',
    user: 'Amit Patel',
    timestamp: daysAgo(1),
    description: 'Moved from A1 to A2',
  },
  {
    id: 'act-4',
    type: 'production',
    materialName: 'Iron Oxide Red',
    quantity: 500,
    unit: 'L',
    user: 'Suresh Reddy',
    timestamp: daysAgo(1),
    description: 'Production completed - Premium Red 500L',
  },
  {
    id: 'act-5',
    type: 'inward',
    materialName: 'Dispersing Agent',
    qrId: 'RM-DSP-20260601-0001',
    quantity: 20,
    unit: 'kg',
    user: 'Rajesh Kumar',
    timestamp: daysAgo(2),
    description: 'Received 8 bags from ChemCorp Industries',
  },
]

export const mockDb = {
  warehouses,
  racks,
  suppliers,
  materials,
  get inventoryBags() {
    return inventoryBags
  },
  set inventoryBags(value: InventoryBag[]) {
    inventoryBags = value
  },
  get activities() {
    return activities
  },
  addActivity(activity: MaterialActivity) {
    activities.unshift(activity)
  },
  addBags(bags: InventoryBag[]) {
    inventoryBags = [...bags, ...inventoryBags]
  },
}
