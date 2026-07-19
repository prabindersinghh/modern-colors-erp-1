import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
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
import type { StoreAnalytics } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { MovementTrend, CategoryBars } from '@/components/charts/Charts'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { LowStockAlerts, AgeingStockPanel, Kpi, ChartCard, Empty, DashboardSkeleton } from '@/components/dashboard/parts'

export function StoreDashboardPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<StoreAnalytics | null>(null)
  const [provisional, setProvisional] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    api.get<StoreAnalytics>(`/analytics/store?days=${days}`).then(setData).catch(() => setError(true))
  }, [days])

  useEffect(() => {
    api.get<{ count: number }>('/catalogue/provisional-count').then((r) => setProvisional(r.count)).catch(() => {})
  }, [])

  if (error) return <EmptyState title="Could not load dashboard" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="Store dashboard" />

  const topData = data.topRequested.map((m) => ({ label: m.sku ?? m.materialName.slice(0, 10), value: m.totalKg }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Store dashboard</h1>
        <div className="flex items-center gap-3">
          <WindowToggle days={days} onChange={setDays} />
          <div className="flex gap-2 text-sm">
            <Link to="/requests" className="flex items-center gap-1 text-primary hover:underline">
              <ClipboardList className="h-4 w-4" /> Inbox
            </Link>
            <Link to="/stock" className="flex items-center gap-1 text-primary hover:underline">
              <PackageSearch className="h-4 w-4" /> Scan
            </Link>
          </div>
        </div>
      </div>

      {/* Action-now banner: pending request queue */}
      {data.queue.pendingLines > 0 ? (
        <Link
          to="/requests"
          className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Inbox className="h-4 w-4 text-primary" />
            {data.queue.pendingLines} line{data.queue.pendingLines === 1 ? '' : 's'} awaiting your review
            <span className="text-muted-foreground">across {data.queue.openRequests} open request{data.queue.openRequests === 1 ? '' : 's'}</span>
          </span>
          <Button size="sm">Review now</Button>
        </Link>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          <Inbox className="h-4 w-4" /> No requests waiting — inbox is clear.
        </div>
      )}

      {/* Provisional-SKU nudge — materials added from a PO with no official code yet. */}
      {provisional > 0 && (
        <Link
          to="/catalogue"
          className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 transition-colors hover:bg-amber-500/20"
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="In-hand stock" value={`${data.snapshot.grandTotalKg} kg`} sub={`${data.snapshot.unitCount} units · ${data.snapshot.materialCount} materials`} tone="primary" />
        <Kpi label="Added today" value={`${data.totals.today.ADD} kg`} sub={`${data.totals.window.ADD} kg in ${data.windowDays}d`} tone="success" />
        <Kpi label="Issued today" value={`${data.totals.today.DEDUCT} kg`} sub={`${data.totals.window.DEDUCT} kg in ${data.windowDays}d`} tone="info" />
        <Kpi label="Discarded today" value={`${data.totals.today.DISCARD} kg`} sub={`${data.totals.window.DISCARD} kg in ${data.windowDays}d`} tone="danger" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Stock movement trend" icon={TrendingUp} span2>
          <MovementTrend data={data.series} />
        </ChartCard>
        <ChartCard title="Most-requested materials" icon={PackageCheck}>
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
                    <MinusCircle className="h-4 w-4 shrink-0 text-blue-600" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.quantityKg} kg</span>{' · '}
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
