import * as React from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'critical' | 'healthy' | 'info' | 'brand'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors duration-fast',
        {
          'border-transparent bg-primary text-primary-foreground': variant === 'default',
          'border-transparent bg-secondary text-secondary-foreground': variant === 'secondary',
          'border-transparent bg-destructive text-destructive-foreground': variant === 'destructive',
          'text-foreground': variant === 'outline',
          // Legacy success/warning kept pointing at the severity tokens so
          // existing callers pick up the new language without edits.
          'border-transparent bg-healthy text-healthy-foreground': variant === 'success' || variant === 'healthy',
          'border-transparent bg-warning text-warning-foreground': variant === 'warning',
          'border-transparent bg-critical text-critical-foreground': variant === 'critical',
          'border-transparent bg-info text-info-foreground': variant === 'info',
          'border-transparent bg-accent-brand text-accent-brand-foreground': variant === 'brand',
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
