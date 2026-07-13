import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Sparkles, Trash2, Plus, CheckCircle2, ClipboardCheck, FileText, BookMarked } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Paginated, PurchaseOrder, POLineItem, MatchType } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'

const MATCH: Record<MatchType, { label: string; cls: string }> = {
  EXACT: { label: 'Exact', cls: 'bg-success/15 text-success border-success/30' },
  SIMILAR: { label: 'Similar', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  NONE: { label: 'No match', cls: 'bg-muted text-muted-foreground' },
}

// Bulk measures — a line with one of these units is a WEIGHT/VOLUME total, so its
// quantity is NOT a real bag count yet. Mirrors the server-side extraction guard.
const BULK_UNITS = new Set([
  'kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos', 'g', 'gm', 'gms', 'gram', 'grams',
  'mt', 'ton', 'tons', 'tonne', 'tonnes', 'l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'ml',
])
function isBulkUnit(unit: string | null | undefined): boolean {
  if (!unit) return false
  return BULK_UNITS.has(unit.trim().toLowerCase().replace(/\./g, ''))
}
/** A bulk-unit line still on quantity 1 = the operator hasn't set the real bag count. */
function needsBagCount(item: { unit: string | null; quantity: number }): boolean {
  return isBulkUnit(item.unit) && item.quantity <= 1
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** Human label for a line's physical package word, pluralized (falls back to units/sacks). */
function unitLabel(unit: string | null, qty: number): string {
  const raw = unit?.trim()
  // A bulk measure (KG/LTR) isn't a package word — call them "units/sacks".
  const base = !raw || isBulkUnit(raw) ? 'unit' : raw.toLowerCase()
  const plural = qty === 1 ? base : base.endsWith('s') ? base : `${base}s`
  return !raw || isBulkUnit(raw) ? `${plural} / sacks` : plural
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
  const { user } = useAuth()
  // Adding a new SKU to the catalogue is allowed for Store (ADMIN) and Operators.
  const canAddSku = user?.role === 'ADMIN' || user?.role === 'OPERATOR'
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
  const bulkLineCount = (po.lineItems ?? []).filter(needsBagCount).length

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
          {bulkLineCount > 0 && editable && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700">
              <span className="mt-px font-semibold">⚠</span>
              <span>
                <span className="font-semibold">{bulkLineCount} line{bulkLineCount === 1 ? '' : 's'}</span> came in
                as a bulk weight (KG/LTR), so the bag count isn't known yet — each is set to <span className="font-semibold">1</span>.
                Enter the real number of physical bags/drums for those lines before registering.
              </span>
            </p>
          )}

          {(po.lineItems ?? []).length === 0 ? (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">No materials yet.</div>
          ) : (
            <div className="space-y-2">
              {(po.lineItems ?? []).map((li, i) => (
                <LineCard key={li.id} poId={poId} item={li} index={i} editable={editable} canAddSku={canAddSku} onChange={load} />
              ))}
            </div>
          )}

          {editable && (
            <>
              <AddLine poId={poId} onAdded={load} />
              {largeCount && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  This invoice will create <span className="font-semibold">{totalUnits}</span> QR codes.
                  Double-check every quantity reflects the number of physical bags/drums (not the total weight in Kg).
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
                <p className="text-sm">
                  <span className="font-medium">{totalUnits}</span> physical unit{totalUnits === 1 ? '' : 's'} will be
                  registered with one QR code each.
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

// Field label above an input (keeps the card readable without a table header).
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function LineCard({
  poId,
  item,
  index,
  editable,
  canAddSku = false,
  onChange,
}: {
  poId: string
  item: POLineItem
  index: number
  editable: boolean
  canAddSku?: boolean
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
  const [saving, setSaving] = useState(false)
  const [addingSku, setAddingSku] = useState(false)

  // Add this (unmatched) material to the Master Catalogue. Uses the line's own
  // name/SKU/HSN; a provisional TMP- code is generated server-side if no SKU. Audited
  // as added-from-no-match. After adding, re-matching turns the line EXACT.
  const addToCatalogue = async () => {
    setAddingSku(true)
    try {
      const created = await api.post<{ sku: string }>('/catalogue?source=no-match', {
        materialName: v.materialName.trim(),
        sku: v.sku.trim() || undefined,
        hsnCode: v.hsnCode.trim() || undefined,
        unit: v.unit.trim() || undefined,
      })
      toast({
        title: 'Added to catalogue',
        description: created.sku.startsWith('TMP-')
          ? `${v.materialName} added with provisional code ${created.sku} (set a real SKU later).`
          : `${v.materialName} added as ${created.sku}.`,
      })
      onChange() // reloads the PO → line re-matches to EXACT
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not add to catalogue',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setAddingSku(false)
    }
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.value })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
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
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    await api.del(`/purchase-orders/${poId}/line-items/${item.id}`)
    onChange()
  }

  const m = MATCH[item.matchType]
  const flagged = needsBagCount({ unit: v.unit, quantity: Number(v.quantity) || 1 })

  // Read-only (already registered / not editable).
  if (!editable) {
    return (
      <div className="rounded-md border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>
            <span className="font-medium">{item.materialName}</span>
          </div>
          <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
        </div>
        {/* Prominent unit count generated for this line (display-only). */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-lg font-semibold text-primary">{item.quantity}</span>
          <span className="text-sm text-muted-foreground">{unitLabel(item.unit, item.quantity)} · QR-coded</span>
          {item.weight != null && (
            <span className="text-sm text-muted-foreground">
              · {item.weight} kg each = <span className="font-medium text-foreground">{round(item.quantity * item.weight)} kg</span> total
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>HSN: <span className="font-mono text-foreground">{item.hsnCode ?? '—'}</span></span>
          <span>SKU: <span className="font-mono text-foreground">{item.sku ?? '—'}</span></span>
          {item.weight == null && <span>Weight/unit: <span className="text-foreground">—</span></span>}
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-md border p-3 ${flagged ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{index + 1}.</span>
          <span className={`rounded border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>
          {flagged && (
            <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
              Enter bag count
            </span>
          )}
          {/* Unmatched material — let the operator add it to the Master Catalogue. */}
          {canAddSku && item.matchType !== 'EXACT' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={addToCatalogue}
              disabled={addingSku || !v.materialName.trim()}
            >
              <BookMarked className="h-3.5 w-3.5" />
              {addingSku ? 'Adding…' : 'Add to catalogue'}
            </Button>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={remove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Responsive grid — wraps on narrow screens, no horizontal scroll. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <Field label="Material" className="col-span-2 sm:col-span-5">
          <Input value={v.materialName} onChange={set('materialName')} className="h-9" />
        </Field>
        <Field label="HSN" className="sm:col-span-3">
          <Input value={v.hsnCode} onChange={set('hsnCode')} placeholder="e.g. 39072090" className="h-9 font-mono" />
        </Field>
        <Field label="SKU" className="sm:col-span-4">
          <Input value={v.sku} onChange={set('sku')} placeholder="item code" className="h-9 font-mono" />
        </Field>
        <Field label="Qty (bags/drums)" className="sm:col-span-4">
          <Input type="number" min={1} value={v.quantity} onChange={set('quantity')} className={`h-9 ${flagged ? 'border-amber-500' : ''}`} />
        </Field>
        <Field label="Unit" className="sm:col-span-4">
          <Input value={v.unit} onChange={set('unit')} placeholder="Bag / Drum" className="h-9" />
        </Field>
        <Field label="Weight/unit (kg)" className="sm:col-span-4">
          <Input type="number" min={0} step="any" value={v.weight} onChange={set('weight')} placeholder="e.g. 25" className="h-9" />
        </Field>
      </div>

      {flagged && (
        <p className="mt-2 text-xs text-amber-700">
          This line was read as a bulk weight. Set <span className="font-medium">Qty</span> to the number of physical
          bags/drums (and the per-bag weight if known).
        </p>
      )}

      {dirty && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" className="h-8" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save line'}
          </Button>
        </div>
      )}
    </div>
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
