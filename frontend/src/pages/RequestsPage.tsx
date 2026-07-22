import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PackagePlus, Send, Search, X, ClipboardList, Plus, Trash2, Check, PackageCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AppLink } from '@/lib/navigation'
import type {
  Batch,
  CatalogueItem,
  Paginated,
  ProductionRequest,
  ProductionRequestItem,
  RequestStatus,
  RequestSummary,
} from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { toast } from '@/hooks/useToast'
import { useAutoRefresh } from '@/lib/refresh'

export const STATUS_STYLE: Record<RequestStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'bg-warning-surface text-warning-foreground border-warning-border' },
  IN_PROGRESS: { label: 'In progress', cls: 'bg-brand-violet/10 text-brand-violet border-brand-violet/25' },
  APPROVED: { label: 'Approved', cls: 'bg-healthy-surface text-healthy border-healthy-border' },
  PARTIAL: { label: 'Partial', cls: 'bg-info-surface text-info border-info-border' },
  REJECTED: { label: 'Rejected', cls: 'bg-critical-surface text-critical border-critical-border' },
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS_STYLE[status]
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
}

export type ReviewBody = { action: 'APPROVE' | 'PARTIAL' | 'REJECT'; approvedKg?: number; reason?: string }

/** An approved/partial line still has stock to issue (Store can deduct against it). */
function isIssuable(it: ProductionRequestItem): boolean {
  return (
    (it.status === 'APPROVED' || it.status === 'PARTIAL') &&
    it.issuedKg + 1e-9 < (it.approvedKg ?? 0)
  )
}

