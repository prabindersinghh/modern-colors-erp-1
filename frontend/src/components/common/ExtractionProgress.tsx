import { useEffect, useState } from 'react'
import { FileSearch, ScanText, ListChecks, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/brand/Logo'

/**
 * The AI-extraction wait.
 *
 * Reading an invoice takes several seconds, and a disabled button reading
 * "Extracting…" makes that feel broken. This narrates what is happening instead,
 * stepping through the stages the server actually works through.
 *
 * IMPORTANT: the steps are indicative, not a real progress feed — the API is a
 * single call with no streamed progress. They are paced to a typical extraction
 * and the last step deliberately HOLDS rather than completing, so the UI never
 * claims to be finished before the response lands. Nothing here affects the
 * request; it is presentation only.
 */
const STEPS = [
  { icon: FileSearch, label: 'Reading the document', ms: 0 },
  { icon: ScanText, label: 'Finding line items', ms: 2200 },
  { icon: ListChecks, label: 'Matching against the catalogue', ms: 5200 },
] as const

export function ExtractionProgress({ className }: { className?: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timers = STEPS.map((s, i) =>
      s.ms === 0 ? null : window.setTimeout(() => setStep(i), s.ms)
    )
    return () => timers.forEach((t) => t !== null && window.clearTimeout(t))
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'animate-fade-up rounded-xl border bg-card p-6 shadow-elev-2 sm:p-8',
        className
      )}
    >
      <div className="flex flex-col items-center text-center">
        {/* The mark orbits while we wait — brand presence instead of a spinner. */}
        <div className="relative flex h-16 w-16 items-center justify-center">
          <span
            aria-hidden="true"
            className="animate-breathe absolute inset-0 rounded-full bg-accent-brand/10"
          />
          <LogoMark className="h-10 w-10 animate-orbit" />
        </div>
        <h3 className="mt-4 text-title-3 text-chip-900">Reading your invoice</h3>
        <p className="mt-1 text-sm text-chip-500">
          This usually takes a few seconds. You can leave this open.
        </p>
      </div>

      <ol className="mx-auto mt-6 max-w-sm space-y-2.5">
        {STEPS.map((s, i) => {
          const done = i < step
          const active = i === step
          const Icon = done ? CheckCircle2 : s.icon
          return (
            <li
              key={s.label}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-base',
                done && 'border-healthy-border bg-healthy-surface text-healthy',
                active && 'border-accent-brand/30 bg-accent-brand/[0.06] text-chip-900',
                !done && !active && 'border-transparent text-chip-400'
              )}
            >
              <Icon
                className={cn('h-4 w-4 shrink-0', active && 'animate-breathe text-accent-brand')}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{s.label}</span>
              {active && (
                <span className="ml-auto flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="animate-breathe h-1.5 w-1.5 rounded-full bg-accent-brand/60"
                      style={{ animationDelay: `${d * 200}ms` }}
                    />
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {/* Indeterminate bar: honest about not knowing the remaining time. */}
      <div className="mx-auto mt-5 h-1 max-w-sm overflow-hidden rounded-full bg-chip-100">
        <div className="h-full w-1/3 animate-[mc-progress-indeterminate_1.6s_var(--ease-in-out)_infinite] rounded-full bg-accent-brand/70" />
      </div>
    </div>
  )
}
