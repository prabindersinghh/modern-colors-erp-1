import { type LucideIcon, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('animate-fade-up flex flex-col items-center justify-center py-14 text-center', className)}>
      {/* Ringed icon on a warm chip, so an empty screen still feels designed
          rather than unfinished. */}
      <div className="mb-4 rounded-full bg-chip-100 p-4 ring-1 ring-chip-200">
        <Icon className="h-7 w-7 text-chip-400" />
      </div>
      <h3 className="text-title-3 text-chip-800">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-chip-500">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
