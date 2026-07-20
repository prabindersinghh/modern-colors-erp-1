import { type LucideIcon, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { KpiMetric } from '@/types'

interface DashboardCardProps {
  label: string
  value: string | number
  unit?: string
  icon?: LucideIcon
  change?: number
  changeLabel?: string
  trend?: 'up' | 'down' | 'neutral'
  className?: string
}

export function DashboardCard({
  label,
  value,
  unit,
  icon: Icon,
  change,
  changeLabel,
  trend = 'neutral',
  className,
}: DashboardCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <Card className={cn('border-border/60', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {(change !== undefined || changeLabel) && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <TrendIcon
              className={cn(
                'h-3 w-3',
                trend === 'up' && 'text-healthy',
                trend === 'down' && 'text-destructive'
              )}
            />
            {change !== undefined && (
              <span
                className={cn(
                  trend === 'up' && 'text-healthy',
                  trend === 'down' && 'text-destructive'
                )}
              >
                {change > 0 ? '+' : ''}
                {change}%
              </span>
            )}
            {changeLabel && <span>{changeLabel}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function KpiCard({ metric, icon }: { metric: KpiMetric; icon?: LucideIcon }) {
  return (
    <DashboardCard
      label={metric.label}
      value={metric.value}
      unit={metric.unit}
      icon={icon}
      change={metric.change}
      changeLabel={metric.changeLabel}
      trend={metric.trend}
    />
  )
}