export function RequestsPage() {
  const { user } = useAuth()
  const isHead = user?.role === 'PRODUCTION_HEAD'
  const isStore = user?.role === 'ADMIN'
  const [requests, setRequests] = useState<ProductionRequest[]>([])
  const [summary, setSummary] = useState<RequestSummary | null>(null)

  const load = useCallback(() => {
    api.get<Paginated<ProductionRequest>>('/production-requests?pageSize=100').then((r) => setRequests(r.data)).catch(() => {})
    api.get<RequestSummary>('/production-requests/summary').then(setSummary).catch(() => {})
  }, [])
  useEffect(() => void load(), [load])
  // The Store's pending inbox is what everyone else is waiting on — keep it moving
  // while visible. Heads' request lists refresh on focus/mutation only.
  useAutoRefresh(load, { intervalMs: isStore ? 20_000 : undefined })

  const reviewLine = async (reqId: string, itemId: string, body: ReviewBody) => {
    try {
      await api.patch(`/production-requests/${reqId}/items/${itemId}/review`, body)
      toast({ title: 'Line updated' })
      load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update line', description: err instanceof ApiError ? err.message : '' })
    }
  }

  return (
    <div className="space-y-5">
      {isHead && <NewRequestForm onCreated={load} />}

      {summary && (
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Pending" value={summary.requests.byStatus.PENDING} />
          <Stat label="In progress" value={summary.requests.byStatus.IN_PROGRESS} />
          <Stat label="Approved" value={summary.requests.byStatus.APPROVED} />
          <Stat label="Partial" value={summary.requests.byStatus.PARTIAL} />
          <Stat label="Rejected" value={summary.requests.byStatus.REJECTED} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-title-3 text-chip-800">
          {isHead ? 'My requests' : isStore ? 'Requests inbox' : 'All requests'}
        </h2>
        {requests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description={isHead ? 'Raise a material request above.' : 'No production requests have been raised.'}
          />
        ) : (
          <div className="stagger space-y-3">
            {requests.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                showDepartment={!isHead}
                onReview={isStore ? (itemId, body) => reviewLine(r.id, itemId, body) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="tactile-lift">
      <CardContent className="p-4">
        <div className="text-metric text-chip-900">
          <AnimatedNumber value={value} />
        </div>
        <div className="mt-1 text-label uppercase text-chip-500">{label}</div>
      </CardContent>
    </Card>
  )
}

function RequestCard({
  request,
  showDepartment,
  onReview,
}: {
  request: ProductionRequest
  showDepartment: boolean
  onReview?: (itemId: string, body: ReviewBody) => Promise<void>
}) {
  // Totals are grouped by unit — litres and kilograms are never added together.
  const requestedByUnit = request.items.reduce<Record<string, number>>((m, i) => {
    m[i.unit] = Number(((m[i.unit] ?? 0) + i.requestedKg).toFixed(3))
    return m
  }, {})
  const requestedLabel = Object.entries(requestedByUnit)
    .map(([u, v]) => `${v} ${u}`)
    .join(' + ')
  const pendingCount = request.items.filter((i) => i.status === 'PENDING').length
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {showDepartment && <Badge variant="outline">{request.department}</Badge>}
            <span>{request.items.length} material{request.items.length === 1 ? '' : 's'}</span>
            <span className="text-muted-foreground">· {requestedLabel} requested</span>
            {onReview && pendingCount > 0 && (
              <Badge variant="secondary">{pendingCount} to action</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {request.requestedBy?.name ?? '—'} · {request.createdAt.slice(0, 10)}
            {request.note ? ` · ${request.note}` : ''}
          </div>
        </div>
        <StatusBadge status={request.status} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="min-w-[160px]">Material</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead>Status</TableHead>
                {onReview && <TableHead className="min-w-[220px]">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.items.map((it, i) => (
                <TableRow key={it.id}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="whitespace-normal break-words font-medium">
                    {it.materialName}
                    {it.status === 'REJECTED' && it.rejectionReason && (
                      <div className="text-xs font-normal text-destructive">Reason: {it.rejectionReason}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {it.batch ? (
                      <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                        {it.batch.batchNumber}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{it.sku ?? '—'}</TableCell>
                  <TableCell className="text-right">{it.requestedKg} {it.unit}</TableCell>
                  <TableCell className="text-right">{it.approvedKg != null ? `${it.approvedKg} ${it.unit}` : '—'}</TableCell>
                  <TableCell className="text-right">{it.issuedKg} {it.unit}</TableCell>
                  <TableCell><StatusBadge status={it.status} /></TableCell>
                  {onReview && (
                    <TableCell>
                      {it.status === 'PENDING' ? (
                        <LineActions requestedKg={it.requestedKg} unit={it.unit} onReview={(body) => onReview(it.id, body)} />
                      ) : isIssuable(it) ? (
                        <Button asChild size="sm" className="h-8 gap-1">
                          {/* AppLink records the origin, so Back from Scan & Issue
                              returns to this inbox rather than the dashboard. */}
                          <AppLink to={`/stock?requestItemId=${it.id}`}>
                            <PackageCheck className="h-4 w-4" /> Issue
                          </AppLink>
                        </Button>
                      ) : it.status === 'APPROVED' || it.status === 'PARTIAL' ? (
                        <span className="text-xs text-healthy">fulfilled</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">decided</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Store's per-line controls: Accept / Partial (KG) / Reject (reason). */
function LineActions({
  requestedKg,
  unit,
  onReview,
}: {
  requestedKg: number
  unit: string
  onReview: (body: ReviewBody) => Promise<void>
}) {
  const [mode, setMode] = useState<'idle' | 'partial' | 'reject'>('idle')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (body: ReviewBody) => {
    setBusy(true)
    try {
      await onReview(body)
      setMode('idle')
      setValue('')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'partial') {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={requestedKg}
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`< ${requestedKg}`}
          className="h-8 w-20"
          autoFocus
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
        <Button size="sm" className="h-8" disabled={busy || !(Number(value) > 0 && Number(value) < requestedKg)} onClick={() => run({ action: 'PARTIAL', approvedKg: Number(value) })}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setMode('idle')}><X className="h-4 w-4" /></Button>
      </div>
    )
  }
  if (mode === 'reject') {
    return (
      <div className="flex items-center gap-1">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Reason…" className="h-8 w-36" autoFocus />
        <Button size="sm" variant="destructive" className="h-8" disabled={busy || !value.trim()} onClick={() => run({ action: 'REJECT', reason: value.trim() })}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => setMode('idle')}><X className="h-4 w-4" /></Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" className="h-8" disabled={busy} onClick={() => run({ action: 'APPROVE' })}>Accept</Button>
      <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setMode('partial')}>Partial</Button>
      <Button size="sm" variant="outline" className="h-8 text-destructive" disabled={busy} onClick={() => setMode('reject')}>Reject</Button>
    </div>
  )
}

interface Selected {
  materialName: string
  sku: string | null
  catalogueItemId: string | null
}
interface DraftLine {
  key: number
  selected: Selected | null
  kg: string
  unit: 'kg' | 'L' // measure of the amount — litres for liquids like solvents
  batchId: string // Phase 3 — per LINE, so one request can serve several batches
}
let lineKeySeq = 1

/** Head-only: build a multi-material request, then submit all lines at once. */
function NewRequestForm({ onCreated }: { onCreated: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, selected: null, kg: '', unit: 'kg', batchId: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Phase 3 — the head's own recent batches (server scopes to their department).
  // An empty list and a failed load look identical in the dropdown, so track them
  // apart: "no batches yet" needs a link to create one, a failure needs a retry.
  const [batches, setBatches] = useState<Batch[]>([])
  const [batchesLoaded, setBatchesLoaded] = useState(false)
  const [batchesFailed, setBatchesFailed] = useState(false)
  const loadBatches = useCallback(() => {
    setBatchesFailed(false)
    api
      .get<Batch[]>('/batches?take=50')
      .then((b) => {
        setBatches(b)
        setBatchesLoaded(true)
      })
      .catch(() => setBatchesFailed(true))
  }, [])
  useEffect(loadBatches, [loadBatches])

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { key: lineKeySeq++, selected: null, kg: '', unit: 'kg', batchId: '' }])
  const removeLine = (key: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)))

  const validLines = lines.filter((l) => l.selected && Number(l.kg) > 0)

  const submit = async () => {
    if (validLines.length === 0) return
    setBusy(true)
    try {
      await api.post('/production-requests', {
        note: note.trim() || undefined,
        items: validLines.map((l) => ({
          materialName: l.selected!.materialName,
          sku: l.selected!.sku ?? undefined,
          catalogueItemId: l.selected!.catalogueItemId ?? undefined,
          requestedKg: Number(l.kg),
          unit: l.unit,
          batchId: l.batchId || undefined,
        })),
      })
      toast({ title: 'Request raised', description: `${validLines.length} material${validLines.length === 1 ? '' : 's'} sent to Store.` })
      setLines([{ key: lineKeySeq++, selected: null, kg: '', unit: 'kg', batchId: '' }])
      setNote('')
      onCreated()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not raise request', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <PackagePlus className="h-4 w-4" /> Raise a material request
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Add every material you need. Store reviews each line and can accept, partially fulfill, or reject it.
          Tagging a line with a batch is optional — it is what links the material back to the finished goods later.
        </p>

        {batchesFailed ? (
          <p className="text-xs text-destructive">
            Couldn&apos;t load your batches.{' '}
            <button type="button" onClick={loadBatches} className="underline underline-offset-2">
              Try again
            </button>
            {' '}— you can still submit the request without a batch.
          </p>
        ) : batchesLoaded && batches.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            You have no open batches, so the batch dropdown is empty. Submit without one, or{' '}
            <Link to="/batches" className="font-medium underline underline-offset-2">
              open a batch first
            </Link>
            {' '}to trace this material through to finished goods.
          </p>
        ) : null}

        <div className="space-y-2">
          {lines.map((l, i) => {
            const lineBatch = batches.find((b) => b.id === l.batchId)
            return (
              <div key={l.key} className="space-y-1">
                <div className="grid gap-2 sm:grid-cols-[24px_minmax(0,1fr)_150px_150px_36px] sm:items-center">
                  <div className="text-xs text-muted-foreground">{i + 1}</div>
                  {l.selected ? (
                    <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
                      <span className="truncate">
                        {l.selected.materialName}
                        {l.selected.sku && <span className="ml-2 font-mono text-xs text-muted-foreground">{l.selected.sku}</span>}
                      </span>
                      <button type="button" onClick={() => setLine(l.key, { selected: null })} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <MaterialPicker onSelect={(s) => setLine(l.key, { selected: s })} />
                  )}
                  {/* Phase 3 — batch per line: pick an existing one (top-up) or leave blank.
                      With no batches open the list has only the blank option, which reads as a
                      broken control — so say why it is empty instead of just showing "No batch". */}
                  <select
                    value={l.batchId}
                    onChange={(e) => setLine(l.key, { batchId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    title="Which batch is this material for?"
                    disabled={batchesFailed}
                  >
                    <option value="">
                      {batchesFailed
                        ? "Couldn't load batches"
                        : !batchesLoaded
                          ? 'Loading batches…'
                          : batches.length === 0
                            ? 'No batches open yet — optional'
                            : 'No batch'}
                    </option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNumber}
                        {b.locked ? ' (confirmed)' : ''}
                      </option>
                    ))}
                  </select>
                  {/* Amount + its unit. Litres for liquids (solvents); kg otherwise. */}
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={l.kg}
                      onChange={(e) => setLine(l.key, { kg: e.target.value })}
                      placeholder={l.unit}
                      className="min-w-0 flex-1"
                    />
                    <select
                      value={l.unit}
                      onChange={(e) => setLine(l.key, { unit: e.target.value as DraftLine['unit'] })}
                      className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
                      title="Unit — litres for liquids like solvents"
                      aria-label="Unit"
                    >
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 text-destructive"
                    onClick={() => removeLine(l.key)}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {lineBatch?.locked && (
                  <p className="pl-6 text-xs text-warning-foreground">
                    ⚠ Batch {lineBatch.batchNumber} is already confirmed. Material issued now is still traced
                    to it — use this only for a genuine top-up or correction.
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addLine}>
          <Plus className="h-4 w-4" /> Add material
        </Button>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Batch #123" />
          </div>
          <Button onClick={submit} disabled={busy || validLines.length === 0} className="gap-1.5">
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : `Send ${validLines.length || ''} to Store`.trim()}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Debounced Master-Catalogue search → pick a material. */
function MaterialPicker({ onSelect }: { onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogueItem[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      api
        .get<Paginated<CatalogueItem>>(`/catalogue?pageSize=8&search=${encodeURIComponent(q)}`)
        .then((r) => {
          setResults(r.data)
          setOpen(true)
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search material / SKU…"
          className="pl-8"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg">
          {results.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onSelect({ materialName: it.materialName, sku: it.sku, catalogueItemId: it.id })
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{it.materialName}</span>
              <span className="font-mono text-xs text-muted-foreground">{it.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
