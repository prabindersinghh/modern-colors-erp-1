import { CheckCircle2 } from 'lucide-react'

/**
 * The brief confirmation shown between a confirmed action and the camera reopening
 * (~2s). Deliberately large and high-contrast: it is read at arm's length on a factory
 * floor, often through a glove-smudged screen.
 */
export function ScanSuccess({ message, sub }: { message: string; sub?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-success/40 bg-success/10 p-6 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success text-success-foreground shadow-lg">
        <CheckCircle2 className="h-9 w-9" />
      </div>
      <p className="text-base font-semibold text-success">{message}</p>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      <p className="text-xs text-muted-foreground">Reopening camera…</p>
    </div>
  )
}
