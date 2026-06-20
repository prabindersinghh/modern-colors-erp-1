import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MaterialInwardForm, SelectOption } from '@/types'

interface MaterialFormProps {
  form: MaterialInwardForm
  onChange: <K extends keyof MaterialInwardForm>(
    field: K,
    value: MaterialInwardForm[K]
  ) => void
  fetchMaterialOptions: () => Promise<SelectOption[]>
  fetchSupplierOptions: () => Promise<SelectOption[]>
  fetchWarehouseOptions: () => Promise<SelectOption[]>
  fetchRackOptions: (warehouseId: string) => Promise<SelectOption[]>
}

export function MaterialForm({
  form,
  onChange,
  fetchMaterialOptions,
  fetchSupplierOptions,
  fetchWarehouseOptions,
  fetchRackOptions,
}: MaterialFormProps) {
  const [materials, setMaterials] = useState<SelectOption[]>([])
  const [suppliers, setSuppliers] = useState<SelectOption[]>([])
  const [warehouses, setWarehouses] = useState<SelectOption[]>([])
  const [racks, setRacks] = useState<SelectOption[]>([])

  useEffect(() => {
    fetchMaterialOptions().then(setMaterials)
    fetchSupplierOptions().then(setSuppliers)
    fetchWarehouseOptions().then(setWarehouses)
  }, [fetchMaterialOptions, fetchSupplierOptions, fetchWarehouseOptions])

  useEffect(() => {
    if (form.warehouse) {
      fetchRackOptions(form.warehouse).then(setRacks)
    }
  }, [form.warehouse, fetchRackOptions])

  const handleMaterialSelect = (materialId: string) => {
    const material = materials.find((m) => m.value === materialId)
    if (material) {
      onChange('materialName', material.label)
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="material">Material Name *</Label>
        <Select
          value={materials.find((m) => m.label === form.materialName)?.value ?? ''}
          onValueChange={handleMaterialSelect}
        >
          <SelectTrigger id="material">
            <SelectValue placeholder="Select material" />
          </SelectTrigger>
          <SelectContent>
            {materials.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sku">SKU *</Label>
        <Input
          id="sku"
          value={form.sku}
          onChange={(e) => onChange('sku', e.target.value)}
          placeholder="RM-TIO2-001"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="supplier">Supplier *</Label>
        <Select
          value={suppliers.find((s) => s.label === form.supplier)?.value ?? ''}
          onValueChange={(v) => {
            const s = suppliers.find((sup) => sup.value === v)
            if (s) onChange('supplier', s.label)
          }}
        >
          <SelectTrigger id="supplier">
            <SelectValue placeholder="Select supplier" />
          </SelectTrigger>
          <SelectContent>
            {suppliers.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="po">Purchase Order</Label>
        <Input
          id="po"
          value={form.purchaseOrder}
          onChange={(e) => onChange('purchaseOrder', e.target.value)}
          placeholder="PO-2026-0142"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="batch">Batch Number *</Label>
        <Input
          id="batch"
          value={form.batchNumber}
          onChange={(e) => onChange('batchNumber', e.target.value)}
          placeholder="BATCH-2026-0620"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mfgDate">Manufacturing Date</Label>
        <Input
          id="mfgDate"
          type="date"
          value={form.manufacturingDate}
          onChange={(e) => onChange('manufacturingDate', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expDate">Expiry Date</Label>
        <Input
          id="expDate"
          type="date"
          value={form.expiryDate}
          onChange={(e) => onChange('expiryDate', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="weight">Weight per Bag (kg) *</Label>
        <Input
          id="weight"
          type="number"
          min={0}
          step={0.01}
          value={form.weightPerBag}
          onChange={(e) => onChange('weightPerBag', parseFloat(e.target.value) || 0)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bags">Number of Bags *</Label>
        <Input
          id="bags"
          type="number"
          min={1}
          value={form.numberOfBags}
          onChange={(e) => onChange('numberOfBags', parseInt(e.target.value, 10) || 1)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="warehouse">Warehouse *</Label>
        <Select
          value={form.warehouse}
          onValueChange={(v) => {
            onChange('warehouse', v)
            onChange('rack', '')
          }}
        >
          <SelectTrigger id="warehouse">
            <SelectValue placeholder="Select warehouse" />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rack">Rack *</Label>
        <Select
          value={form.rack}
          onValueChange={(v) => onChange('rack', v)}
          disabled={!form.warehouse}
        >
          <SelectTrigger id="rack">
            <SelectValue placeholder="Select rack" />
          </SelectTrigger>
          <SelectContent>
            {racks.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea
          id="remarks"
          value={form.remarks}
          onChange={(e) => onChange('remarks', e.target.value)}
          placeholder="Optional notes about this inward entry..."
          rows={2}
        />
      </div>
    </div>
  )
}
