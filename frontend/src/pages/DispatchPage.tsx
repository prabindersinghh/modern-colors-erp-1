import { useCallback, useEffect, useState } from 'react'
import {
  Truck,
  PackageCheck,
  Boxes,
  Undo2,
  Trash2,
  RefreshCcw,
  Printer,
  ChevronLeft,
  X,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useUrlId, useUrlParam } from '@/lib/urlState'
import { usePageBack, useNavigation } from '@/lib/navigation'
import type { DispatchHistory, DispatchReady, FinishedGood, DispatchPgList, DispatchPgListDetail } from '@/types/api'
import { RapidScanPanel, type RapidScanResult } from '@/components/scan/RapidScanPanel'
import { ScanSessionBar } from '@/components/scan/ScanSessionBar'
import { ScanPanel } from '@/components/scan/ScanPanel'
import { useScanFlow } from '@/components/scan/useScanFlow'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { DispatchAnalytics } from '@/components/dashboard/DispatchAnalytics'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { toast } from '@/hooks/useToast'
import { useAutoRefresh } from '@/lib/refresh'

const DEVICE = 'web-client'

// FG QR payload is JSON ({ uniqueId, ... }); fall back to raw text for a typed code.
function extractUniqueId(text: string): string {
  try {
    const o = JSON.parse(text)
    if (o && typeof o.uniqueId === 'string') return o.uniqueId
  } catch {
    /* not JSON */
  }
  return text.trim()
}

type ReadyBatch = DispatchReady['batches'][number]

