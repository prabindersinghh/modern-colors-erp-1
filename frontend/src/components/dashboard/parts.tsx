import type { ReactNode } from 'react'
import { AlertTriangle, Boxes, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { LowStock } from '@/types/api'

/** Prominent low-stock alert grid (critical = red, low = amber). Shared by Admin + Store. */
export function LowStockAlerts({ lowStock }: { lowStock: LowStock }) {
  if (lowStock.alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
        <Boxes className="h-4 w-4" /> All materials above the low-stock threshold ({lowStock.thresholds.lowKg} kg).
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Low-stock alerts
        {lowStock.criticalCount > 0 && <Badge variant="destructive">{lowStock.criticalCount} critical</Badge>}
        {lowStock.lowCount > 0 && (
          <Badge className="bg-warning text-warning-foreground hover:bg-warning">{lowStock.lowCount} low</Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lowStock.alerts.map((a) => {
          const critical = a.level === 'CRITICAL'
          return (
            <div
              key={(a.sku ?? a.materialName) + a.level}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                critical ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{a.materialName}</div>
                <div className="text-xs text-muted-foreground">
                  {a.sku ?? '—'} · {a.unitCount} unit{a.unitCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className={`shrink-0 text-right ${critical ? 'text-destructive' : 'text-warning'}`}>
                <div className="text-lg font-semibold leading-none">{a.totalKg}</div>
                <div className="text-[10px] uppercase tracking-wide">kg left</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const TONE: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-success',
  info: 'text-blue-600',
  danger: 'text-destructive',
}
export function Kpi({ label, value, sub, tone = 'primary' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${TONE[tone]}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

export function ChartCard({
  title,
  icon: Icon,
  span2,
  children,
}: {
  title: string
  icon?: LucideIcon
  span2?: boolean
  children: ReactNode
}) {
  return (
    <Card className={span2 ? 'lg:col-span-2' : ''}>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {Icon && <Icon className="h-4 w-4" />} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{children}</div>
}

export function DashboardSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="h-12 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  )
}
