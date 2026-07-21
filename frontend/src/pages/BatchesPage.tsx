import { useCallback, useEffect, useState } from 'react'
import { Layers, Plus, ArrowRight, PackageCheck, FlaskConical, Truck } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { formatUnitTotals } from '@/lib/units'
import { useAuth } from '@/lib/auth'
import type { Batch, BatchStatus, BatchTrace } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { Modal } from '@/components/common/Modal'
import { toast } from '@/hooks/useToast'

export const BATCH_STATUS: Record<BatchStatus, { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'bg-healthy/15 text-healthy border-healthy/30' },
  OUTPUT_RECORDED: { label: 'Output recorded', cls: 'bg-warning-surface text-brand-amber border-warning-border' },
  CONFIRMED: { label: 'Confirmed', cls: 'bg-primary/15 text-primary border-primary/30' },
  CLOSED: { label: 'Closed', cls: 'bg-muted text-muted-foreground' },
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const s = BATCH_STATUS[status]
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
}

export function BatchesPage() {
  const { user } = useAuth()
  const isHead = user?.role === 'PRODUCTION_HEAD'
  const [batches, setBatches] = useState<Batch[]>([])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [traceId, setTraceId] = useState<string | null>(null)

  const load = useCallback(
    async (q = '') => {
      const res = await api
        .get<Batch[]>(`/batches?take=100${q ? `&search=${encodeURIComponent(q)}` : ''}`)
        .catch(() => [])
      setBatches(res)
    },
    [],
  )
  useEffect(() => void load(''), [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Title lives in the Navbar (see AppLayout pageTitles) — no duplicate h1. */}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <Input
            className="h-9 w-44"
            placeholder="Search batch…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              void load(e.target.value)
            }}
          />
          {isHead && (
            <Button className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New batch
            </Button>
          )}
        </div>
      </div>

      {batches.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No batches yet"
          description={isHead ? 'Create a batch, then request materials against it.' : 'Batches appear here once production heads create them.'}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {batches.map((b) => (
            <Card key={b.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{b.batchNumber}</CardTitle>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {b.department} · {b.createdAt.slice(0, 10)}
                    {b.createdBy ? ` · ${b.createdBy.name}` : ''}
                  </div>
                </div>
                <BatchStatusBadge status={b.status} />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <b className="text-foreground">{b.totals.requestCount}</b> request
                    {b.totals.requestCount === 1 ? '' : 's'}
                  </span>
                  <span>
                    <b className="text-foreground">{b.totals.lineCount}</b> material line
                    {b.totals.lineCount === 1 ? '' : 's'}
                  </span>
                  <span>
                    <b className="text-foreground">{formatUnitTotals(b.totals.issued)}</b> issued
                  </span>
                  {b._count?.finishedGoods ? (
                    <span className="text-healthy">
                      <b>{b._count.finishedGoods}</b> FG units
                    </span>
                  ) : null}
                </div>
                {/* Dispatch status of this batch's finished goods — the head can see at
                    a glance how much has actually shipped. */}
                {b.fg && b.fg.total > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-chip-500">
                      <span>
                        <b className="text-chip-800">{b.fg.dispatched}</b> of {b.fg.total} dispatched
                        {b.fg.scrapped > 0 ? ` · ${b.fg.scrapped} scrapped` : ''}
                        {b.fg.refurbished > 0 ? ` · ${b.fg.refurbished} refurbished` : ''}
                      </span>
                      <span className="font-semibold text-chip-800">{b.fg.pct}%</span>
                    </div>
                    <div
                      className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-chip-100"
                      role="progressbar"
                      aria-valuenow={b.fg.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className="h-full rounded-full bg-healthy" style={{ width: `${b.fg.pct}%` }} />
                    </div>
                  </div>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTraceId(b.id)}>
                  <ArrowRight className="h-4 w-4" /> View traceability
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && <NewBatchModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(search) }} />}
      {traceId && <TraceModal batchId={traceId} onClose={() => setTraceId(null)} />}
    </div>
  )
}

function NewBatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [batchNumber, setBatchNumber] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!batchNumber.trim()) return
    setBusy(true)
    try {
      await api.post('/batches', { batchNumber: batchNumber.trim(), note: note.trim() || undefined })
      toast({ title: 'Batch created', description: `${batchNumber.trim()} is now open for material requests.` })
      onCreated()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not create batch', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title="Start a new batch">
      <div className="stagger space-y-3">
        <div className="space-y-1.5">
          <Label>Batch number *</Label>
          <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="e.g. B-001" autoFocus />
          <p className="text-xs text-muted-foreground">Must be unique within your department.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !batchNumber.trim()}>{busy ? 'Creating…' : 'Create batch'}</Button>
        </div>
      </div>
    </Modal>
  )
}

