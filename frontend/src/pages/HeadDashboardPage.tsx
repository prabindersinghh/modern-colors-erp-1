import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, TrendingDown, PackageCheck } from 'lucide-react'
import { api } from '@/lib/api'
import type { MyAnalytics, RequestStatus } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/pages/RequestsPage'
import { MovementTrend, Donut } from '@/components/charts/Charts'
import { STATUS_COLOR } from '@/components/charts/chartTheme'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { Kpi, ChartCard, Empty, DashboardSkeleton } from '@/components/dashboard/parts'

const STATUSES: RequestStatus[] = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'PARTIAL', 'REJECTED']
const DEPT_LABEL: Record<string, string> = { PU: 'PU', ENAMEL: 'Enamel', POWDER: 'Powder' }

export function HeadDashboardPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<MyAnalytics | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    api.get<MyAnalytics>(`/analytics/my?days=${days}`).then(setData).catch(() => setError(true))
  }, [days])

  if (error) return <EmptyState title="Could not load dashboard" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="My department" />

  const statusData = STATUSES.map((s) => ({ label: s.replace('_', ' '), value: data.requestsByStatus[s] }))
  const totalReqs = STATUSES.reduce((s, k) => s + data.requestsByStatus[k], 0)
  const f = data.fulfilment
  const issuedPct = f.requestedKg > 0 ? Math.min(100, Math.round((f.issuedKg / f.requestedKg) * 100)) : 0
  const approvedPct = f.requestedKg > 0 ? Math.min(100, Math.round((f.approvedKg / f.requestedKg) * 100)) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">
          {DEPT_LABEL[data.department] ?? data.department} department
        </h1>
        <div className="flex items-center gap-3">
          <WindowToggle days={days} onChange={setDays} />
          <Link to="/requests" className="flex items-center gap-1 text-sm text-primary hover:underline">
            <ClipboardList className="h-4 w-4" /> My requests
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total requests" value={String(totalReqs)} sub={`${data.requestsByStatus.PENDING} pending · ${data.requestsByStatus.IN_PROGRESS} in progress`} tone="primary" />
        <Kpi label="Requested" value={`${f.requestedKg} kg`} sub="across all my lines" tone="info" />
        <Kpi label="Approved" value={`${f.approvedKg} kg`} sub={`${approvedPct}% of requested`} tone="success" />
        <Kpi label="Issued to me" value={`${f.issuedKg} kg`} sub={`${issuedPct}% of requested`} tone="success" />
      </div>

      {/* Fulfilment progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <PackageCheck className="h-4 w-4" /> Fulfilment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressRow label="Approved vs requested" pct={approvedPct} value={`${f.approvedKg} / ${f.requestedKg} kg`} tone="bg-primary" />
          <ProgressRow label="Issued vs requested" pct={issuedPct} value={`${f.issuedKg} / ${f.requestedKg} kg`} tone="bg-success" />
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="My requests by status">
          <Donut data={statusData} colorFor={(l) => STATUS_COLOR[l.replace(' ', '_')]} />
        </ChartCard>
        <ChartCard title="My consumption trend" icon={TrendingDown}>
          {data.consumptionSeries.some((p) => p.DEDUCT > 0) ? (
            <MovementTrend data={data.consumptionSeries} keys={['DEDUCT']} />
          ) : (
            <Empty>No stock issued to your department in this window yet.</Empty>
          )}
        </ChartCard>
      </div>

      {/* Recent request history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <ClipboardList className="h-4 w-4" /> Recent requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentRequests.length === 0 ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">You haven't raised any requests yet.</p>
              <Button asChild size="sm"><Link to="/requests">Raise a request</Link></Button>
            </div>
          ) : (
            <ul className="divide-y">
              {data.recentRequests.map((r) => {
                const reqKg = r.items.reduce((s, i) => s + i.requestedKg, 0)
                const issKg = r.items.reduce((s, i) => s + i.issuedKg, 0)
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <StatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {r.items.length} material{r.items.length === 1 ? '' : 's'} · {reqKg} kg requested
                      {issKg > 0 ? ` · ${issKg} kg issued` : ''}
                      {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : ''}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.createdAt.slice(0, 10)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ProgressRow({ label, pct, value, tone }: { label: string; pct: number; value: string; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{value} · {pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
