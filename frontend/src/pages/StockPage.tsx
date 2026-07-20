import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  RotateCcw,
  PlusCircle,
  MinusCircle,
  Trash2,
  PackageCheck,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type {
  Department,
  ProductionRequest,
  ProductionRequestItem,
  StockLevels,
  StockTransaction,
  StockTxnType,
  StockUnit,
} from '@/types/api'
import { ScanPanel } from '@/components/scan/ScanPanel'
import { useScanFlow } from '@/components/scan/useScanFlow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SeverityBadge, stockSeverity } from '@/components/ui/severity'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/useToast'


const DEVICE = 'web-client'
const DEPARTMENTS: Department[] = ['PU', 'ENAMEL', 'POWDER']

// QR payload is JSON ({ uniqueId, ... }); fall back to raw text for a plain ID.
function extractUniqueId(text: string): string {
  try {
    const o = JSON.parse(text)
    if (o && typeof o.uniqueId === 'string') return o.uniqueId
  } catch {
    /* not JSON */
  }
  return text.trim()
}

const TYPE_META: Record<
  StockTxnType,
  { label: string; icon: typeof PlusCircle; cls: string; verb: string }
> = {
  ADD: { label: 'Add', icon: PlusCircle, cls: 'text-healthy', verb: 'into stock' },
  DEDUCT: { label: 'Deduct', icon: MinusCircle, cls: 'text-info', verb: 'out for a department' },
  DISCARD: { label: 'Discard', icon: Trash2, cls: 'text-destructive', verb: 'wasted / damaged' },
}

// A request line the Store is issuing against (deep-linked from the inbox).
interface IssueContext {
  request: ProductionRequest
  item: ProductionRequestItem
}

