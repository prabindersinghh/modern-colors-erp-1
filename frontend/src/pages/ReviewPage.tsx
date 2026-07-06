import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Sparkles, Trash2, Plus, CheckCircle2, ClipboardCheck, FileText } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Paginated, PurchaseOrder, POLineItem, MatchType } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'

const MATCH: Record<MatchType, { label: string; cls: string }> = {
  EXACT: { label: 'Exact', cls: 'bg-success/15 text-success border-success/30' },
  SIMILAR: { label: 'Similar', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  NONE: { label: 'No match', cls: 'bg-muted text-muted-foreground' },
}

export function ReviewPage() {
  const { poId } = useParams()
  if (!poId) return <ReviewPicker />
  return <ReviewOne poId={poId} />
}

function ReviewPicker() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  useEffect(() => {
    api.get<Paginated<PurchaseOrder>>('/purchase-orders?pageSize=50').then((r) =>
      setPos(r.data.filter((p) => p.status === 'PO_UPLOADED' || p.status === 'AI_EXTRACTED')),
    )
  }, [])
  if (pos.length === 0)
    return <EmptyState icon={ClipboardCheck} title="Nothing to review" description="Upload an invoice to begin." />
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Invoices awaiting review:</p>
      {pos.map((p) => (
        <Link
          key={p.id}
          to={`/review/${p.id}`}
          className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
        >
          <span>
            <span className="font-medium">{p.poNumber ?? p.fileName ?? p.id.slice(0, 8)}</span>
            <span className="ml-2 text-muted-foreground">{p.supplier ?? ''}</span>
          </span>
          <Badge variant="outline">{p.status === 'AI_EXTRACTED' ? 'Needs review' : 'Uploaded'}</Badge>
        </Link>
      ))}
    </div>
  )
}

/** The uploaded invoice document (image or PDF) rendered for visual verification (item 3). */
function PoDocumentPreview({ poId }: { poId: string }) {
  const [state, setState] = useState<{ url: string; isPdf: boolean } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl = ''
    api
      .fetchBlobUrl(`/purchase-orders/${poId}/file`)
      .then(({ url, contentType }) => {
        objectUrl = url
        if (active) setState({ url, isPdf: contentType.includes('pdf') })
        else URL.revokeObjectURL(url)
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [poId])

  if (failed) return null // manual invoice / no file — nothing to preview
  return (
    <Card className="xl:sticky xl:top-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <FileText className="h-4 w-4" /> Uploaded document
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!state ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Loading document…
          </div>
        ) : state.isPdf ? (
          <iframe title="Invoice document" src={state.url} className="h-[60vh] w-full rounded border" />
        ) : (
          <img
            src={state.url}
            alt="Invoice"
            className="max-h-[70vh] w-full rounded border object-contain"
          />
        )}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Compare the extracted rows against this document before confirming.
        </p>
      </CardContent>
    </Card>
  )
}

