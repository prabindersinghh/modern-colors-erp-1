import { Link } from 'react-router-dom'
import {
  Package,
  AlertTriangle,
  Factory,
  ScanLine,
  PackagePlus,
  Boxes,
  ArrowRight,
  Activity,
} from 'lucide-react'
import { useDashboard } from '@/hooks/useDashboard'
import { KpiCard } from '@/components/common/DashboardCard'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { InventoryTrendChart } from '@/components/charts/InventoryTrendChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

const kpiIcons = [Package, Package, PackagePlus, AlertTriangle, Factory, ScanLine]

const activityTypeColors: Record<string, string> = {
  inward: 'bg-success/10 text-success',
  issue: 'bg-primary/10 text-primary',
  move: 'bg-warning/10 text-warning',
  production: 'bg-purple-100 text-purple-700',
  adjustment: 'bg-muted text-muted-foreground',
}

const quickActions = [
  { to: '/material-inward', label: 'Material Inward', icon: PackagePlus },
  { to: '/inventory', label: 'View Inventory', icon: Boxes },
  { to: '/qr-scanner', label: 'Scan QR', icon: ScanLine },
  { to: '/production', label: 'Production', icon: Factory },
]

export function DashboardPage() {
  const { data, loading, error, refetch } = useDashboard()

  if (loading) return <LoadingSkeleton variant="dashboard" />
  if (error) return <ErrorState message={error} onRetry={refetch} />
  if (!data) return <EmptyState title="No dashboard data" description="Unable to load dashboard metrics." />

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((kpi, i) => (
          <KpiCard key={kpi.id} metric={kpi} icon={kpiIcons[i]} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Material Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Material Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.length === 0 ? (
              <EmptyState title="No recent activity" description="Material movements will appear here." />
            ) : (
              <div className="space-y-3">
                {data.recentActivity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <Badge
                      variant="outline"
                      className={activityTypeColors[activity.type] ?? ''}
                    >
                      {activity.type}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{activity.materialName}</div>
                      <div className="text-xs text-muted-foreground">{activity.description}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{activity.user}</span>
                        <span>·</span>
                        <span>{formatDateTime(activity.timestamp)}</span>
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      {activity.quantity} {activity.unit}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inventory Trends */}
        <InventoryTrendChart data={data.inventoryTrends} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Low Stock Alerts */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Low Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.lowStockAlerts.length === 0 ? (
              <EmptyState title="All stock levels OK" description="No materials below minimum stock." />
            ) : (
              <div className="space-y-2">
                {data.lowStockAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <div className="text-sm font-medium">{alert.materialName}</div>
                      <div className="text-xs text-muted-foreground">{alert.sku}</div>
                    </div>
                    <div className="text-right">
                      <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'}>
                        {alert.currentStock} / {alert.minStock} {alert.unit}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Production */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Factory className="h-4 w-4" />
              Today&apos;s Production
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.todaysProduction.length === 0 ? (
              <EmptyState title="No production today" description="Production batches will appear here." />
            ) : (
              <div className="space-y-2">
                {data.todaysProduction.map((order) => (
                  <div key={order.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold">{order.batchNumber}</span>
                      <Badge variant={order.status === 'in_progress' ? 'default' : 'secondary'}>
                        {order.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm">{order.paintType}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Target: {order.targetQuantity} L · {order.supervisor}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* QR Activity + Quick Actions */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              QR Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <div className="text-3xl font-bold tabular-nums">{data.qrActivityCount}</div>
              <div className="text-xs text-muted-foreground">scans today</div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Quick Actions
              </div>
              <div className="grid gap-2">
                {quickActions.map(({ to, label, icon: Icon }) => (
                  <Button key={to} variant="outline" className="justify-between" asChild>
                    <Link to={to}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {label}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