export function StockPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestItemId = searchParams.get('requestItemId')

  const [issue, setIssue] = useState<IssueContext | null>(null)
  const [unit, setUnit] = useState<StockUnit | null>(null)
  const [history, setHistory] = useState<StockTransaction[]>([])
  const [busy, setBusy] = useState(false)

  // Movement form
  const [type, setType] = useState<StockTxnType>('DEDUCT')
  const [qty, setQty] = useState('')
  const [department, setDepartment] = useState<Department | ''>('')
  const [note, setNote] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  // UPI-style loop: camera → detail → confirm → 2s success → camera.
  const flow = useScanFlow()

  // FIFO recommendation for the request line being issued (oldest unit to scan first).
  const [fifoHint, setFifoHint] = useState<{ uniqueId: string; balanceKg: number; ageDays: number } | null>(null)

  // Load the request line when deep-linked from the inbox.
  useEffect(() => {
    if (!requestItemId) {
      setIssue(null)
      setFifoHint(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        // The line lives inside its parent request; we don't know the parent id, so
        // scan the Store's request list for the line. (Small dataset; fine for Store.)
        const res = await api.get<{ data: ProductionRequest[] }>('/production-requests?pageSize=200')
        const parent = res.data.find((r) => r.items.some((i) => i.id === requestItemId))
        const item = parent?.items.find((i) => i.id === requestItemId)
        if (!cancelled && parent && item) {
          setIssue({ request: parent, item })
          setType('DEDUCT')
          setDepartment(parent.department)
          const remaining = Math.max(0, (item.approvedKg ?? 0) - item.issuedKg)
          setQty(remaining ? String(remaining) : '')
          // Proactively recommend the FIFO-oldest in-stock unit of this material.
          void recommendOldest(item.sku ?? item.materialName, item.sku, item.materialName, cancelled, setFifoHint)
        }
      } catch {
        /* fall back to standalone scan */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requestItemId])

  const loadHistory = useCallback(async (uniqueId: string) => {
    try {
      const res = await api.get<{ transactions: StockTransaction[] }>(
        `/stock/units/${encodeURIComponent(uniqueId)}/transactions`,
      )
      setHistory(res.transactions)
    } catch {
      setHistory([])
    }
  }, [])

  const lookup = async (rawId: string) => {
    const id = rawId.trim()
    if (!id) return
    setBusy(true)
    try {
      const u = await api.get<StockUnit>(`/stock/units/${encodeURIComponent(id)}`)
      // Hard QR-verify against the request line the Store came in to fulfil.
      if (issue && !sameMaterial(u, issue.item)) {
        toast({
          variant: 'destructive',
          title: 'Wrong material',
          description: `Scanned ${u.materialName}${u.sku ? ` (${u.sku})` : ''}, but this line needs ${issue.item.materialName}${issue.item.sku ? ` (${issue.item.sku})` : ''}.`,
        })
        return
      }
      setUnit(u)
      if (!issue) setDepartment('')
      flow.openDetail() // close the camera; the detail screen takes over
      await loadHistory(u.uniqueId)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast({ variant: 'destructive', title: 'Unknown unit', description: `No unit with ID ${id}.` })
      } else if (err instanceof ApiError && err.status === 409) {
        toast({ variant: 'destructive', title: 'Not weighed', description: err.message })
      } else {
        toast({ variant: 'destructive', title: 'Lookup failed', description: err instanceof ApiError ? err.message : '' })
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Validate, then open the REVIEW step. Nothing is committed here — the Store Head sees
   * a full summary (unit, material, department, batch, quantity, resulting balance) and
   * must explicitly confirm, mirroring the Phase 1 PO review gate.
   */
  const openReview = () => {
    if (!unit) return
    const q = Number(qty)
    if (!(q > 0)) {
      toast({ variant: 'destructive', title: 'Enter a quantity greater than 0' })
      return
    }
    if (type !== 'DISCARD' && !department) {
      toast({ variant: 'destructive', title: 'Select a department for an Add or Deduct' })
      return
    }
    if ((type === 'DEDUCT' || type === 'DISCARD') && q > unit.balanceKg) {
      toast({
        variant: 'destructive',
        title: 'Not enough on this unit',
        description: `Only ${unit.balanceKg} kg remain on ${unit.uniqueId}.`,
      })
      return
    }
    // Approved-cap check for a request-driven issue (the server enforces it too).
    if (type === 'DEDUCT' && issue) {
      const remaining = Math.max(0, (issue.item.approvedKg ?? 0) - issue.item.issuedKg)
      if (q > remaining + 1e-9) {
        toast({
          variant: 'destructive',
          title: 'Over the approved amount',
          description: `Only ${round(remaining)} kg of the approved ${issue.item.approvedKg ?? 0} kg remain on this line.`,
        })
        return
      }
    }
    setReviewOpen(true)
  }

  /** Commit the movement — only reachable from the review step. */
  const commit = async () => {
    if (!unit) return
    const q = Number(qty)
    setBusy(true)
    try {
      const res = await api.post<{ unit: StockUnit }>('/stock/transactions', {
        uniqueId: unit.uniqueId,
        type,
        quantityKg: q,
        department: type === 'DISCARD' ? undefined : (department as Department),
        requestItemId: type === 'DEDUCT' && issue ? issue.item.id : undefined,
        note: note.trim() || undefined,
        device: DEVICE,
      })
      setReviewOpen(false)
      // Brief confirmation, then the camera reopens automatically for the next unit.
      flow.finish(
        `${TYPE_META[type].label === 'Add' ? 'Added' : TYPE_META[type].label === 'Deduct' ? 'Deducted' : 'Discarded'} ${q} kg ${
          type === 'ADD' ? 'to' : 'from'
        } ${unit.uniqueId} · ${res.unit.balanceKg} kg remaining`,
      )
      setUnit(null) // detail screen closes; ScanPanel takes over
      setHistory([])
      setQty('')
      setNote('')
      // Refresh the issue context so "remaining" reflects what was just issued.
      if (issue) {
        try {
          const r = await api.get<{ data: ProductionRequest[] }>('/production-requests?pageSize=200')
          const parent = r.data.find((x) => x.items.some((i) => i.id === issue.item.id))
          const item = parent?.items.find((i) => i.id === issue.item.id)
          if (parent && item) setIssue({ request: parent, item })
        } catch {
          /* best-effort refresh */
        }
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Movement rejected',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    flow.backToScan()
    setUnit(null)
    setHistory([])
    setQty('')
    setNote('')
  }

  const clearIssue = () => {
    setIssue(null)
    setSearchParams({})
    reset()
  }

  if (user?.role !== 'ADMIN') {
    return <p className="text-sm text-muted-foreground">Stock movement is available to the Store only.</p>
  }

  const remaining = issue ? Math.max(0, (issue.item.approvedKg ?? 0) - issue.item.issuedKg) : null

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {issue && (
        <Card className="border-info-border">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4" /> Issuing a request line
              </span>
              <Badge variant="outline">{issue.request.department}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium">
              {issue.item.materialName}
              {issue.item.sku ? <span className="text-muted-foreground"> · {issue.item.sku}</span> : null}
            </div>
            <div className="text-muted-foreground">
              Approved {issue.item.approvedKg ?? 0} kg · issued {issue.item.issuedKg} kg ·{' '}
              <span className="font-medium text-foreground">{remaining} kg remaining</span>
            </div>
            {/* Proactive FIFO recommendation: scan the oldest unit first. */}
            {fifoHint && (
              <div className="mt-1 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                Recommended: scan <span className="font-mono font-semibold">{fifoHint.uniqueId}</span> first
                (oldest, {fifoHint.balanceKg} kg, {fifoHint.ageDays}d)
              </div>
            )}
            <Button variant="ghost" size="sm" className="mt-1 h-7 px-0 text-xs" onClick={clearIssue}>
              Cancel — do a standalone scan instead
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Scan — camera is MOUNTED only while scanning, so it is released in between.
          A success flash replaces it briefly before it reopens automatically. */}
      {!unit && (
        <ScanPanel
          flow={flow}
          title="Scan a unit QR"
          hint="Point the rear camera at a unit's QR code."
          placeholder="MC-000001"
          successSub="Ready for the next unit"
          onScan={(raw) => lookup(extractUniqueId(raw))}
        />
      )}

      {/* Movement panel */}
      {unit && (
        <Card>
          <CardHeader className="pb-3">
            {/* Back returns to the camera — for a wrong unit or a re-scan. */}
            <button
              type="button"
              onClick={reset}
              className="tactile mb-2 -ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-chip-500 hover:text-chip-900"
            >
              <ChevronLeft className="h-4 w-4" /> Back to scan
            </button>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="font-mono">{unit.uniqueId}</span>
              {/* The balance carries a severity, not the brand colour: a red pill
                  on a healthy 24.8 kg unit reads as an alarm in the severity
                  language used everywhere else on the floor. */}
              <SeverityBadge
                severity={stockSeverity(unit.balanceKg)}
                icon={false}
                className="shrink-0 whitespace-nowrap"
              >
                {unit.balanceKg} kg on unit
              </SeverityBadge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <div className="font-medium">{unit.materialName}</div>
              <div className="text-muted-foreground">
                {unit.sku ?? '—'} · {unit.po?.supplier ?? '—'}
                {unit.po?.poNumber ? ` · PO ${unit.po.poNumber}` : ''}
                {unit.arrivedAt ? ` · received ${new Date(unit.arrivedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
              </div>
            </div>

            {/* FIFO soft warning — older stock of the same material still in stock. Never
                blocks; the operator can proceed. */}
            {unit.fifo && !unit.fifo.isOldest && unit.fifo.recommended && (
              <div className="rounded-lg border-2 border-warning-border bg-warning-surface p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-amber" />
                  <div className="text-sm">
                    <div className="font-semibold text-warning-foreground">Older stock available</div>
                    <div className="text-warning-foreground/90">
                      <span className="font-mono font-medium">{unit.fifo.recommended.uniqueId}</span> (received{' '}
                      {unit.fifo.recommended.arrivedAt
                        ? new Date(unit.fifo.recommended.arrivedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
                        : '—'}
                      , {unit.fifo.recommended.balanceKg} kg, {unit.fifo.recommended.ageDays} days old) has been in stock
                      longer. Consider using it first.
                      {unit.fifo.olderUnits.length > 1 ? ` (+${unit.fifo.olderUnits.length - 1} more older)` : ''}
                    </div>
                    <div className="mt-1 text-xs text-warning-foreground/70">You can still proceed with this unit if needed.</div>
                  </div>
                </div>
              </div>
            )}

            {/* Always offer all three (Override 3) */}
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_META) as StockTxnType[]).map((t) => {
                const m = TYPE_META[t]
                const Icon = m.icon
                const active = type === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors ${
                      active ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-muted/50'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${m.cls}`} />
                    {m.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">{TYPE_META[type].verb}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qty">
                  {issue && type === 'DEDUCT' ? 'Actual quantity issued (kg)' : 'Quantity (kg)'}
                </Label>
                <Input
                  id="qty"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={type === 'ADD' ? 'e.g. 5' : `≤ ${unit.balanceKg}`}
                  className="h-11 text-base"
                />
                {/* Item 6 — the Store Head weighs out the REAL amount, which may differ
                    from what was approved. Pre-filled, but freely editable within caps. */}
                {issue && type === 'DEDUCT' && (
                  <p className="text-xs text-muted-foreground">
                    Approved {issue.item.approvedKg ?? 0} kg · already issued {issue.item.issuedKg} kg ·{' '}
                    <span className="font-medium text-foreground">
                      {round(Math.max(0, (issue.item.approvedKg ?? 0) - issue.item.issuedKg))} kg remaining
                    </span>
                    . Enter what you actually weighed out.
                  </p>
                )}
              </div>
              {type !== 'DISCARD' && (
                <div className="space-y-1.5">
                  <Label htmlFor="dept">Department</Label>
                  <select
                    id="dept"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value as Department)}
                    disabled={!!issue}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-70"
                  >
                    <option value="">Select…</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. spillage, returned unused" />
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={openReview} disabled={busy}>
                Review {TYPE_META[type].label}
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={reset} disabled={busy}>
                <RotateCcw className="h-4 w-4" /> Next
              </Button>
            </div>

            {history.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Movement history
                </div>
                <ul className="divide-y text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between px-3 py-1.5">
                      <span className={TYPE_META[h.type].cls}>
                        {TYPE_META[h.type].label} {h.quantityKg} kg
                        {h.department ? ` · ${h.department}` : ''}
                      </span>
                      <span className="text-muted-foreground">
                        → {h.balanceAfter} kg · {h.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* REVIEW & CONFIRM — nothing is deducted until the Store Head confirms here. */}
      {reviewOpen && unit && (
        <IssueReviewDialog
          unit={unit}
          type={type}
          quantityKg={Number(qty)}
          department={type === 'DISCARD' ? null : (department as Department)}
          issue={issue}
          note={note.trim() || null}
          busy={busy}
          onCancel={() => setReviewOpen(false)}
          onConfirm={commit}
        />
      )}
    </div>
  )
}

const round = (n: number) => Math.round(n * 1000) / 1000

/**
 * The review gate for a stock movement (item 5). Shows exactly what will happen —
 * unit, material, department, batch, quantity and the resulting balance — and commits
 * only on explicit confirmation. Mirrors the Phase 1 PO review pattern.
 */
function IssueReviewDialog({
  unit,
  type,
  quantityKg,
  department,
  issue,
  note,
  busy,
  onCancel,
  onConfirm,
}: {
  unit: StockUnit
  type: StockTxnType
  quantityKg: number
  department: Department | null
  issue: IssueContext | null
  note: string | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const meta = TYPE_META[type]
  const balanceAfter =
    type === 'ADD' ? round(unit.balanceKg + quantityKg) : round(unit.balanceKg - quantityKg)
  const approved = issue?.item.approvedKg ?? null
  const remainingBefore = issue ? Math.max(0, (approved ?? 0) - issue.item.issuedKg) : null
  const differsFromApproved =
    issue != null && remainingBefore != null && Math.abs(quantityKg - remainingBefore) > 1e-9

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <h2 className="text-title-2 text-chip-900">Confirm {meta.label.toLowerCase()}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the details below. Nothing is deducted until you confirm.
        </p>

        <dl className="mt-4 space-y-0 divide-y rounded-lg border">
          <Row label="Unit" value={<span className="font-mono">{unit.uniqueId}</span>} />
          <Row label="Material" value={`${unit.materialName}${unit.sku ? ` · ${unit.sku}` : ''}`} />
          {department && <Row label="Department" value={department} />}
          {issue?.item.batch && <Row label="Batch" value={issue.item.batch.batchNumber} />}
          <Row
            label={type === 'DEDUCT' && issue ? 'Actual quantity issued' : 'Quantity'}
            value={
              <span className={`text-base font-semibold ${meta.cls}`}>
                {type === 'ADD' ? '+' : '−'}
                {quantityKg} kg
              </span>
            }
          />
          <Row
            label="Balance on unit"
            value={
              <span>
                {unit.balanceKg} kg → <span className="font-semibold">{balanceAfter} kg</span>
              </span>
            }
          />
          {note && <Row label="Note" value={note} />}
        </dl>

        {/* Flag when the actual amount differs from what was approved (allowed). */}
        {differsFromApproved && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface p-2.5 text-xs text-warning-foreground">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
            <span>
              This differs from the {remainingBefore} kg remaining on the approved line
              (approved {approved} kg). The actual amount above is what will be recorded.
            </span>
          </p>
        )}

        {/* FIFO advisory carried into the review so it can't be missed. */}
        {type !== 'ADD' && unit.fifo && !unit.fifo.isOldest && unit.fifo.recommended && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface p-2.5 text-xs text-warning-foreground">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
            <span>
              Older stock available — <b>{unit.fifo.recommended.uniqueId}</b> (
              {unit.fifo.recommended.balanceKg} kg, {unit.fifo.recommended.ageDays} days old). You can
              still proceed.
            </span>
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel} disabled={busy}>
            Go back
          </Button>
          <Button className="flex-1 h-12" onClick={onConfirm} disabled={busy}>
            {busy ? 'Recording…' : `Confirm ${meta.label.toLowerCase()}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  )
}

function sameMaterial(
  a: { sku: string | null; materialName: string },
  b: { sku: string | null; materialName: string },
): boolean {
  if (a.sku && b.sku) return a.sku.trim().toLowerCase() === b.sku.trim().toLowerCase()
  return a.materialName.trim().toLowerCase() === b.materialName.trim().toLowerCase()
}

/** Look up the FIFO-oldest in-stock unit of a material (levels lists units oldest-first). */
async function recommendOldest(
  query: string,
  sku: string | null,
  materialName: string,
  cancelled: boolean,
  set: (v: { uniqueId: string; balanceKg: number; ageDays: number } | null) => void,
) {
  try {
    const res = await api.get<StockLevels>(`/stock/levels?q=${encodeURIComponent(query)}`)
    const group = res.materials.find((m) => sameMaterial(m, { sku, materialName }))
    const oldest = group?.units[0] // backend sorts units oldest-first
    if (!cancelled && oldest) set({ uniqueId: oldest.uniqueId, balanceKg: oldest.balanceKg, ageDays: oldest.ageDays })
  } catch {
    /* recommendation is best-effort */
  }
}
