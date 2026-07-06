import { useEffect, useState } from 'react'
import { FileText, PackageCheck, ScanLine, Scale, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { DashboardSummary } from '@/types/api'
import { DashboardCard } from '@/components/common/DashboardCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorState } from '@/components/common/ErrorState'

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    api
      .get<DashboardSummary>('/dashboard/summary')
      .then(setData)
      .catch((e) => setError(e.message))
  }
  useEffect(load, [])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <LoadingSkeleton />

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <DashboardCard label="Today's Invoices" value={data.todaysPurchaseOrders} icon={FileText} />
        <DashboardCard label="Materials Received" value={data.materialsReceived.total} icon={PackageCheck} changeLabel={`${data.materialsReceived.today} today`} />
        <DashboardCard label="Pending Scanning" value={data.pendingScanning} icon={ScanLine} />
        <DashboardCard label="Pending Weighing" value={data.pendingWeighing} icon={Scale} />
        <DashboardCard label="Ready for Production" value={data.readyForProduction} icon={CheckCircle2} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatList title="Supplier-wise" rows={data.supplierStats} />
        <StatList title="Material-wise" rows={data.materialStats} />
      </div>
    </div>
  )
}

function StatList({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title} statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="truncate pr-2">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
