import { useEffect, useState } from 'react'
import { Truck, PackageCheck, Clock, Timer, Undo2, Layers } from 'lucide-react'
import { api } from '@/lib/api'
import type { DispatchAnalytics as Data } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { MovementTrend, CategoryBars, Donut } from '@/components/charts/Charts'
import { DEPT_COLOR } from '@/components/charts/chartTheme'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { ChartCard, Empty } from '@/components/dashboard/parts'
import { cn } from '@/lib/utils'

/**
 * Dispatch analytics.
 *
 * Used by BOTH the Dispatch worker's own dashboard and the Admin/Oversight view, from
 * the same endpoint — so the two can never disagree about how much left the factory.
 *
 * Scoped to finished goods only. No raw-material stock, no requests, no Phase 1 data —
 * enforced server-side in DispatchAnalyticsService, not just hidden here.
 *
 * `compact` drops the window toggle and trims the layout for embedding inside the
 * Admin dashboard, where the surrounding page already owns the period control.
 */
export function DispatchAnalytics({ compact = false }: { compact?: boolean }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    setError(false)
    api.get<Data>(`/analytics/dispatch?days=${days}`).then(setData).catch(() => setError(true))
  }, [days])

  if (error) {
    return <EmptyState title="Could not load dispatch analytics" description="Please refresh to try again." />
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-4 shadow-elev-1">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    )
  }

  const t = data.totals
  const hasHistory = data.series.some((p) => p.units > 0)
  // The trend chart is shared with the stock dashboards, which expect ADD/DEDUCT/DISCARD.
  // Dispatch has one series, so it is mapped onto the "add" slot (green = went out well).
  const trend = data.series.map((p) => ({ date: p.date, ADD: p.units, DEDUCT: 0, DISCARD: 0 }))
  const deptData = data.byDepartment.map((d) => ({ label: d.department, value: d.units }))
  const batchData = [
    { label: 'Fully out', value: data.batches.fullyDispatched },
    { label: 'Partly out', value: data.batches.partiallyDispatched },
    { label: 'Not started', value: data.batches.notStarted },
  ]

  const turnaround =
    t.avgHoursToDispatch === null
      ? null
      : t.avgHoursToDispatch < 48
        ? `${t.avgHoursToDispatch} h`
        : `${(t.avgHoursToDispatch / 24).toFixed(1)} d`

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex-1" />
          <WindowToggle days={days} onChange={setDays} />
        </div>
      )}

      {/* KPIs */}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Dispatched today"
          value={t.dispatchedToday}
          sub={`${t.dispatchedInWindow} in ${days} days · ${t.dispatchedAllTime} all time`}
          icon={Truck}
          tone="healthy"
        />
        <Kpi
          label="Ready for dispatch"
          value={t.readyForDispatch}
          sub={
            data.volume.awaitingDispatch.litres > 0
              ? `${data.volume.awaitingDispatch.litres.toLocaleString('en-IN')} L waiting`
              : data.volume.awaitingDispatch.kg > 0
                ? `${data.volume.awaitingDispatch.kg.toLocaleString('en-IN')} kg waiting`
                : 'nothing waiting'
          }
          icon={PackageCheck}
          tone={t.readyForDispatch > 0 ? 'info' : 'healthy'}
        />
        <Kpi
          label="Oldest waiting"
          value={t.oldestReadyDays ?? 0}
          unit={t.oldestReadyDays === 1 ? 'day' : 'days'}
          sub={t.oldestReadyDays === null ? 'backlog is clear' : 'since it was produced'}
          icon={Clock}
          tone={(t.oldestReadyDays ?? 0) >= 14 ? 'critical' : (t.oldestReadyDays ?? 0) >= 7 ? 'amber' : 'healthy'}
        />
        <TextKpi
          label="Avg time to dispatch"
          value={turnaround ?? '—'}
          sub={turnaround ? 'from production to leaving' : 'nothing dispatched yet in this window'}
          icon={Timer}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Units dispatched over time" icon={Truck} span2>
          {hasHistory ? (
            <MovementTrend data={trend} keys={['ADD']} />
          ) : (
            <Empty>Nothing has been dispatched in this window yet.</Empty>
          )}
        </ChartCard>

        <ChartCard title="Dispatch volume by department">
          {deptData.some((d) => d.value > 0) ? (
            <CategoryBars data={deptData} colorFor={(l) => DEPT_COLOR[l] ?? undefined} />
          ) : (
            <Empty>No dispatches by department yet.</Empty>
          )}
        </ChartCard>

        <ChartCard title="Batches by dispatch state">
          {batchData.some((b) => b.value > 0) ? (
            <Donut data={batchData} />
          ) : (
            <Empty>No batches have produced finished goods yet.</Empty>
          )}
        </ChartCard>
      </div>

      {/* Returns — scrapped vs refurbished. Zero is a healthy, visible number. */}
      <div className="stagger grid gap-3 sm:grid-cols-2">
        <Kpi
          label="Scrapped returns"
          value={data.returns.window.scrapped}
          sub={`${data.returns.allTime.scrapped} all time · written off permanently`}
          icon={Undo2}
          tone={data.returns.window.scrapped > 0 ? 'critical' : 'healthy'}
        />
        <Kpi
          label="Refurbished returns"
          value={data.returns.window.refurbished}
          sub={`${data.returns.allTime.refurbished} all time · back in sellable stock as new units`}
          icon={Undo2}
          tone={data.returns.window.refurbished > 0 ? 'amber' : 'healthy'}
        />
      </div>

      {/* FG ageing — how long finished paint sits before it ships. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-title-3">
            <Clock className="h-4 w-4 text-chip-400" /> Finished-goods ageing
            <span className="text-xs font-normal text-chip-500">
              waiting ≥{data.fgAgeing.thresholds.amberDays}d flags amber · ≥{data.fgAgeing.thresholds.redDays}d red
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-healthy-border bg-healthy-surface p-2.5">
              <div className="text-metric text-healthy">{data.fgAgeing.fresh.units}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-healthy">Fresh</div>
            </div>
            <div className="rounded-lg border border-warning-border bg-warning-surface p-2.5">
              <div className="text-metric text-warning-foreground">{data.fgAgeing.amber.units}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-warning-foreground">
                {data.fgAgeing.thresholds.amberDays}d+
              </div>
            </div>
            <div className="rounded-lg border border-critical-border bg-critical-surface p-2.5">
              <div className="text-metric text-critical">{data.fgAgeing.red.units}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-critical">
                {data.fgAgeing.thresholds.redDays}d+
              </div>
            </div>
          </div>
          {data.fgAgeing.oldest.filter((u) => u.level !== 'FRESH').length > 0 && (
            <ul className="divide-y text-sm">
              {data.fgAgeing.oldest
                .filter((u) => u.level !== 'FRESH')
                .map((u) => (
                  <li key={u.uniqueId} className="flex items-center gap-2 py-1.5">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', u.level === 'RED' ? 'bg-critical' : 'bg-warning')}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-xs text-chip-600">{u.uniqueId}</span>
                    <span className="min-w-0 flex-1 truncate">{u.productName}</span>
                    <span className="shrink-0 text-xs text-chip-500">{u.size}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs font-semibold',
                        u.level === 'RED' ? 'text-critical' : 'text-brand-amber',
                      )}
                    >
                      {u.ageDays}d
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Every dispatched good, batch-wise (window). Litres and kg stay apart. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <Layers className="h-4 w-4 text-chip-400" /> Dispatched by batch
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.dispatchedByBatch.length === 0 ? (
              <p className="text-sm text-chip-500">Nothing dispatched in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-label uppercase text-chip-500">
                      <th className="pb-2">Batch</th>
                      <th className="pb-2 text-right">Units</th>
                      <th className="pb-2 text-right">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dispatchedByBatch.map((b) => (
                      <tr key={b.batchId} className="border-b last:border-0">
                        <td className="py-2">
                          <div className="font-medium">{b.batchNumber}</div>
                          <div className="text-xs text-chip-500">
                            {b.productName} · {b.department}
                          </div>
                        </td>
                        <td className="py-2 text-right tabular">{b.units}</td>
                        <td className="py-2 text-right tabular text-xs">
                          {[b.litres > 0 ? `${b.litres.toLocaleString('en-IN')} L` : null, b.kg > 0 ? `${b.kg.toLocaleString('en-IN')} kg` : null]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-product rollup (window). */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-title-3">
              <PackageCheck className="h-4 w-4 text-chip-400" /> Dispatched by product
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.dispatchedByProduct.length === 0 ? (
              <p className="text-sm text-chip-500">Nothing dispatched in this window.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.dispatchedByProduct.map((p) => (
                  <li key={p.productName} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.productName}</span>
                    <span className="shrink-0 text-xs text-chip-500">{p.units} unit{p.units === 1 ? '' : 's'}</span>
                    <span className="shrink-0 text-xs tabular text-chip-700">
                      {[p.litres > 0 ? `${p.litres.toLocaleString('en-IN')} L` : null, p.kg > 0 ? `${p.kg.toLocaleString('en-IN')} kg` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-title-3">Recent dispatches</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-chip-500">Nothing dispatched yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.recent.map((r) => (
                <li key={r.uniqueId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
                  <span className="font-mono text-xs text-chip-600">{r.uniqueId}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.productName}</span>
                  <span className="text-xs text-chip-500">{r.size}</span>
                  {r.department && (
                    <span className="rounded-full bg-chip-100 px-2 py-0.5 text-[11px] font-semibold text-chip-600">
                      {r.department}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-chip-500">
                    {r.dispatchedAt ? r.dispatchedAt.slice(5, 16).replace('T', ' ') : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const TONE: Record<string, string> = {
  healthy: 'text-healthy [--chip-edge-color:hsl(var(--healthy))]',
  info: 'text-info [--chip-edge-color:hsl(var(--info))]',
  amber: 'text-brand-amber [--chip-edge-color:hsl(var(--brand-amber))]',
  critical: 'text-critical [--chip-edge-color:hsl(var(--critical))]',
}

function Kpi({
  label, value, unit, sub, icon: Icon, tone,
}: {
  label: string; value: number; unit?: string; sub?: string
  icon: typeof Truck; tone: keyof typeof TONE
}) {
  return (
    <div className={cn('chip-edge tactile-lift rounded-lg border bg-card p-4 pl-5 shadow-elev-1', TONE[tone])}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-label uppercase text-chip-500">{label}</span>
        <Icon className="h-4 w-4 shrink-0 opacity-40" aria-hidden="true" />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <AnimatedNumber value={value} className="text-metric text-chip-900" />
        {unit && <span className="text-sm font-medium text-chip-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-chip-500">{sub}</div>}
    </div>
  )
}

function TextKpi({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: typeof Truck }) {
  return (
    <div className="chip-edge tactile-lift rounded-lg border bg-card p-4 pl-5 shadow-elev-1 [--chip-edge-color:hsl(var(--brand-violet))]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-label uppercase text-chip-500">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-brand-violet opacity-40" aria-hidden="true" />
      </div>
      <div className={cn('mt-1.5 text-metric', value === '—' ? 'text-chip-300' : 'text-chip-900')}>
        {value === '—' ? <span className="text-xl">Not yet</span> : value}
      </div>
      {sub && <div className="mt-1 text-xs text-chip-500">{sub}</div>}
    </div>
  )
}
