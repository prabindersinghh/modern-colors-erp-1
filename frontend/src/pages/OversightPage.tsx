import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Boxes,
  ClipboardList,
  ArrowRight,
  PlusCircle,
  MinusCircle,
  Trash2,
  Activity,
  TrendingUp,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { AdminAnalytics, Department, RequestStatus, StockTxnType } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/pages/RequestsPage'
import { EmptyState } from '@/components/common/EmptyState'
import { MovementTrend, CategoryBars, Donut, FulfilmentBars } from '@/components/charts/Charts'
import { DEPT_COLOR, STATUS_COLOR } from '@/components/charts/chartTheme'
import { WindowToggle } from '@/components/charts/WindowToggle'
import { LowStockAlerts, AgeingStockPanel, Kpi, ChartCard, Empty, DashboardSkeleton } from '@/components/dashboard/parts'
import { HeroMetric } from '@/components/dashboard/HeroMetric'

const DEPARTMENTS: Department[] = ['PU', 'ENAMEL', 'POWDER']
const STATUSES: RequestStatus[] = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'PARTIAL', 'REJECTED']
const DEPT_LABEL: Record<Department, string> = { PU: 'PU', ENAMEL: 'Enamel', POWDER: 'Powder' }
const TXN_META: Record<StockTxnType, { icon: typeof PlusCircle; cls: string }> = {
  ADD: { icon: PlusCircle, cls: 'text-healthy' },
  DEDUCT: { icon: MinusCircle, cls: 'text-info' },
  DISCARD: { icon: Trash2, cls: 'text-destructive' },
}

export function OversightPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AdminAnalytics | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    api.get<AdminAnalytics>(`/analytics/overview?days=${days}`).then(setData).catch(() => setError(true))
  }, [days])

  if (error) return <EmptyState title="Could not load oversight" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="Factory oversight" />

  const statusData = STATUSES.map((s) => ({ label: s.replace('_', ' '), value: data.requestsByStatus[s] }))
  const consumptionData = data.consumptionByDept.map((c) => ({ label: DEPT_LABEL[c.department], value: c.deductedKg }))
  const topData = data.topConsumed.map((m) => ({ label: m.sku ?? m.materialName.slice(0, 10), value: m.totalKg }))
  const fulfilmentData = DEPARTMENTS.map((d) => ({
    label: DEPT_LABEL[d],
    requested: data.fulfilment[d]?.requestedKg ?? 0,
    issued: data.fulfilment[d]?.issuedKg ?? 0,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Title lives in the Navbar (see AppLayout pageTitles) — no duplicate h1. */}
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <WindowToggle days={days} onChange={setDays} />
          <div className="flex gap-2 text-sm">
            <Link to="/requests" className="tactile flex items-center gap-1 font-medium text-chip-600 hover:text-accent-brand">
              <ClipboardList className="h-4 w-4" /> Requests
            </Link>
            <Link to="/stock-levels" className="tactile flex items-center gap-1 font-medium text-chip-600 hover:text-accent-brand">
              <Boxes className="h-4 w-4" /> Stock
            </Link>
          </div>
        </div>
      </div>

      <LowStockAlerts lowStock={data.lowStock} />

      {/* ─────────────────────────────────────────────────────────────────
          HERO METRIC — the number the factory owner opens the system to see.

          TO CHANGE IT: edit `hero` below and nothing else. Every option is
          already present in `data`; pick the one the owner names and the
          layout, styling and animation stay exactly as they are.

            in-hand   → data.snapshot.grandTotalKg      (kg on the floor now)
            issued    → data.totals.window.DEDUCT       (kg issued this window)
            added     → data.totals.window.ADD          (kg received this window)
            discarded → data.totals.window.DISCARD      (kg wasted this window)

          Default until he confirms: in-hand stock — the figure that answers
          "what do we actually have?", which is the question this system was
          built to replace paper for.
          ───────────────────────────────────────────────────────────────── */}
      <HeroMetric
        label="In-hand stock"
        value={data.snapshot.grandTotalKg}
        suffix="kg"
        icon={Boxes}
        context={`${data.snapshot.unitCount} units · ${data.snapshot.materialCount} materials · across ${DEPARTMENTS.length} departments`}
      />

      <AgeingStockPanel ageing={data.ageing} />

      {/* Supporting KPIs. The hero above carries in-hand stock, so this row
          covers movement over the selected window. */}
      <div className="stagger grid gap-3 sm:grid-cols-3">
        <Kpi label="Added" value={`${data.totals.window.ADD} kg`} sub={`${data.totals.today.ADD} today · ${data.totals.allTime.ADD} all-time`} tone="success" />
        <Kpi label="Deducted" value={`${data.totals.window.DEDUCT} kg`} sub={`${data.totals.today.DEDUCT} today · ${data.totals.allTime.DEDUCT} all-time`} tone="info" />
        <Kpi label="Discarded" value={`${data.totals.window.DISCARD} kg`} sub={`${data.totals.today.DISCARD} today · ${data.totals.allTime.DISCARD} all-time`} tone="danger" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Stock movement trend" icon={TrendingUp} span2>
          <MovementTrend data={data.series} />
        </ChartCard>
        <ChartCard title="Consumption by department">
          <CategoryBars data={consumptionData} colorFor={(l) => DEPT_COLOR[deptFromLabel(l)]} />
        </ChartCard>
        <ChartCard title="Requests by status">
          <Donut data={statusData} colorFor={(l) => STATUS_COLOR[l.replace(' ', '_')]} />
        </ChartCard>
        <ChartCard title="Top materials consumed">
          {topData.length ? <CategoryBars data={topData} /> : <Empty>No consumption in this window yet.</Empty>}
        </ChartCard>
        <ChartCard title="Fulfilment by department">
          <FulfilmentBars data={fulfilmentData} />
        </ChartCard>
      </div>

      {/* Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Activity className="h-4 w-4" /> Recent movements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock movements yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentActivity.movements.map((m) => {
                  const Icon = TXN_META[m.type].icon
                  return (
                    <li key={m.id} className="flex items-center gap-2 py-1.5">
                      <Icon className={`h-4 w-4 shrink-0 ${TXN_META[m.type].cls}`} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{m.type} {m.quantityKg} kg</span>{' · '}
                        <span className="font-mono text-xs">{m.material?.uniqueId ?? '—'}</span>
                        {m.department ? ` · ${m.department}` : ''}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{m.createdAt.slice(5, 16).replace('T', ' ')}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <ClipboardList className="h-4 w-4" /> Recent request reviews
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentActivity.reviews.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-1.5">
                    <Badge variant="outline" className="shrink-0">{DEPT_LABEL[r.department]}</Badge>
                    <StatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.reviewedBy?.name ?? '—'}</span>
                    <Link to="/requests" className="shrink-0 font-medium text-chip-600 hover:text-accent-brand">
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function deptFromLabel(label: string): Department {
  if (label === 'Enamel') return 'ENAMEL'
  if (label === 'Powder') return 'POWDER'
  return 'PU'
}
