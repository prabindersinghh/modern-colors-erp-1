import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ScrollText,
  Boxes,
  ClipboardList,
  PackageSearch,
  MinusCircle,
  Inbox,
  TrendingUp,
  PackageCheck,
  AlertTriangle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { SlipInbox } from '@/components/dashboard/SlipInbox'
import type { StoreAnalytics } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { EmptyState } from '@/components/common/EmptyState'
import { MovementTrend, CategoryBars } from '@/components/charts/Charts'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { LowStockAlerts, AgeingStockPanel, Kpi, ChartCard, Empty, DashboardSkeleton } from '@/components/dashboard/parts'
import { formatUnitTotals } from '@/lib/units'
import { useAutoRefresh } from '@/lib/refresh'

export function StoreDashboardPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<StoreAnalytics | null>(null)
  const [provisional, setProvisional] = useState(0)
  const [error, setError] = useState(false)

  const load = useCallback(
    () => api.get<StoreAnalytics>(`/analytics/store?days=${days}`).then(setData).catch(() => setError(true)),
    [days],
  )
  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  useAutoRefresh(load)

  useEffect(() => {
    api.get<{ count: number }>('/catalogue/provisional-count').then((r) => setProvisional(r.count)).catch(() => {})
  }, [])

  if (error) return <EmptyState title="Could not load dashboard" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="Store dashboard" />

  const topData = data.topRequested.map((m) => ({ label: m.sku ?? m.materialName.slice(0, 10), value: m.totalKg }))

  return (
    <div className="space-y-4">
      {/* Inward now reaches Store as a receiving slip rather than an invoice, so this
          is the first thing on the dashboard: what the gate says has arrived. */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-title-3 text-chip-900">
          <ScrollText className="h-4 w-4 shrink-0" /> Inward — receiving slips
        </h2>
        <SlipInbox />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Title lives in the Navbar (see AppLayout pageTitles) — no duplicate h1. */}
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <WindowToggle days={days} onChange={setDays} />
          <div className="flex gap-2 text-sm">
            <Link to="/requests" className="tactile flex items-center gap-1 font-medium text-chip-600 hover:text-accent-brand">
              <ClipboardList className="h-4 w-4" /> Inbox
            </Link>
            <Link to="/stock" className="tactile flex items-center gap-1 font-medium text-chip-600 hover:text-accent-brand">
              <PackageSearch className="h-4 w-4" /> Scan
            </Link>
          </div>
        </div>
      </div>

      {/* Action-now banner: pending request queue.
          The Store's hero is deliberately NOT stock — their job is the review
          queue, so the number they should see first is what is waiting on them.
          (The owner's stock-level hero lives on the Oversight dashboard.) */}
      {data.queue.pendingLines > 0 ? (
        <Link to="/requests" className="block">
          <div className="chip-edge tactile-lift flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-brand/30 bg-accent-brand/[0.05] py-3 pl-4 pr-4 [--chip-edge-color:hsl(var(--accent-brand))]">
            <span className="flex items-center gap-2.5 text-sm font-medium text-chip-800">
              <Inbox className="h-4 w-4 shrink-0 text-accent-brand" />
              <span className="text-title-3 text-chip-900">
                <AnimatedNumber value={data.queue.pendingLines} />
              </span>
              line{data.queue.pendingLines === 1 ? '' : 's'} awaiting your review
              <span className="text-chip-500">
                across {data.queue.openRequests} open request{data.queue.openRequests === 1 ? '' : 's'}
              </span>
            </span>
            <Button size="sm">Review now</Button>
          </div>
        </Link>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-healthy/30 bg-healthy/10 px-4 py-2.5 text-sm text-healthy">
          <Inbox className="h-4 w-4" /> No requests waiting — inbox is clear.
        </div>
      )}

      {/* Provisional-SKU nudge — materials added from a PO with no official code yet. */}
      {provisional > 0 && (
        <Link
          to="/catalogue"
          className="flex items-center justify-between rounded-lg border border-warning-border bg-warning-surface px-4 py-2.5 text-sm text-warning-foreground transition-colors hover:bg-warning-surface"
        >
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {provisional} material{provisional === 1 ? '' : 's'} awaiting a real SKU
          </span>
          <span className="text-xs underline">Review in catalogue</span>
        </Link>
      )}

      <LowStockAlerts lowStock={data.lowStock} />

      <AgeingStockPanel ageing={data.ageing} />

      {/* KPIs */}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="In-hand stock" value={formatUnitTotals(data.snapshot.totalsByUnit)} sub={`${data.snapshot.unitCount} units · ${data.snapshot.materialCount} materials`} tone="primary" />
        <Kpi label="Added today" value={formatUnitTotals(data.totals.today.ADD)} sub={`${formatUnitTotals(data.totals.window.ADD)} in ${data.windowDays}d`} tone="success" />
        <Kpi label="Issued today" value={formatUnitTotals(data.totals.today.DEDUCT)} sub={`${formatUnitTotals(data.totals.window.DEDUCT)} in ${data.windowDays}d`} tone="info" />
        <Kpi label="Discarded today" value={formatUnitTotals(data.totals.today.DISCARD)} sub={`${formatUnitTotals(data.totals.window.DISCARD)} in ${data.windowDays}d`} tone="danger" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Stock movement trend (kg)" icon={TrendingUp} span2>
          <MovementTrend data={data.series} />
        </ChartCard>
        <ChartCard title="Most-requested materials (kg)" icon={PackageCheck}>
          {topData.length ? <CategoryBars data={topData} /> : <Empty>No requests in this window yet.</Empty>}
        </ChartCard>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <MinusCircle className="h-4 w-4" /> Recent issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock issued yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentIssues.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-1.5">
                    <MinusCircle className="h-4 w-4 shrink-0 text-info" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.quantityKg} {m.material?.stockUnit ?? 'kg'}</span>{' · '}
                      <span className="font-mono text-xs">{m.material?.uniqueId ?? '—'}</span>
                      {m.department ? ` · ${m.department}` : ''}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{m.createdAt.slice(5, 16).replace('T', ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/stock-levels"><Boxes className="h-4 w-4" /> Full stock levels & ledger</Link>
        </Button>
      </div>
    </div>
  )
}
