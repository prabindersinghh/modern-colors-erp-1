import { useCallback, useState } from 'react'
import {
  generateQrLabels,
  saveMaterialInward,
  fetchRackOptions,
  fetchWarehouseOptions,
  fetchSupplierOptions,
  fetchMaterialOptions,
} from '@/services/materialService'
import type { GeneratedQrLabel, MaterialInwardForm } from '@/types'

const emptyForm: MaterialInwardForm = {
  materialName: '',
  sku: '',
  supplier: '',
  purchaseOrder: '',
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  weightPerBag: 25,
  numberOfBags: 1,
  warehouse: '',
  rack: '',
  remarks: '',
}

export function useMaterialInward() {
  const [form, setForm] = useState<MaterialInwardForm>(emptyForm)
  const [labels, setLabels] = useState<GeneratedQrLabel[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const updateField = useCallback(
    <K extends keyof MaterialInwardForm>(field: K, value: MaterialInwardForm[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      setSaved(false)
    },
    []
  )

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await generateQrLabels(form)
      setLabels(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate QR labels')
    } finally {
      setGenerating(false)
    }
  }, [form])

  const save = useCallback(async () => {
    if (labels.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await saveMaterialInward(form, labels)
      setSaved(true)
      setForm(emptyForm)
      setLabels([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save material inward')
    } finally {
      setSaving(false)
    }
  }, [form, labels])

  const reset = useCallback(() => {
    setForm(emptyForm)
    setLabels([])
    setError(null)
    setSaved(false)
  }, [])

  return {
    form,
    labels,
    generating,
    saving,
    error,
    saved,
    updateField,
    generate,
    save,
    reset,
    fetchMaterialOptions,
    fetchSupplierOptions,
    fetchWarehouseOptions,
    fetchRackOptions,
  }
}
