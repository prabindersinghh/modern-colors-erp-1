import { useCallback, useEffect, useState } from 'react'
import {
  Truck,
  PackageCheck,
  Boxes,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { DispatchHistory, DispatchReady, FinishedGood } from '@/types/api'
import { ScanPanel } from '@/components/scan/ScanPanel'
import { useScanFlow } from '@/components/scan/useScanFlow'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { toast } from '@/hooks/useToast'


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

export function DispatchPage() {
  const { user } = useAuth()
  const [ready, setReady] = useState<DispatchReady | null>(null)
  const [history, setHistory] = useState<DispatchHistory | null>(null)
  const [last, setLast] = useState<FinishedGood | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkTarget, setBulkTarget] = useState<DispatchReady['batches'][number] | null>(null)
  // UPI-style loop: a dispatch scan is a single action, so scan → success → camera.
  const flow = useScanFlow()

  const load = useCallback(async () => {
    const [r, h] = await Promise.all([
      api.get<DispatchReady>('/finished-goods/dispatch/ready').catch(() => null),
      api.get<DispatchHistory>('/finished-goods/dispatch/history').catch(() => null),
    ])
    setReady(r)
    setHistory(h)
  }, [])
  useEffect(() => void load(), [load])

  const scan = async (raw: string) => {
    const id = extractUniqueId(raw)
    if (!id || busy) return
    setBusy(true)
    try {
      const unit = await api.post<FinishedGood>('/finished-goods/dispatch/scan', {
        uniqueId: id,
        device: DEVICE,
      })
      setLast(unit)
      // Brief confirmation, then the camera reopens automatically for the next unit.
      flow.finish(`${unit.uniqueId} dispatched · ${unit.productName}`)
      await load()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Not dispatched',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
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

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Today's tally */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Dispatched today</div>
            <div className="mt-1 text-2xl font-semibold text-success">{history?.todayCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Awaiting dispatch</div>
            <div className="mt-1 text-2xl font-semibold text-primary">{history?.totalPending ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Scanner — camera is mounted only while scanning; a success flash replaces it
          for ~2s after each dispatch, then it reopens automatically. */}
      <ScanPanel
        flow={flow}
        title="Scan a finished-goods QR"
        hint="Point the rear camera at an FG label."
        placeholder="FG-000001"
        successSub={last ? `${last.productName} · batch ${last.batch?.batchNumber}` : undefined}
        onScan={(raw) => scan(raw)}
      />

      {/* Ready for dispatch, grouped by batch */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Boxes className="h-4 w-4" /> Ready for dispatch
            {ready ? <Badge variant="outline" className="ml-1">{ready.total}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!ready || ready.batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting — everything produced has been dispatched.</p>
          ) : (
            <ul className="divide-y">
              {ready.batches.map((b) => (
                <li key={b.batchId} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{b.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      Batch {b.batchNumber} · {b.department} ·{' '}
                      <span className="font-medium text-foreground">{b.pending} pending</span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBulkTarget(b)} disabled={busy}>
                    <Truck className="h-4 w-4" /> Dispatch all {b.pending}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
