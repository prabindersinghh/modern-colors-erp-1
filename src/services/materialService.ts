import { generateQrId, getMaterialCode } from '@/lib/utils'
import { mockRequest } from './api'
import { mockDb } from './mockData'
import type {
  GeneratedQrLabel,
  InventoryBag,
  MaterialInwardForm,
  SelectOption,
} from '@/types'

export async function fetchMaterialOptions(): Promise<SelectOption[]> {
  return mockRequest(() =>
    mockDb.materials.map((m) => ({ label: m.name, value: m.id }))
  )
}

export async function fetchSupplierOptions(): Promise<SelectOption[]> {
  return mockRequest(() =>
    mockDb.suppliers.map((s) => ({ label: s.name, value: s.id }))
  )
}

export async function fetchWarehouseOptions(): Promise<SelectOption[]> {
  return mockRequest(() =>
    mockDb.warehouses.map((w) => ({ label: w.name, value: w.id }))
  )
}

export async function fetchRackOptions(warehouseId: string): Promise<SelectOption[]> {
  return mockRequest(() =>
    mockDb.racks
      .filter((r) => r.warehouseId === warehouseId)
      .map((r) => ({ label: r.code, value: r.id }))
  )
}

export async function generateQrLabels(
  form: MaterialInwardForm
): Promise<GeneratedQrLabel[]> {
  return mockRequest(() => {
    const materialCode = getMaterialCode(form.materialName)
    const date = new Date()
    const existingCount = mockDb.inventoryBags.filter((b) =>
      b.qrId.includes(materialCode)
    ).length

    return Array.from({ length: form.numberOfBags }, (_, i) => ({
      qrId: generateQrId(materialCode, date, existingCount + i + 1),
      materialName: form.materialName,
      bagNumber: i + 1,
      weight: form.weightPerBag,
      status: 'available' as const,
      batchNumber: form.batchNumber,
      sku: form.sku,
      supplier: form.supplier,
      warehouse: form.warehouse,
      rack: form.rack,
    }))
  }, { delayMs: 600 })
}

export async function saveMaterialInward(
  form: MaterialInwardForm,
  labels: GeneratedQrLabel[]
): Promise<InventoryBag[]> {
  return mockRequest(() => {
    const warehouse = mockDb.warehouses.find((w) => w.name === form.warehouse || w.id === form.warehouse)
    const rack = mockDb.racks.find((r) => r.code === form.rack || r.id === form.rack)
    const supplier = mockDb.suppliers.find((s) => s.name === form.supplier || s.id === form.supplier)
    const material = mockDb.materials.find((m) => m.name === form.materialName || m.sku === form.sku)

    const bags: InventoryBag[] = labels.map((label, i) => ({
      id: `bag-new-${Date.now()}-${i}`,
      qrId: label.qrId,
      materialId: material?.id ?? `mat-custom-${Date.now()}`,
      materialName: form.materialName,
      sku: form.sku,
      supplierId: supplier?.id ?? 'sup-unknown',
      supplierName: supplier?.name ?? form.supplier,
      originalWeight: form.weightPerBag,
      remainingWeight: form.weightPerBag,
      warehouseId: warehouse?.id ?? 'wh-1',
      warehouseName: warehouse?.name ?? form.warehouse,
      rackId: rack?.id ?? 'rack-a1',
      rackCode: rack?.code ?? form.rack,
      status: 'available',
      batchNumber: form.batchNumber,
      purchaseOrder: form.purchaseOrder,
      manufacturingDate: form.manufacturingDate,
      expiryDate: form.expiryDate,
      receivedAt: new Date().toISOString(),
      remarks: form.remarks,
    }))

    mockDb.addBags(bags)
    mockDb.addActivity({
      id: `act-${Date.now()}`,
      type: 'inward',
      materialName: form.materialName,
      quantity: form.weightPerBag * form.numberOfBags,
      unit: 'kg',
      user: 'Current User',
      timestamp: new Date().toISOString(),
      description: `Received ${form.numberOfBags} bags - Batch ${form.batchNumber}`,
    })

    return bags
  }, { delayMs: 800 })
}
