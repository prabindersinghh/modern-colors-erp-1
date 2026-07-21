import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, TrendingDown, PackageCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { MyAnalytics, RequestStatus } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/pages/RequestsPage'
import { MovementTrend, Donut } from '@/components/charts/Charts'
import { STATUS_COLOR } from '@/components/charts/chartTheme'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { Kpi, ChartCard, Empty, DashboardSkeleton } from '@/components/dashboard/parts'
import { formatUnitTotals, kgOnly, sumByUnit } from '@/lib/units'
import { useAutoRefresh } from '@/lib/refresh'

const STATUSES: RequestStatus[] = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'PARTIAL', 'REJECTED']
const DEPT_LABEL: Record<string, string> = { PU: 'PU', ENAMEL: 'Enamel', POWDER: 'Powder' }

export function HeadDashboardPage() {
  const { user } = useAuth()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<MyAnalytics | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(
    () => api.get<MyAnalytics>(`/analytics/my?days=${days}`).then(setData).catch(() => setError(true)),
    [days],
  )
  useEffect(() => {
    setData(null)
    void load()
  }, [load])
  // The head WATCHES dispatch progress from here — keep it moving while visible.
  useAutoRefresh(load, { intervalMs: 20_000 })

  if (error) return <EmptyState title="Could not load dashboard" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="My department" />

  const statusData = STATUSES.map((s) => ({ label: s.replace('_', ' '), value: data.requestsByStatus[s] }))
  const totalReqs = STATUSES.reduce((s, k) => s + data.requestsByStatus[k], 0)
  const f = data.fulfilment
  // Percentages are a RATIO, so they only mean something within one unit — computed on
  // the kilogram slice and labelled as such. The KPI figures above show every unit.
  const reqKg = kgOnly(f.requested)
  const issuedPct = reqKg > 0 ? Math.min(100, Math.round((kgOnly(f.issued) / reqKg) * 100)) : 0
  const approvedPct = reqKg > 0 ? Math.min(100, Math.round((kgOnly(f.approved) / reqKg) * 100)) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Title lives in the Navbar (see AppLayout pageTitles). The department
            badge stays, because the navbar title is generic ("My department")
            and which department this is happens to be the most important
            context on the screen. */}
        <div className="flex flex-1 items-center gap-2">
          {user?.department && (
            <span className="rounded-full bg-accent-brand/10 px-2.5 py-1 text-label uppercase text-accent-brand">
              {DEPT_LABEL[user.department]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <WindowToggle days={days} onChange={setDays} />
          <Link to="/requests" className="tactile flex items-center gap-1 text-sm font-medium text-chip-600 hover:text-accent-brand">
            <ClipboardList className="h-4 w-4" /> My requests
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total requests" value={String(totalReqs)} sub={`${data.requestsByStatus.PENDING} pending · ${data.requestsByStatus.IN_PROGRESS} in progress`} tone="primary" />
        <Kpi label="Requested" value={formatUnitTotals(f.requested)} sub="across all my lines" tone="info" />
        <Kpi label="Approved" value={formatUnitTotals(f.approved)} sub={`${approvedPct}% of kg requested`} tone="success" />
        <Kpi label="Issued to me" value={formatUnitTotals(f.issued)} sub={`${issuedPct}% of kg requested`} tone="success" />
      </div>

      {/* Fulfilment progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <PackageCheck className="h-4 w-4" /> Fulfilment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProgressRow label="Approved vs requested (kg)" pct={approvedPct} value={`${kgOnly(f.approved)} / ${reqKg} kg`} tone="bg-primary" />
          <ProgressRow label="Issued vs requested (kg)" pct={issuedPct} value={`${kgOnly(f.issued)} / ${reqKg} kg`} tone="bg-healthy" />
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
                // Lines may be in different units — group, never blend into one number.
                const req = sumByUnit(r.items.map((i) => ({ unit: i.unit, qty: i.requestedKg })))
                const iss = sumByUnit(r.items.map((i) => ({ unit: i.unit, qty: i.issuedKg }))).filter((t) => t.total > 0)
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                    <StatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate">
                      {r.items.length} material{r.items.length === 1 ? '' : 's'} · {formatUnitTotals(req)} requested
                      {iss.length > 0 ? ` · ${formatUnitTotals(iss)} issued` : ''}
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
