import { QrCode, Printer, Save, Eye } from 'lucide-react'
import { useMaterialInward } from '@/hooks/useMaterialInward'
import { MaterialForm } from '@/components/material/MaterialForm'
import { QRLabelPreview } from '@/components/material/QRLabelPreview'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/useToast'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

export function MaterialInwardPage() {
  const {
    form,
    labels,
    generating,
    saving,
    error,
    saved,
    updateField,
    generate,
    save,
    fetchMaterialOptions,
    fetchSupplierOptions,
    fetchWarehouseOptions,
    fetchRackOptions,
  } = useMaterialInward()

  const handleGenerate = async () => {
    if (!form.materialName || !form.sku || !form.batchNumber) {
      toast({ title: 'Validation Error', description: 'Please fill required fields.', variant: 'destructive' })
      return
    }
    await generate()
    toast({ title: 'QR Labels Generated', description: `${form.numberOfBags} labels ready for preview.` })
  }

  const handleSave = async () => {
    await save()
    toast({ title: 'Saved to Inventory', description: 'Material inward entry recorded successfully.', variant: 'success' })
  }

  const handlePrint = () => {
    window.print()
    toast({ title: 'Print Dialog', description: 'Use browser print to output QR labels.' })
  }

  const isFormValid =
    form.materialName &&
    form.sku &&
    form.supplier &&
    form.batchNumber &&
    form.warehouse &&
    form.rack &&
    form.weightPerBag > 0 &&
    form.numberOfBags > 0

  return (
    <div className="space-y-6">
      {saved && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          Material inward saved successfully. Inventory has been updated.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Receive Material</CardTitle>
        </CardHeader>
        <CardContent>
          {generating ? (
            <LoadingSkeleton variant="form" />
          ) : (
            <MaterialForm
              form={form}
              onChange={updateField}
              fetchMaterialOptions={fetchMaterialOptions}
              fetchSupplierOptions={fetchSupplierOptions}
              fetchWarehouseOptions={fetchWarehouseOptions}
              fetchRackOptions={fetchRackOptions}
            />
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={handleGenerate} disabled={!isFormValid || generating} className="gap-2">
              <QrCode className="h-4 w-4" />
              Generate QR
            </Button>
            <Button
              variant="outline"
              disabled={labels.length === 0}
              className="gap-2"
              onClick={() => document.getElementById('qr-preview')?.scrollIntoView({ behavior: 'smooth' })}
            >
              <Eye className="h-4 w-4" />
              Preview
            </Button>
            <Button variant="outline" disabled={labels.length === 0} onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <Button
              variant="secondary"
              disabled={labels.length === 0 || saving}
              onClick={handleSave}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div id="qr-preview">
        {labels.length > 0 && <QRLabelPreview labels={labels} />}
      </div>
    </div>
  )
}
