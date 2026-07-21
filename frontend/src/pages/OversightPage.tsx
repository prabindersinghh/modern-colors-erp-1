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
import { CompanyBrain } from '@/components/dashboard/CompanyBrain'
import { DispatchAnalytics } from '@/components/dashboard/DispatchAnalytics'
import { HandoverReadiness } from '@/components/dashboard/HandoverReadiness'
import { FgCorrectionCard } from '@/components/dashboard/FgCorrectionCard'
import { cn } from '@/lib/utils'
import { formatUnitTotals, kgOnly } from '@/lib/units'

const DEPARTMENTS: Department[] = ['PU', 'ENAMEL', 'POWDER']
const STATUSES: RequestStatus[] = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'PARTIAL', 'REJECTED']
const DEPT_LABEL: Record<Department, string> = { PU: 'PU', ENAMEL: 'Enamel', POWDER: 'Powder' }
const TXN_META: Record<StockTxnType, { icon: typeof PlusCircle; cls: string }> = {
  ADD: { icon: PlusCircle, cls: 'text-healthy' },
  DEDUCT: { icon: MinusCircle, cls: 'text-info' },
  DISCARD: { icon: Trash2, cls: 'text-destructive' },
}

export function OversightPage() {
  const [view, setView] = useState<'factory' | 'brain' | 'dispatch' | 'handover'>('brain')
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AdminAnalytics | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setData(null)
    api.get<AdminAnalytics>(`/analytics/overview?days=${days}`).then(setData).catch(() => setError(true))
  }, [days])

  // The owner's three views. Company Brain leads and is the landing view: it is the
  // one screen that answers "what came in, what got made, what went out" in a glance,
  // which is what the factory owner opens this system for.
  //
  // These branches sit ABOVE the factory-data guard below on purpose. That guard blocks
  // on /analytics/overview, which Company Brain and Dispatch do not use — leaving them
  // underneath it would make the DEFAULT view wait on a request it never reads, behind
  // a skeleton labelled for a different screen.
  const tabs = (
    <div
      role="radiogroup"
      aria-label="Oversight view"
      className="inline-flex items-center gap-0.5 rounded-lg bg-chip-100 p-0.5"
    >
      {([
        ['brain', 'Company Brain'],
        ['factory', 'Factory'],
        ['dispatch', 'Dispatch'],
        ['handover', 'Handover'],
      ] as const).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={view === k}
          onClick={() => setView(k)}
          className={cn(
            'tactile rounded-md px-3.5 py-1.5 text-xs font-semibold [@media(pointer:coarse)]:min-h-11',
            view === k ? 'bg-card text-chip-900 shadow-elev-1' : 'text-chip-500 hover:text-chip-700',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )

  if (view === 'brain') {
    return (
      <div className="space-y-4">
        {tabs}
        <CompanyBrain />
      </div>
    )
  }

  if (view === 'dispatch') {
    return (
      <div className="space-y-4">
        {tabs}
        <DispatchAnalytics />
        {/* The Admin's one write — an audited correction. See fg-corrections.spec.ts. */}
        <FgCorrectionCard />
      </div>
    )
  }

  if (view === 'handover') {
    return (
      <div className="space-y-4">
        {tabs}
        <HandoverReadiness />
      </div>
    )
  }

  if (error) return <EmptyState title="Could not load oversight" description="Please refresh to try again." />
  if (!data) return <DashboardSkeleton title="Factory oversight" />

  const statusData = STATUSES.map((s) => ({ label: s.replace('_', ' '), value: data.requestsByStatus[s] }))
  // Comparative charts are driven by the kilogram slice only — a single axis can't mix kg
  // and L. The full per-unit truth is in the headline KPIs and the Company Brain.
  const consumptionData = data.consumptionByDept.map((c) => ({ label: DEPT_LABEL[c.department], value: kgOnly(c.totals) }))
  const topData = data.topConsumed.map((m) => ({ label: m.sku ?? m.materialName.slice(0, 10), value: m.totalKg }))
  const fulfilmentData = DEPARTMENTS.map((d) => ({
    label: DEPT_LABEL[d],
    requested: kgOnly(data.fulfilment[d]?.requested),
    issued: kgOnly(data.fulfilment[d]?.issued),
  }))
  // In-hand stock, split by unit. The hero animates the primary (kg-first) figure; any
  // other unit is surfaced in the context line so nothing is hidden or blended.
  const onHand = data.snapshot.totalsByUnit
  const heroPrimary = onHand[0] ?? { unit: 'kg', total: 0 }
  const heroOther = onHand.slice(1).map((t) => `${t.total} ${t.unit}`).join(' · ')

  return (
    <div className="space-y-4">
      {tabs}
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
        value={heroPrimary.total}
        suffix={heroPrimary.unit}
        icon={Boxes}
        context={`${heroOther ? `+ ${heroOther} · ` : ''}${data.snapshot.unitCount} units · ${data.snapshot.materialCount} materials · across ${DEPARTMENTS.length} departments`}
      />

      <AgeingStockPanel ageing={data.ageing} />

      {/* Supporting KPIs. The hero above carries in-hand stock, so this row
          covers movement over the selected window. */}
      <div className="stagger grid gap-3 sm:grid-cols-3">
        <Kpi label="Added" value={formatUnitTotals(data.totals.window.ADD)} sub={`${formatUnitTotals(data.totals.today.ADD)} today · ${formatUnitTotals(data.totals.allTime.ADD)} all-time`} tone="success" />
        <Kpi label="Deducted" value={formatUnitTotals(data.totals.window.DEDUCT)} sub={`${formatUnitTotals(data.totals.today.DEDUCT)} today · ${formatUnitTotals(data.totals.allTime.DEDUCT)} all-time`} tone="info" />
        <Kpi label="Discarded" value={formatUnitTotals(data.totals.window.DISCARD)} sub={`${formatUnitTotals(data.totals.today.DISCARD)} today · ${formatUnitTotals(data.totals.allTime.DISCARD)} all-time`} tone="danger" />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Stock movement trend (kg)" icon={TrendingUp} span2>
          <MovementTrend data={data.series} />
        </ChartCard>
        <ChartCard title="Consumption by department (kg)">
          <CategoryBars data={consumptionData} colorFor={(l) => DEPT_COLOR[deptFromLabel(l)]} />
        </ChartCard>
        <ChartCard title="Requests by status">
          <Donut data={statusData} colorFor={(l) => STATUS_COLOR[l.replace(' ', '_')]} />
        </ChartCard>
        <ChartCard title="Top materials consumed (kg)">
          {topData.length ? <CategoryBars data={topData} /> : <Empty>No consumption in this window yet.</Empty>}
        </ChartCard>
        <ChartCard title="Fulfilment by department (kg)">
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
                        <span className="font-medium">{m.type} {m.quantityKg} {m.material?.stockUnit ?? 'kg'}</span>{' · '}
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
