import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, HardDrive, KeyRound, BookMarked, Eraser, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'

interface Readiness {
  generatedAt: string
  storage: { ok: boolean; driver: string }
  logins: {
    accounts: { email: string; role: string; usingDefaultPassword: boolean }[]
    total: number
    usingDefaults: number
  }
  catalogue: { total: number; active: number; provisional: number; withThresholds: number }
  flush: { wouldDelete: Record<string, number>; wouldKeep: Record<string, number> }
  blockers: string[]
}

const DELETE_LABELS: Record<string, string> = {
  finishedGoodQrs: 'FG QR codes',
  finishedGoods: 'Finished goods',
  productionOutputs: 'Production outputs',
  stockTransactions: 'Stock movements',
  requestItems: 'Request lines',
  requests: 'Production requests',
  batches: 'Batches',
  qrCodes: 'Raw-material QR codes',
  materials: 'Material units',
  poLineItems: 'PO line items',
  purchaseOrders: 'Purchase orders',
  auditEntries: 'Audit entries',
}
const KEEP_LABELS: Record<string, string> = {
  users: 'Logins',
  settings: 'Settings (incl. encrypted API key)',
  catalogueItems: 'Catalogue items',
}

/**
 * Read-only handover readiness. The flush itself deliberately stays a guarded SCRIPT
 * (prisma/flush.ts — env flag + typed phrase); this panel only answers "are we ready
 * for that day?" and previews what the flush would remove. It can cause nothing.
 */
export function HandoverReadiness() {
  const [data, setData] = useState<Readiness | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<Readiness>('/handover/readiness').then(setData).catch(() => setError(true))
  }, [])

  if (error) return <EmptyState title="Could not load readiness" description="Please refresh to try again." />
  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-lg" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    )
  }

  const ready = data.blockers.length === 0

  return (
    <div className="space-y-4">
      {/* Verdict strip */}
      <div
        className={cn(
          'chip-edge flex items-start gap-2.5 rounded-lg border py-3 pl-4 pr-4',
          ready
            ? 'border-healthy-border bg-healthy-surface text-healthy [--chip-edge-color:hsl(var(--healthy))]'
            : 'border-warning-border bg-warning-surface text-warning-foreground [--chip-edge-color:hsl(var(--warning))]',
        )}
      >
        {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="text-sm">
          <div className="font-semibold">{ready ? 'Ready for handover' : 'Not ready yet'}</div>
          {!ready && (
            <ul className="mt-0.5 list-inside list-disc">
              {data.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Storage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <HardDrive className="h-4 w-4 text-chip-400" /> File storage
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm">
            {data.storage.ok ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-healthy" /> Healthy — write→read round-trip passed
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-critical" /> Failing — check the storage token before handover
              </>
            )}
          </CardContent>
        </Card>

        {/* Passwords */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <KeyRound className="h-4 w-4 text-chip-400" /> Login passwords
              <span className="text-xs font-normal text-chip-500">
                {data.logins.usingDefaults === 0
                  ? 'all changed'
                  : `${data.logins.usingDefaults} of ${data.logins.total} still on a default`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.logins.accounts.map((a) => (
                <li key={a.email} className="flex items-center gap-2 py-1.5">
                  {a.usingDefaultPassword ? (
                    <XCircle className="h-4 w-4 shrink-0 text-critical" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-healthy" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{a.email}</span>
                  <span className="shrink-0 text-xs text-chip-500">{a.role}</span>
                  {a.usingDefaultPassword && (
                    <span className="shrink-0 text-xs font-semibold text-critical">default password</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Catalogue decision */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <BookMarked className="h-4 w-4 text-chip-400" /> Catalogue decision
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-2">
                <div className="text-metric text-chip-900">{data.catalogue.active}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-chip-500">Active SKUs</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className={cn('text-metric', data.catalogue.provisional > 0 ? 'text-brand-amber' : 'text-chip-900')}>
                  {data.catalogue.provisional}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-chip-500">Provisional</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-metric text-chip-900">{data.catalogue.withThresholds}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-chip-500">With min/max</div>
              </div>
            </div>
            <p className="text-xs text-chip-500">
              Decide before the flush: is this the factory's real SKU list (keep it), or demo data
              (flush runs with <span className="font-mono">--flush-catalogue</span>)? This cannot be
              detected automatically — it is the owner's call.
            </p>
          </CardContent>
        </Card>

        {/* Flush preview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <Eraser className="h-4 w-4 text-chip-400" /> What the flush would remove
              <span className="text-xs font-normal text-chip-500">read-only preview</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(data.flush.wouldDelete).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b py-1 last:border-0">
                  <span className="text-chip-600">{DELETE_LABELS[k] ?? k}</span>
                  <span className="tabular font-semibold text-chip-900">{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-label uppercase text-chip-500">Kept</div>
              <div className="mt-1 grid grid-cols-1 gap-y-1">
                {Object.entries(data.flush.wouldKeep).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b py-1 text-xs last:border-0">
                    <span className="text-chip-600">{KEEP_LABELS[k] ?? k}</span>
                    <span className="tabular font-semibold text-chip-900">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-chip-500">
              The flush itself runs only as a guarded script on handover day — it needs an
              environment flag <i>and</i> a typed confirmation phrase, and is deliberately not a
              button anywhere. See <span className="font-mono">docs/HANDOVER.md</span>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
