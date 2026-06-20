import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

export interface FilterField {
  id: string
  label: string
  element: ReactNode
}

interface FilterPanelProps {
  fields: FilterField[]
  onClear?: () => void
  className?: string
}

export function FilterPanel({ fields, onClear, className }: FilterPanelProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Filters
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-primary hover:underline"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {fields.map((field) => (
          <div key={field.id} className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{field.label}</Label>
            {field.element}
          </div>
        ))}
      </div>
    </div>
  )
}
