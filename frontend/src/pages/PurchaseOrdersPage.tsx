import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Camera, Upload, Keyboard, Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Paginated, PurchaseOrder, POStatus } from '@/types/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { DocumentCamera } from '@/components/scan/DocumentCamera'
import { toast } from '@/hooks/useToast'

const STATUS_STYLE: Record<POStatus, { label: string; variant?: 'default' | 'secondary' | 'outline' }> = {
  PO_UPLOADED: { label: 'Uploaded', variant: 'secondary' },
  AI_EXTRACTED: { label: 'Needs review', variant: 'outline' },
  OPERATOR_VERIFIED: { label: 'Verified', variant: 'default' },
  REGISTERED: { label: 'Registered', variant: 'default' },
}

type Mode = 'document' | 'manual'

export function PurchaseOrdersPage() {
  const nav = useNavigate()
  const { hasRole } = useAuth()
  const canUpload = hasRole('ADMIN', 'OPERATOR')
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [mode, setMode] = useState<Mode>('document')
  const [uploading, setUploading] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = () =>
    api.get<Paginated<PurchaseOrder>>('/purchase-orders?pageSize=50').then((r) => setPos(r.data)).catch(() => {})
  useEffect(() => void load(), [])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const po = await api.postForm<PurchaseOrder>('/purchase-orders', form)
      toast({ title: 'Invoice uploaded', description: 'Run extraction or enter details on the review screen.' })
      nav(`/review/${po.id}`)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      {canUpload && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            {/* Option A vs Option B */}
            <div className="flex gap-2">
              <Button
                variant={mode === 'document' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setMode('document')}
              >
                <Camera className="h-4 w-4" /> Upload document
              </Button>
              <Button
                variant={mode === 'manual' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setMode('manual')}
              >
                <Keyboard className="h-4 w-4" /> Enter manually
              </Button>
            </div>

            {mode === 'manual' ? (
              <ManualPoForm />
            ) : cameraOpen ? (
              <ErrorBoundary
                fallback={
                  <div className="space-y-3 text-center">
                    <p className="text-sm text-muted-foreground">
                      Camera unavailable on this device — use “Choose file” instead.
                    </p>
                    <Button variant="outline" onClick={() => setCameraOpen(false)}>
                      Back
                    </Button>
                  </div>
                }
              >
                <DocumentCamera
                  onClose={() => setCameraOpen(false)}
                  onCapture={(file) => {
                    setCameraOpen(false)
                    upload(file)
                  }}
                />
              </ErrorBoundary>
            ) : (
              <>
                {/* PRIMARY: photograph the document */}
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="rounded-full bg-primary/10 p-3">
                    <Camera className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Scan the invoice</p>
                    <p className="text-xs text-muted-foreground">
                      Point your camera at the paper invoice and capture it
                    </p>
                  </div>
                  <Button size="lg" className="gap-2" onClick={() => setCameraOpen(true)} disabled={uploading}>
                    <Camera className="h-4 w-4" /> Open camera
                  </Button>
                </div>

                {/* SECONDARY: file upload (PDF / existing scan / saved image) */}
                <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                </div>
                <div
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f) upload(f)
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    Upload a PDF, existing scan, or saved image
                  </p>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) upload(f)
                      e.target.value = ''
                    }}
                  />
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Choose file'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Recent invoices</h2>
        {pos.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices yet" />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => {
                  const s = STATUS_STYLE[po.status]
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.poNumber ?? '—'}</TableCell>
                      <TableCell>{po.supplier ?? '—'}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                        {po.fileName ?? '(manual)'}
                      </TableCell>
                      <TableCell>{po._count?.lineItems ?? 0}</TableCell>
                      <TableCell>{po._count?.materials ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            nav(po.status === 'REGISTERED' ? `/labels?poId=${po.id}` : `/review/${po.id}`)
                          }
                        >
                          {po.status === 'REGISTERED' ? 'Labels' : 'Open'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

interface ManualLine {
  materialName: string
  hsnCode: string
  sku: string
  quantity: string
  unit: string
  weight: string
}

const BLANK_LINE: ManualLine = { materialName: '', hsnCode: '', sku: '', quantity: '1', unit: '', weight: '' }

/** Option B — type an invoice by hand (no document). Goes through the same review gate. */
function ManualPoForm() {
  const nav = useNavigate()
  const [poNumber, setPoNumber] = useState('')
  const [supplier, setSupplier] = useState('')
  const [lines, setLines] = useState<ManualLine[]>([{ ...BLANK_LINE }])
  const [busy, setBusy] = useState(false)

  const setLine = (i: number, k: keyof ManualLine) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [k]: e.target.value } : l)))
  const addLine = () => setLines((prev) => [...prev, { ...BLANK_LINE }])
  const removeLine = (i: number) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))

  const valid = lines.some((l) => l.materialName.trim())

  const submit = async () => {
    const lineItems = lines
      .filter((l) => l.materialName.trim())
      .map((l) => ({
        materialName: l.materialName.trim(),
        hsnCode: l.hsnCode.trim() || undefined,
        sku: l.sku.trim() || undefined,
        quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
        unit: l.unit.trim() || undefined,
        weight: l.weight.trim() ? Number(l.weight) : undefined,
      }))
    if (lineItems.length === 0) return
    setBusy(true)
    try {
      const po = await api.post<PurchaseOrder>('/purchase-orders/manual', {
        poNumber: poNumber.trim() || undefined,
        supplier: supplier.trim() || undefined,
        lineItems,
      })
      toast({ title: 'Invoice created', description: 'Review the details, then confirm to register.' })
      nav(`/review/${po.id}`)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not create invoice',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="poNumber">Invoice number</Label>
          <Input id="poNumber" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="e.g. PKD/26-27/120" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supplier">Supplier</Label>
          <Input id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. P.K. Dyes & Chemicals" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Material line items</Label>
        <p className="text-xs text-muted-foreground">
          Quantity = number of physical bags/drums (one QR each). Weight = per-package weight in Kg.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="min-w-[160px]">Material *</TableHead>
                <TableHead className="w-24">HSN Code</TableHead>
                <TableHead className="w-24">SKU</TableHead>
                <TableHead className="w-16">Qty</TableHead>
                <TableHead className="w-20">Unit</TableHead>
                <TableHead className="w-20">Weight</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell><Input value={l.materialName} onChange={setLine(i, 'materialName')} className="h-8 min-w-[150px]" /></TableCell>
                  <TableCell><Input value={l.hsnCode} onChange={setLine(i, 'hsnCode')} className="h-8 w-20 font-mono" /></TableCell>
                  <TableCell><Input value={l.sku} onChange={setLine(i, 'sku')} className="h-8 w-20" /></TableCell>
                  <TableCell><Input type="number" min={1} value={l.quantity} onChange={setLine(i, 'quantity')} className="h-8 w-14" /></TableCell>
                  <TableCell><Input value={l.unit} onChange={setLine(i, 'unit')} placeholder="Bag" className="h-8 w-16" /></TableCell>
                  <TableCell><Input type="number" min={0} step="any" value={l.weight} onChange={setLine(i, 'weight')} className="h-8 w-16" /></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => removeLine(i)} disabled={lines.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button size="sm" variant="outline" className="gap-1" onClick={addLine}>
          <Plus className="h-4 w-4" /> Add line
        </Button>
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || !valid} className="gap-1.5">
          {busy ? 'Creating…' : 'Create invoice & review'}
        </Button>
      </div>
    </div>
  )
}