/** The traceability view — what went in and what came out. */
function TraceModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [trace, setTrace] = useState<BatchTrace | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<BatchTrace>(`/batches/${batchId}/trace`).then(setTrace).catch(() => setError(true))
  }, [batchId])

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={trace ? `Batch ${trace.batch.batchNumber} — traceability` : 'Traceability'}>
      {error ? (
        <p className="text-sm text-muted-foreground">Could not load the trace.</p>
      ) : !trace ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <BatchStatusBadge status={trace.batch.status} />
            <Badge variant="outline">{trace.batch.department}</Badge>
            <span className="text-xs text-muted-foreground">
              created {trace.batch.createdAt.slice(0, 10)}
              {trace.batch.createdBy ? ` by ${trace.batch.createdBy.name}` : ''}
            </span>
          </div>

          {/* WHAT WENT IN */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <FlaskConical className="h-4 w-4 text-info" /> Raw materials in
              <span className="font-normal text-muted-foreground">
                · {formatUnitTotals(trace.in.totalIssuedByUnit)} across {trace.in.requestCount} request
                {trace.in.requestCount === 1 ? '' : 's'}
              </span>
            </h3>
            {trace.in.materials.length === 0 ? (
              <p className="text-xs text-muted-foreground">No material has been requested against this batch yet.</p>
            ) : (
              <ul className="space-y-2">
                {trace.in.materials.map((m) => (
                  <li key={m.lineId} className="rounded-md border p-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{m.materialName}</span>
                      {m.sku && <span className="font-mono text-xs text-muted-foreground">{m.sku}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {m.issuedKg} / {m.approvedKg ?? m.requestedKg} {m.unit} issued
                      </span>
                    </div>
                    {m.issues.length > 0 && (
                      <ul className="mt-1.5 space-y-1 border-l-2 border-muted pl-2.5 text-xs text-muted-foreground">
                        {m.issues.map((i) => (
                          <li key={i.transactionId}>
                            <span className="font-mono text-foreground">{i.unit?.uniqueId ?? '—'}</span> ·{' '}
                            {i.quantityKg} {m.unit}
                            {i.unit?.supplier ? ` · ${i.unit.supplier}` : ''}
                            {i.unit?.poNumber ? ` · PO ${i.unit.poNumber}` : ''}
                            {i.by ? ` · by ${i.by.name}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {trace.in.sources.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Sources:{' '}
                {trace.in.sources
                  .map((s) => `${s.supplier ?? 'Unknown supplier'}${s.poNumber ? ` (PO ${s.poNumber})` : ''}`)
                  .join(' · ')}
              </p>
            )}
          </section>

          {/* WHAT CAME OUT */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <PackageCheck className="h-4 w-4 text-healthy" /> Finished goods out
              <span className="font-normal text-muted-foreground">
                · {trace.out.fgTotal} unit{trace.out.fgTotal === 1 ? '' : 's'} ({trace.out.fgDispatched} dispatched)
              </span>
            </h3>
            {trace.out.outputs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No production output recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {trace.out.outputs.map((o) => (
                  <li key={o.id} className="rounded-md border p-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{o.productName}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.packageCount} × {o.sizePerPackage} {o.sizeUnit}
                      </span>
                      {o.confirmed ? (
                        <Badge className="ml-auto bg-healthy text-success-foreground hover:bg-healthy">Confirmed</Badge>
                      ) : (
                        <Badge className="ml-auto bg-warning text-white hover:bg-warning">Draft</Badge>
                      )}
                    </div>
                    {o.finishedGoods.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {o.finishedGoods.map((f) => (
                          <span
                            key={f.id}
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                              f.status === 'DISPATCHED'
                                ? 'border-healthy/30 bg-healthy/10 text-healthy'
                                : 'border-muted bg-muted/40 text-muted-foreground'
                            }`}
                            title={f.status === 'DISPATCHED' ? `Dispatched ${f.dispatchedAt?.slice(0, 10)}` : 'Awaiting dispatch'}
                          >
                            {f.uniqueId}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {trace.out.fgDispatched > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-healthy">
                <Truck className="h-3.5 w-3.5" /> {trace.out.fgDispatched} of {trace.out.fgTotal} units dispatched
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
