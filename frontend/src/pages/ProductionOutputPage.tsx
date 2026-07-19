import { useCallback, useEffect, useState } from 'react'
import {
  FlaskConical,
  Plus,
  CheckCircle2,
  QrCode,
  AlertTriangle,
  Trash2,
  PackageCheck,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Batch, ProductionOutput } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { toast } from '@/hooks/useToast'
import { LabelRollFlow } from '@/components/labels/LabelRollFlow'

export function ProductionOutputPage() {
  const { user } = useAuth()
  const [batches, setBatches] = useState<Batch[]>([])
  const [outputs, setOutputs] = useState<ProductionOutput[]>([])
  const [showForm, setShowForm] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<ProductionOutput | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [b, o] = await Promise.all([
      api.get<Batch[]>('/batches?take=100').catch(() => []),
      api.get<ProductionOutput[]>('/production-outputs').catch(() => []),
    ])
    setBatches(b)
    setOutputs(o)
  }, [])
  useEffect(() => void load(), [load])

  const confirmOutput = async () => {
    if (!confirmTarget) return
    setBusy(true)
    try {
      await api.post(`/production-outputs/${confirmTarget.id}/confirm`)
      toast({ title: 'Output confirmed', description: 'You can now generate finished-goods QR codes.' })
      setConfirmTarget(null)
      await load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not confirm', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const generateQrs = async (o: ProductionOutput) => {
    setBusy(true)
    try {
      const res = await api.post<{ generated: number }>(`/finished-goods/generate/${o.id}`)
      toast({ title: `${res.generated} FG QR codes generated`, description: 'Open the label sheet to print.' })
      await load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not generate', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const deleteDraft = async (o: ProductionOutput) => {
    try {
      await api.del(`/production-outputs/${o.id}`)
      toast({ title: 'Draft deleted' })
      await load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not delete', description: err instanceof ApiError ? err.message : '' })
    }
  }

  if (user?.role !== 'PRODUCTION_HEAD') {
    return <EmptyState title="Production output" description="Only a production head can record output." />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Production output</h1>
        <Button onClick={() => setShowForm((s) => !s)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Record output
        </Button>
      </div>

      {showForm && (
        <OutputForm
          batches={batches}
          onSaved={async () => {
            setShowForm(false)
            await load()
          }}
        />
      )}

      {outputs.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No production output yet"
          description="Record what you produced for a batch, review it, then confirm to generate finished-goods QR codes."
        />
      ) : (
        <div className="space-y-3">
          {outputs.map((o) => (
            <Card key={o.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.productName}</span>
                    <Badge variant="outline">Batch {o.batch?.batchNumber}</Badge>
                    {o.confirmed ? (
                      <Badge className="bg-success text-success-foreground hover:bg-success">Confirmed</Badge>
                    ) : (
                      <Badge className="bg-amber-500 text-white hover:bg-amber-500">Draft — needs review</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {o.packageCount} × {o.sizePerPackage} {o.sizeUnit} ={' '}
                    <span className="font-medium text-foreground">
                      {round(o.packageCount * o.sizePerPackage)} {o.sizeUnit}
                    </span>{' '}
                    · {o.productionDate.slice(0, 10)}
                    {o.shade ? ` · shade ${o.shade}` : ''}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {!o.confirmed && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700">
                    <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
                    <span>
                      Review the details above. Nothing is final and no QR codes can be printed until you
                      confirm.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {!o.confirmed && (
                    <>
                      <Button size="sm" className="gap-1.5" onClick={() => setConfirmTarget(o)} disabled={busy}>
                        <CheckCircle2 className="h-4 w-4" /> Review &amp; confirm
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" onClick={() => deleteDraft(o)}>
                        <Trash2 className="h-4 w-4" /> Delete draft
                      </Button>
                    </>
                  )}
                  {o.confirmed && !o.fgGeneratedAt && (
                    <Button size="sm" className="gap-1.5" onClick={() => generateQrs(o)} disabled={busy}>
                      <QrCode className="h-4 w-4" /> Generate {o.packageCount} FG QR codes
                    </Button>
                  )}
                  {o.fgGeneratedAt && (
                    <span className="flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-1.5 text-sm text-success">
                      <PackageCheck className="h-4 w-4" /> {o._count?.finishedGoods ?? o.packageCount} FG units created
                    </span>
                  )}
                </div>

                {/* Explicit Generate → Save → Print for the FG label roll (item 4). */}
                {o.fgGeneratedAt && (
                  <LabelRollFlow
                    path={`/finished-goods/by-output/${o.id}/labels.pdf`}
                    fileName={`fg-labels-${o.batch?.batchNumber ?? o.id}.pdf`}
                    unitCount={o._count?.finishedGoods ?? o.packageCount}
                    label="FG label roll"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmationDialog
        open={!!confirmTarget}
        onOpenChange={(v) => !v && setConfirmTarget(null)}
        title="Confirm production output?"
        description={
          confirmTarget
            ? `${confirmTarget.productName} — ${confirmTarget.packageCount} × ${confirmTarget.sizePerPackage} ${confirmTarget.sizeUnit} for batch ${confirmTarget.batch?.batchNumber}. Once confirmed this record is locked and ${confirmTarget.packageCount} finished-goods QR codes can be generated.`
            : ''
        }
        confirmLabel="Confirm output"
        onConfirm={confirmOutput}
      />
    </div>
  )
}

const round = (n: number) => Math.round(n * 1000) / 1000


function OutputForm({ batches, onSaved }: { batches: Batch[]; onSaved: () => void }) {
  const [v, setV] = useState({
    batchId: '',
    productName: '',
    packageCount: '',
    sizePerPackage: '',
    sizeUnit: 'L',
    productionDate: new Date().toISOString().slice(0, 10),
    shade: '',
    productSku: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value })

  const selected = batches.find((b) => b.id === v.batchId)
  const total =
    Number(v.packageCount) > 0 && Number(v.sizePerPackage) > 0
      ? round(Number(v.packageCount) * Number(v.sizePerPackage))
      : null

  const submit = async () => {
    if (!v.batchId || !v.productName.trim() || !(Number(v.packageCount) > 0) || !(Number(v.sizePerPackage) > 0)) {
      toast({ variant: 'destructive', title: 'Fill batch, product, package count and size' })
      return
    }
    setBusy(true)
    try {
      const res = await api.post<{ warning: string | null }>('/production-outputs', {
        batchId: v.batchId,
        productName: v.productName.trim(),
        packageCount: Number(v.packageCount),
        sizePerPackage: Number(v.sizePerPackage),
        sizeUnit: v.sizeUnit,
        productionDate: new Date(v.productionDate).toISOString(),
        shade: v.shade.trim() || undefined,
        productSku: v.productSku.trim() || undefined,
        notes: v.notes.trim() || undefined,
      })
      toast({
        title: 'Output recorded as a draft',
        description: res.warning ?? 'Review it below, then confirm to generate QR codes.',
        variant: res.warning ? 'destructive' : undefined,
      })
      onSaved()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not record', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <FlaskConical className="h-4 w-4" /> Record what was produced
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>Batch *</Label>
            <select
              value={v.batchId}
              onChange={set('batchId')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select the batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} — {b.status.replace('_', ' ').toLowerCase()} ({b.totals.issuedKg} kg used)
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Product name *</Label>
            <Input value={v.productName} onChange={set('productName')} placeholder="e.g. PU Enamel White" />
          </div>
          <div className="space-y-1.5">
            <Label>Packages produced *</Label>
            <Input type="number" min={1} value={v.packageCount} onChange={set('packageCount')} placeholder="e.g. 50" />
          </div>
          <div className="space-y-1.5">
            <Label>Size per package *</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} step="any" value={v.sizePerPackage} onChange={set('sizePerPackage')} placeholder="20" />
              <select
                value={v.sizeUnit}
                onChange={set('sizeUnit')}
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="L">L</option>
                <option value="Kg">Kg</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Production date *</Label>
            <Input type="date" value={v.productionDate} onChange={set('productionDate')} />
          </div>
          <div className="space-y-1.5">
            <Label>Shade / colour</Label>
            <Input value={v.shade} onChange={set('shade')} placeholder="e.g. RAL 9010" />
          </div>
          <div className="space-y-1.5">
            <Label>Product SKU</Label>
            <Input value={v.productSku} onChange={set('productSku')} placeholder="optional" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label>Notes</Label>
            <Input value={v.notes} onChange={set('notes')} placeholder="optional" />
          </div>
        </div>

        {selected?.locked && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
            Batch {selected.batchNumber} is already confirmed. This will be recorded as an
            <b> additional</b> output for that batch.
          </p>
        )}

        {total !== null && (
          <p className="text-sm text-muted-foreground">
            Total volume: <span className="font-medium text-foreground">{total} {v.sizeUnit}</span> ·{' '}
            <span className="font-medium text-foreground">{v.packageCount}</span> QR codes will be generated
            after you confirm.
          </p>
        )}

        <Button onClick={submit} disabled={busy} className="gap-1.5">
          {busy ? 'Saving…' : 'Save as draft'}
        </Button>
      </CardContent>
    </Card>
  )
}