function ReviewOne({ poId }: { poId: string }) {
  const nav = useNavigate()
  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(
    () => api.get<PurchaseOrder>(`/purchase-orders/${poId}`).then(setPo).catch(() => {}),
    [poId],
  )
  useEffect(() => void load(), [load])

  const runExtract = async () => {
    setBusy(true)
    try {
      const res = await api.post<{ fallback: boolean; reason?: string; message?: string }>(
        `/purchase-orders/${poId}/extract`,
      )
      if (res.fallback) {
        toast({
          variant: 'destructive',
          title: 'Invoice extraction unavailable',
          description: `${res.message ?? 'Enter the invoice manually below.'}`,
        })
      } else {
        toast({ title: 'Extracted', description: 'Review the materials below before confirming.' })
      }
      await load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Extraction error', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await api.post<{ registeredUnits: number }>(`/purchase-orders/${poId}/confirm`)
      toast({ title: 'Confirmed', description: `${res.registeredUnits} units registered with QR codes.` })
      nav(`/labels?poId=${poId}`)
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not confirm', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  if (!po) return <p className="text-sm text-muted-foreground">Loading…</p>

  const totalUnits = (po.lineItems ?? []).reduce((n, li) => n + li.quantity, 0)
  const editable = po.status === 'AI_EXTRACTED'
  const hasDocument = Boolean(po.fileName)
  const largeCount = totalUnits > 300

  const workingArea = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span>{po.poNumber ?? po.fileName ?? 'Invoice'}</span>
            <Badge variant="outline">{po.status.replace(/_/g, ' ')}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <span><span className="text-muted-foreground">Supplier:</span> {po.supplier ?? '—'}</span>
          <span><span className="text-muted-foreground">Source:</span> {po.source}</span>
          <span><span className="text-muted-foreground">Units:</span> {totalUnits}</span>
        </CardContent>
      </Card>

      {po.status === 'PO_UPLOADED' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={runExtract} disabled={busy} className="gap-1.5">
            <Sparkles className="h-4 w-4" /> {busy ? 'Extracting…' : 'Run AI extraction'}
          </Button>
          <ManualEntry poId={poId} onSaved={load} />
        </div>
      )}

      {(po.status === 'AI_EXTRACTED' || po.lineItems?.length) ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">S.No</TableHead>
                  <TableHead className="min-w-[200px]">Material</TableHead>
                  <TableHead className="w-28">HSN Code</TableHead>
                  <TableHead className="w-28">SKU</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-24">Weight</TableHead>
                  <TableHead>Match</TableHead>
                  {editable && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(po.lineItems ?? []).map((li, i) => (
                  <LineRow key={li.id} poId={poId} item={li} index={i} editable={editable} onChange={load} />
                ))}
                {(po.lineItems ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No materials yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {editable && (
            <>
              <AddLine poId={poId} onAdded={load} />
              {largeCount && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                  This invoice will create <span className="font-semibold">{totalUnits}</span> QR codes.
                  Double-check the <span className="font-semibold">Qty</span> column reflects the
                  number of physical bags/drums (not the total weight in Kg).
                </p>
              )}
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
                <p className="text-sm">
                  <span className="font-medium">{totalUnits}</span> physical units will be registered
                  with one QR code each.
                </p>
                <Button onClick={() => setConfirmOpen(true)} disabled={busy || totalUnits === 0} className="gap-1.5">
                  <CheckCircle2 className="h-4 w-4" /> Confirm &amp; register
                </Button>
              </div>
            </>
          )}

          {po.status === 'REGISTERED' && (
            <Button variant="outline" onClick={() => nav(`/labels?poId=${poId}`)}>
              View QR labels
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {hasDocument ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <PoDocumentPreview poId={poId} />
          {workingArea}
        </div>
      ) : (
        workingArea
      )}

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm and register materials?"
        description={`This will create ${totalUnits} material records (one per physical unit) with QR codes. This cannot be undone.`}
        confirmLabel="Confirm"
        onConfirm={confirm}
      />
    </>
  )
}

function LineRow({
  poId,
  item,
  index,
  editable,
  onChange,
}: {
  poId: string
  item: POLineItem
  index: number
  editable: boolean
  onChange: () => void
}) {
  const [v, setV] = useState({
    materialName: item.materialName,
    hsnCode: item.hsnCode ?? '',
    sku: item.sku ?? '',
    quantity: String(item.quantity),
    unit: item.unit ?? '',
    weight: item.weight != null ? String(item.weight) : '',
  })
  const [dirty, setDirty] = useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value })
    setDirty(true)
  }

  const save = async () => {
    try {
      await api.patch(`/purchase-orders/${poId}/line-items/${item.id}`, {
        materialName: v.materialName,
        hsnCode: v.hsnCode || undefined,
        sku: v.sku || undefined,
        quantity: Number(v.quantity) || 1,
        unit: v.unit || undefined,
        weight: v.weight.trim() ? Number(v.weight) : undefined,
      })
      setDirty(false)
      onChange()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Update failed', description: err instanceof ApiError ? err.message : '' })
    }
  }

  const remove = async () => {
    await api.del(`/purchase-orders/${poId}/line-items/${item.id}`)
    onChange()
  }

  const m = MATCH[item.matchType]
  if (!editable) {
    return (
      <TableRow>
        <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
        <TableCell className="whitespace-normal break-words font-medium">{item.materialName}</TableCell>
        <TableCell className="font-mono text-xs">{item.hsnCode ?? '—'}</TableCell>
        <TableCell className="font-mono text-xs">{item.sku ?? '—'}</TableCell>
        <TableCell>{item.quantity}</TableCell>
        <TableCell>{item.unit ?? '—'}</TableCell>
        <TableCell>{item.weight != null ? item.weight : '—'}</TableCell>
        <TableCell><span className={`rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span></TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
      <TableCell><Input value={v.materialName} onChange={set('materialName')} className="h-8 min-w-[190px]" /></TableCell>
      <TableCell><Input value={v.hsnCode} onChange={set('hsnCode')} placeholder="HSN" className="h-8 w-24 font-mono" /></TableCell>
      <TableCell><Input value={v.sku} onChange={set('sku')} className="h-8 w-24" /></TableCell>
      <TableCell><Input type="number" min={1} value={v.quantity} onChange={set('quantity')} className="h-8 w-16" /></TableCell>
      <TableCell><Input value={v.unit} onChange={set('unit')} className="h-8 w-20" /></TableCell>
      <TableCell><Input type="number" min={0} step="any" value={v.weight} onChange={set('weight')} placeholder="Kg" className="h-8 w-20" /></TableCell>
      <TableCell><span className={`rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span></TableCell>
      <TableCell>
        <div className="flex gap-1">
          {dirty && <Button size="sm" variant="outline" className="h-7" onClick={save}>Save</Button>}
          <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function AddLine({ poId, onAdded }: { poId: string; onAdded: () => void }) {
  const [v, setV] = useState({ materialName: '', hsnCode: '', sku: '', quantity: '1', unit: '', weight: '' })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })
  const add = async () => {
    if (!v.materialName.trim()) return
    await api.post(`/purchase-orders/${poId}/line-items`, {
      materialName: v.materialName.trim(),
      hsnCode: v.hsnCode || undefined,
      sku: v.sku || undefined,
      quantity: Number(v.quantity) || 1,
      unit: v.unit || undefined,
      weight: v.weight.trim() ? Number(v.weight) : undefined,
    })
    setV({ materialName: '', hsnCode: '', sku: '', quantity: '1', unit: '', weight: '' })
    onAdded()
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <Input placeholder="Material name" value={v.materialName} onChange={set('materialName')} className="h-8 w-44" />
      <Input placeholder="HSN" value={v.hsnCode} onChange={set('hsnCode')} className="h-8 w-24 font-mono" />
      <Input placeholder="SKU" value={v.sku} onChange={set('sku')} className="h-8 w-24" />
      <Input type="number" min={1} placeholder="Qty" value={v.quantity} onChange={set('quantity')} className="h-8 w-16" />
      <Input placeholder="Unit" value={v.unit} onChange={set('unit')} className="h-8 w-20" />
      <Input type="number" min={0} step="any" placeholder="Weight" value={v.weight} onChange={set('weight')} className="h-8 w-24" />
      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={add}>
        <Plus className="h-4 w-4" /> Add
      </Button>
    </div>
  )
}

function ManualEntry({ poId, onSaved }: { poId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const submit = async () => {
    // Seed the working set with one empty line; operator edits it on the review table.
    await api.post(`/purchase-orders/${poId}/manual`, {
      lineItems: [{ materialName: 'New material', quantity: 1 }],
    })
    setOpen(false)
    onSaved()
  }
  return open ? (
    <Button variant="outline" onClick={submit}>Start manual entry</Button>
  ) : (
    <Button variant="ghost" onClick={() => setOpen(true)}>Enter manually instead</Button>
  )
}