export function DispatchPage() {
  const [tab, setTab] = useUrlParam<'scan' | 'packed' | 'returns' | 'analytics'>('tab', 'scan', {
    allowed: ['scan', 'packed', 'returns', 'analytics'],
  })
  const { user } = useAuth()
  const [ready, setReady] = useState<DispatchReady | null>(null)
  const [history, setHistory] = useState<DispatchHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkTarget, setBulkTarget] = useState<ReadyBatch | null>(null)
  // The batch the dispatcher chose to work through. Scanning is never blocked to it —
  // a drum from another batch still dispatches, with a heads-up in the result.
  // Choosing a batch to work through is a navigation step: back returns to the
  // batch list rather than dropping the dispatcher out of the screen entirely.
  const [activeBatchId, setActiveBatchId] = useUrlId('batch')
  // Dispatch is this role's only screen. Back closes whichever batch or tab is open
  // rather than being absent entirely; the scan panel keeps its own "Back to scan".
  const { goBackWithinScreen } = useNavigation()
  usePageBack(activeBatchId || tab !== 'scan' ? () => goBackWithinScreen('/dispatch') : null, 'Dispatch')

  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<RapidScanResult[]>([])

  const load = useCallback(async () => {
    const [r, h] = await Promise.all([
      api.get<DispatchReady>('/finished-goods/dispatch/ready').catch(() => null),
      api.get<DispatchHistory>('/finished-goods/dispatch/history').catch(() => null),
    ])
    setReady(r)
    setHistory(h)
  }, [])
  useEffect(() => void load(), [load])
  // Mid-run currency: another dispatcher (or a bulk action) can move a batch while this
  // phone is scanning. Poll only while the scan tab is open and visible; scans of THIS
  // session already refetch instantly via the mutation bus.
  useAutoRefresh(load, { intervalMs: 12_000, enabled: tab === 'scan' })

  const push = (r: RapidScanResult) => {
    setRecent((prev) => [r, ...prev].slice(0, 12))
    return r
  }

  const activeBatch = ready?.batches.find((b) => b.batchId === activeBatchId) ?? null

  /**
   * Scan to dispatch. NO weight or quantity is entered here and none is needed: the
   * production head already recorded size/volume per package when the batch output was
   * confirmed, so each FG unit carries its own figures. The dispatch worker only
   * identifies the drum going out.
   */
  const scan = async (raw: string): Promise<RapidScanResult> => {
    const id = extractUniqueId(raw)
    if (!id) return push({ ok: false, title: 'Empty scan' })

    // Wrong-prefix guard: a raw-material label at dispatch is a real mistake.
    if (/^MC-/i.test(id)) {
      return push({
        ok: false,
        title: 'Raw-material label',
        detail: `${id} is an inward unit, not finished goods.`,
      })
    }

    // Packing stage — a carton's mega QR (PG-) ships the whole carton and every unit in it
    // at once. Works whenever packing is in use; a voided/unpacked PG is refused server-side.
    if (/^PG-/i.test(id)) {
      try {
        const res = await api.post<{ pg: string; dispatched: number }>('/finished-goods/dispatch/scan-carton', {
          uniqueId: id,
          device: DEVICE,
        })
        setCount((c) => c + res.dispatched)
        void load()
        return push({ ok: true, title: `${res.pg} dispatched`, detail: `${res.dispatched} unit${res.dispatched === 1 ? '' : 's'} shipped together` })
      } catch (err) {
        return push({ ok: false, title: 'Carton not dispatched', detail: err instanceof ApiError ? err.message : 'Please try again.' })
      }
    }

    try {
      const unit = await api.post<FinishedGood>('/finished-goods/dispatch/scan', {
        uniqueId: id,
        device: DEVICE,
      })
      setCount((c) => c + 1)
      void load() // refreshes the batch cards, so progress bars move live
      return push({
        ok: true,
        title: `${unit.uniqueId} dispatched`,
        detail: `${unit.productName}${unit.sizePerPackage ? ` · ${unit.sizePerPackage} ${unit.sizeUnit ?? ''}`.trimEnd() : ''}`,
        // Working through one batch and scanned another? Still dispatched — but say so.
        warning:
          activeBatch && unit.batch?.id && unit.batch.id !== activeBatch.batchId
            ? `Heads-up: this drum is from batch ${unit.batch.batchNumber}, not ${activeBatch.batchNumber}. It was dispatched.`
            : undefined,
      })
    } catch (err) {
      return push({
        ok: false,
        title: 'Not dispatched',
        detail: err instanceof ApiError ? err.message : 'Please try again.',
      })
    }
  }

  const dispatchWholeBatch = async () => {
    if (!bulkTarget) return
    setBusy(true)
    try {
      const res = await api.post<{ dispatched: number }>('/finished-goods/dispatch/batch', {
        batchId: bulkTarget.batchId,
      })
      toast({ title: `${res.dispatched} units dispatched`, description: `Batch ${bulkTarget.batchNumber}` })
      setBulkTarget(null)
      await load()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not dispatch batch', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  if (user?.role !== 'DISPATCH') {
    return <EmptyState title="Dispatch" description="This screen is for the dispatch team." />
  }

  if (tab === 'analytics') {
    return (
      <div className="space-y-4">
        <DispatchTabs tab={tab} onChange={setTab} />
        <DispatchAnalytics />
      </div>
    )
  }

  if (tab === 'packed') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <DispatchTabs tab={tab} onChange={setTab} />
        <PgListsTab />
      </div>
    )
  }

  if (tab === 'returns') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <DispatchTabs tab={tab} onChange={setTab} />
        <ReturnsTab />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <DispatchTabs tab={tab} onChange={setTab} />

      {/* Today's tally */}
      <div className="stagger grid grid-cols-2 gap-3">
        <Card className="chip-edge tactile-lift pl-1 [--chip-edge-color:hsl(var(--healthy))]">
          <CardContent className="p-4">
            <div className="text-label uppercase text-chip-500">Dispatched today</div>
            <div className="mt-1.5 text-metric text-healthy">
              <AnimatedNumber value={history?.todayCount ?? 0} />
            </div>
          </CardContent>
        </Card>
        <Card className="chip-edge tactile-lift pl-1 [--chip-edge-color:hsl(var(--info))]">
          <CardContent className="p-4">
            <div className="text-label uppercase text-chip-500">Awaiting dispatch</div>
            <div className="mt-1.5 text-metric text-info">
              <AnimatedNumber value={history?.totalPending ?? 0} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Incoming batches — tap a card to work through it. Progress updates live. ── */}
      {ready && ready.batches.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-chip-700">
            <Boxes className="h-4 w-4" /> Incoming batches
            <Badge variant="outline">{ready.batches.length}</Badge>
          </div>
          <div className="stagger grid gap-2 sm:grid-cols-2">
            {ready.batches.map((b) => {
              const active = b.batchId === activeBatchId
              return (
                <button
                  key={b.batchId}
                  type="button"
                  onClick={() => setActiveBatchId(active ? null : b.batchId)}
                  aria-pressed={active}
                  className={cn(
                    'tactile-lift rounded-lg border bg-card p-3 text-left shadow-elev-1 transition-colors',
                    active && 'border-primary ring-2 ring-primary/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-chip-900">{b.productName}</div>
                      <div className="text-xs text-chip-500">
                        Batch {b.batchNumber} · {b.department}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {b.pending} pending
                    </Badge>
                  </div>
                  {/* 0–100% progress — stop mid-batch, resume knowing exactly where. */}
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[11px] text-chip-500">
                      <span>
                        <span className="font-semibold text-chip-800">{b.dispatched}</span> of {b.total} dispatched
                      </span>
                      <span className="font-semibold text-chip-800">{b.pct}%</span>
                    </div>
                    <div
                      className="mt-1 h-2 w-full overflow-hidden rounded-full bg-chip-100"
                      role="progressbar"
                      aria-valuenow={b.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-healthy transition-[width] duration-slow"
                        style={{ width: `${b.pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        setBulkTarget(b)
                      }}
                    >
                      <Truck className="h-3.5 w-3.5" /> Dispatch all {b.pending}
                    </Button>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {ready && ready.batches.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing waiting — everything produced has been dispatched.</p>
      )}

      {/* Working-through-batch banner */}
      {activeBatch && (
        <div className="flex items-center gap-2 rounded-lg border border-info-border bg-info-surface px-3 py-2 text-sm text-info">
          <Boxes className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Scanning batch <b>{activeBatch.batchNumber}</b> — {activeBatch.dispatched} of {activeBatch.total} done
          </span>
          <button type="button" onClick={() => setActiveBatchId(null)} className="tactile shrink-0 p-1" aria-label="Stop scanning this batch">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Rapid-fire dispatch, inside an OPEN dispatch session — the server refuses a
          scan-out (single or bulk) with no session. The loop is unchanged inside. */}
      <ScanSessionBar kind="DISPATCH" title="Dispatch">
        <RapidScanPanel
          title={activeBatch ? `Scan batch ${activeBatch.batchNumber}` : 'Scan to dispatch'}
          hint="Scan each drum in turn — no typing."
          placeholder="FG-000001"
          onScan={scan}
          sessionCount={count}
          recent={recent}
        />
      </ScanSessionBar>

      {/* Recent history */}
      {history && history.recent.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <PackageCheck className="h-4 w-4" /> Recently dispatched
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.recent.slice(0, 10).map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-1.5">
                  <span className="font-mono text-xs">{u.uniqueId}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {u.productName} · {u.batch?.batchNumber}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {u.dispatchedAt?.slice(5, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog
        open={!!bulkTarget}
        onOpenChange={(v) => !v && setBulkTarget(null)}
        title="Dispatch the whole batch?"
        description={
          bulkTarget
            ? `This marks all ${bulkTarget.pending} remaining unit(s) of batch ${bulkTarget.batchNumber} (${bulkTarget.productName}) as dispatched. It is recorded as a bulk dispatch in the audit trail.`
            : ''
        }
        confirmLabel="Dispatch all"
        onConfirm={dispatchWholeBatch}
      />
    </div>
  )
}

/**
 * Returned goods — scan the FG QR of a unit that came back, then Scrap it (written
 * off) or Refurbish it (back into sellable stock as a NEW unit with its own QR).
 * A reason is required either way; both actions are append-only audited server-side.
 */
function ReturnsTab() {
  const flow = useScanFlow()
  const [unit, setUnit] = useState<FinishedGood | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [scrapConfirm, setScrapConfirm] = useState(false)
  const [refurbished, setRefurbished] = useState<{ original: string; replacement: string } | null>(null)
  const [history, setHistory] = useState<FinishedGood[]>([])

  const loadHistory = useCallback(() => {
    api.get<FinishedGood[]>('/finished-goods/returns/history').then(setHistory).catch(() => {})
  }, [])
  useEffect(() => void loadHistory(), [loadHistory])
  useAutoRefresh(loadHistory)

  const lookup = async (raw: string) => {
    const id = extractUniqueId(raw)
    if (!id) return
    try {
      const u = await api.get<FinishedGood>(`/finished-goods/unit/${encodeURIComponent(id)}`)
      setUnit(u)
      setNote('')
      setRefurbished(null)
      flow.openDetail()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Not found',
        description: err instanceof ApiError ? err.message : `No unit ${id}.`,
      })
    }
  }

  const act = async (action: 'scrap' | 'refurbish') => {
    if (!unit) return
    if (!note.trim()) {
      toast({ variant: 'destructive', title: 'A reason is required', description: 'Say why this unit came back.' })
      return
    }
    setBusy(true)
    try {
      if (action === 'scrap') {
        await api.post('/finished-goods/returns/scrap', { uniqueId: unit.uniqueId, note: note.trim(), device: DEVICE })
        flow.finish(`${unit.uniqueId} scrapped — out of inventory`)
        setUnit(null)
      } else {
        const res = await api.post<{ original: FinishedGood; replacement: { uniqueId: string } }>(
          '/finished-goods/returns/refurbish',
          { uniqueId: unit.uniqueId, note: note.trim(), device: DEVICE },
        )
        // Stay on a result card (not the auto-reset flow): the operator needs to
        // print the NEW label before the next unit.
        setRefurbished({ original: unit.uniqueId, replacement: res.replacement.uniqueId })
        setUnit(null)
      }
      setNote('')
      loadHistory()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Return failed', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
      setScrapConfirm(false)
    }
  }

  const RETURN_STATUS_HINT: Partial<Record<NonNullable<FinishedGood['status']>, string>> = {
    GENERATED: 'This unit has not been dispatched yet — it is still inside the factory, so it cannot be returned.',
    READY: 'This unit has not been dispatched yet — it is still inside the factory, so it cannot be returned.',
    SCRAPPED: 'Already scrapped.',
    REFURBISHED: 'Already refurbished into a new unit.',
  }

  return (
    <div className="space-y-4">
      {/* Refurbish result — print the new identity before moving on. */}
      {refurbished && (
        <Card edge="healthy" className="animate-fade-up">
          <CardContent className="space-y-3 p-4">
            <div className="text-title-3 text-chip-900">Refurbished</div>
            <p className="text-sm text-chip-600">
              <span className="font-mono">{refurbished.original}</span> is retired. Its replacement{' '}
              <span className="font-mono font-semibold text-chip-900">{refurbished.replacement}</span> is back in
              sellable stock — stick the new label on the drum.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  void api
                    .openBlob(`/finished-goods/unit/${encodeURIComponent(refurbished.replacement)}/label.pdf`)
                    .catch(() => toast({ variant: 'destructive', title: 'Could not open the label' }))
                }
              >
                <Printer className="h-4 w-4" /> Print new label
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setRefurbished(null); flow.backToScan() }}>
                Next unit
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!unit && !refurbished && (
        <ScanPanel
          flow={flow}
          title="Scan a returned unit"
          hint="Point the camera at the FG QR on the returned drum."
          placeholder="FG-000001"
          successSub="Ready for the next return"
          onScan={(raw) => void lookup(raw)}
        />
      )}

      {unit && (
        <Card>
          <CardHeader className="pb-3">
            <button
              type="button"
              onClick={() => { setUnit(null); flow.backToScan() }}
              className="tactile mb-2 -ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-chip-500 hover:text-chip-900"
            >
              <ChevronLeft className="h-4 w-4" /> Back to scan
            </button>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="font-mono">{unit.uniqueId}</span>
              <Badge variant="outline">{unit.status.replace(/_/g, ' ')}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <div className="font-medium">{unit.productName}</div>
              <div className="text-muted-foreground">
                {unit.sizePerPackage} {unit.sizeUnit} · Batch {unit.batch?.batchNumber} · {unit.batch?.department}
                {unit.dispatchedAt ? ` · dispatched ${unit.dispatchedAt.slice(0, 10)}` : ''}
              </div>
            </div>

            {unit.status !== 'DISPATCHED' ? (
              <p className="rounded-md border border-warning-border bg-warning-surface p-2.5 text-sm text-warning-foreground">
                {RETURN_STATUS_HINT[unit.status] ?? 'This unit cannot be returned.'}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="return-note">Reason (required)</Label>
                  <Input
                    id="return-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. leaking drum, customer rejection"
                    className="h-11"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="destructive"
                    className="h-12 gap-1.5"
                    disabled={busy || !note.trim()}
                    onClick={() => setScrapConfirm(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Scrap
                  </Button>
                  <Button
                    className="h-12 gap-1.5"
                    disabled={busy || !note.trim()}
                    onClick={() => void act('refurbish')}
                  >
                    <RefreshCcw className="h-4 w-4" /> Refurbish
                  </Button>
                </div>
                <p className="text-xs text-chip-500">
                  Scrap writes the unit off permanently. Refurbish puts the drum back into sellable stock
                  under a <b>new</b> FG number with its own QR — its history stays traceable to this unit.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Returns history */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Undo2 className="h-4 w-4" /> Recent returns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.slice(0, 10).map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                  <span className="font-mono text-xs">{u.uniqueId}</span>
                  <Badge
                    variant={u.status === 'SCRAPPED' ? 'destructive' : 'secondary'}
                    className="text-[10px]"
                  >
                    {u.status === 'SCRAPPED' ? 'Scrapped' : 'Refurbished'}
                  </Badge>
                  {u.refurbishedInto && (
                    <span className="text-xs text-chip-500">
                      → <span className="font-mono">{u.refurbishedInto.uniqueId}</span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {u.productName}
                    {u.returnNote ? ` · ${u.returnNote}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {u.returnedAt?.slice(5, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog
        open={scrapConfirm}
        onOpenChange={setScrapConfirm}
        title="Scrap this unit?"
        description={
          unit
            ? `${unit.uniqueId} (${unit.productName}) will be written off permanently and leave inventory. Reason: "${note.trim()}". This is recorded in the audit trail.`
            : ''
        }
        confirmLabel="Scrap it"
        onConfirm={() => void act('scrap')}
      />
    </div>
  )
}

/** Scan / Returns / Analytics switch — 44px on touch for gloved hands. */
const PG_FAM: Record<string, string> = { FINISHED_GOOD: 'FG', HARDENER: 'FGHD', THINNER: 'FGTH' }

/**
 * PG BATCH CARDS — one card per confirmed packing list, with a dispatched/total progress
 * bar. Scanning a PG happens on the Scan tab (same Start/Done session as unit scans); this
 * is the read view of how far each list has shipped. Numbers are server-computed.
 */
function PgListsTab() {
  const [lists, setLists] = useState<DispatchPgList[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => api.get<{ lists: DispatchPgList[] }>('/finished-goods/dispatch/pg-lists').then((r) => setLists(r.lists)).catch(() => setLists([])), [])
  useEffect(() => void load(), [load])
  useAutoRefresh(load, { intervalMs: 12_000 })

  if (lists === null) return <div className="h-24 animate-pulse rounded-lg bg-muted" />
  if (lists.length === 0) {
    return <EmptyState title="No packed-goods lists yet" description="When the packer confirms a list, its PG cards appear here. Scan a PG on the Scan tab to ship the whole carton." />
  }
  return (
    <div className="space-y-3">
      {lists.map((l) => (
        <Card key={l.listId} edge={l.done ? undefined : 'primary'}>
          <CardContent className="space-y-3 p-4">
            <button className="tactile flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === l.listId ? null : l.listId)}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-chip-900">Packing list</span>
                  {l.done ? <Badge variant="secondary">all shipped</Badge> : <Badge>{l.totalPgs - l.dispatched} to ship</Badge>}
                </div>
                <p className="text-sm text-chip-600">{l.straights} straight{l.straights === 1 ? '' : 's'} · {l.combos} combo{l.combos === 1 ? '' : 's'}{l.packedBy ? ` · ${l.packedBy}` : ''}</p>
                <p className="mt-1 text-xs text-chip-500">{l.families.map((f) => `${f.count} × ${f.size}${f.unit} ${PG_FAM[f.family] ?? f.family}`).join(' · ')}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-title-3 font-semibold text-chip-900">{l.progress}%</div>
                <div className="text-[11px] text-chip-500">{l.dispatched}/{l.totalPgs} PGs</div>
              </div>
            </button>
            <div className="h-2 w-full overflow-hidden rounded-full bg-chip-100">
              <div className="h-full rounded-full bg-healthy transition-all" style={{ width: `${l.progress}%` }} />
            </div>
            {open === l.listId && <PgListDetail listId={l.listId} />}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function PgListDetail({ listId }: { listId: string }) {
  const [detail, setDetail] = useState<DispatchPgListDetail | null>(null)
  useEffect(() => { api.get<DispatchPgListDetail>(`/finished-goods/dispatch/pg-lists/${listId}`).then(setDetail).catch(() => {}) }, [listId])
  if (!detail) return <p className="text-xs text-chip-500">Loading PGs…</p>
  return (
    <div className="space-y-1.5 rounded-md border border-chip-100 p-2">
      {detail.cartons.map((c) => (
        <div key={c.pg} className="flex items-center justify-between rounded px-2 py-1 text-xs">
          <span className="min-w-0 truncate"><span className="font-medium">{c.pg}</span><span className="ml-2 text-chip-500">{c.items.map((it) => it.uniqueId).join(', ')}</span></span>
          <Badge variant={c.status === 'DISPATCHED' ? 'default' : c.status === 'VOIDED' ? 'destructive' : 'outline'}>{c.status.toLowerCase()}</Badge>
        </div>
      ))}
    </div>
  )
}

type DispatchTab = 'scan' | 'packed' | 'returns' | 'analytics'
function DispatchTabs({
  tab,
  onChange,
}: {
  tab: DispatchTab
  onChange: (t: DispatchTab) => void
}) {
  const LABEL: Record<DispatchTab, string> = { scan: 'Scan', packed: 'Packed (PG)', returns: 'Returns', analytics: 'Analytics' }
  return (
    <div
      role="radiogroup"
      aria-label="Dispatch view"
      className="inline-flex items-center gap-0.5 rounded-lg bg-chip-100 p-0.5"
    >
      {(['scan', 'packed', 'returns', 'analytics'] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={tab === t}
          onClick={() => onChange(t)}
          className={cn(
            'tactile rounded-md px-3.5 py-1.5 text-xs font-semibold [@media(pointer:coarse)]:min-h-11',
            tab === t ? 'bg-card text-chip-900 shadow-elev-1' : 'text-chip-500 hover:text-chip-700',
          )}
        >
          {LABEL[t]}
        </button>
      ))}
    </div>
  )
}
