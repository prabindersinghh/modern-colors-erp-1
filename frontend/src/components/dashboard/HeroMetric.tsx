import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The single number the factory owner opens the system to check.
 *
 * Deliberately built as a SLOT, not a hard-coded metric: which figure matters
 * most is a business decision the owner has not made yet. To change it, edit
 * `HERO_METRIC` in OversightPage — pick a different key, and nothing else in the
 * dashboard moves. Everything below stays a normal KPI card.
 *
 * Visually this is the one place the brand is allowed to be loud: an ink panel
 * with a warm brand wash, so the owner's number is unmistakably the headline and
 * the supporting KPIs read as secondary.
 */
export function HeroMetric({
  label,
  value,
  decimals = 0,
  suffix,
  context,
  icon: Icon,
  trend,
  trendLabel,
  trendIsGood = true,
  loading = false,
  className,
}: {
  label: string
  value: number
  decimals?: number
  suffix?: string
  /** Short line under the number: what it is measuring, in plain words. */
  context?: string
  icon?: LucideIcon
  trend?: number
  trendLabel?: string
  trendIsGood?: boolean
  loading?: boolean
  className?: string
}) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border bg-chip-950 p-6 shadow-elev-2', className)}>
        <Skeleton className="h-3 w-28 bg-white/10" />
        <Skeleton className="mt-4 h-12 w-52 bg-white/10" />
        <Skeleton className="mt-4 h-3 w-40 bg-white/10" />
      </div>
    )
  }

  const dir = trend === undefined ? null : trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
  const good = dir === 'flat' || dir === null ? null : dir === 'up' ? trendIsGood : !trendIsGood
  const TrendIcon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-white/10 bg-chip-950 p-6 shadow-elev-3',
        className
      )}
    >
      {/* Brand wash — the one screen element allowed to carry real colour.
          Kept to the right so it never sits behind the number, which has to
          stay high-contrast white on ink for the owner to read at a glance. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full bg-brand-red/30 blur-3xl" />
        <div className="absolute -bottom-32 right-24 h-64 w-64 rounded-full bg-brand-amber/20 blur-3xl" />
      </div>

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label uppercase text-white/55">{label}</span>
          {Icon && <Icon className="h-4 w-4 text-white/40" aria-hidden="true" />}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          {/* Explicit size rather than the `display` token: this is the single
              largest number in the product and must dominate its row. */}
          <AnimatedNumber
            value={value}
            decimals={decimals}
            className="text-[clamp(2.75rem,7vw,4.5rem)] font-extrabold leading-none tracking-[-0.03em] text-white"
          />
          {suffix && <span className="text-2xl font-semibold text-white/55">{suffix}</span>}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {trend !== undefined && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                good === null && 'bg-white/10 text-white/70',
                good === true && 'bg-healthy/20 text-healthy',
                good === false && 'bg-critical/20 text-critical'
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden="true" />
              {trend > 0 ? '+' : ''}
              {trend.toFixed(1)}%
              {trendLabel && <span className="font-normal opacity-80"> {trendLabel}</span>}
            </span>
          )}
          {context && <span className="text-xs text-white/50">{context}</span>}
        </div>
      </div>
    </div>
  )
}
