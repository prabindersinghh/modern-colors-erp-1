import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Keyboard, Loader2, ScanLine, XCircle } from 'lucide-react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const CameraQrScanner = lazy(() =>
  import('./CameraQrScanner').then((m) => ({ default: m.CameraQrScanner })),
)

export interface RapidScanResult {
  ok: boolean
  /** Headline, e.g. "MC-000047 received". */
  title: string
  /** Supporting line, e.g. "Titanium Dioxide · 25 kg". */
  detail?: string
  /** Shown as a warning even on success (e.g. no pack weight → blocked from issue). */
  warning?: string
}

/**
 * Rapid-fire scanning for receiving and dispatch.
 *
 * A truckload can be ~2,500 sacks, so the operator must never type or click between
 * scans. The loop is: scan → ~1.5s confirmation → back to the scanner, automatically.
 *
 * Works with BOTH input paths, which behave differently:
 *  - A WiFi/USB 2D scanner acts as a keyboard: it types the code and sends Enter. The
 *    hidden input below stays focused and re-focuses itself after every scan, after any
 *    stray click, and when the tab regains focus — the operator never has to click back
 *    into the field.
 *  - The phone camera decodes continuously; the same handler receives its result.
 *
 * Errors (unknown unit, wrong prefix, already dispatched) are shown clearly but do NOT
 * stop the run — the panel returns to ready so the next sack can be scanned immediately.
 */
export function RapidScanPanel({
  title,
  hint,
  placeholder,
  onScan,
  sessionCount,
  recent,
  confirmMs = 1500,
  disabled = false,
}: {
  title: string
  hint?: string
  placeholder: string
  /** Resolve with the outcome to display. Throwing is treated as a generic failure. */
  onScan: (raw: string) => Promise<RapidScanResult>
  /** Units completed in this session — progress across a truckload. */
  sessionCount: number
  /** Most recent outcomes, newest first. */
  recent: RapidScanResult[]
  confirmMs?: number
  disabled?: boolean
}) {
  const [mode, setMode] = useState<'ready' | 'working' | 'result'>('ready')
  const [result, setResult] = useState<RapidScanResult | null>(null)
  const [useCamera, setUseCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)
  // Guards against the same code firing twice (scanner double-trigger, camera re-decode).
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const busyRef = useRef(false)

  const focusInput = useCallback(() => {
    if (useCamera || disabled) return
    // rAF so focus lands after React has committed the current render.
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [useCamera, disabled])

  const handle = useCallback(
    async (raw: string) => {
      const code = raw.trim()
      if (!code || busyRef.current) return

      const now = Date.now()
      if (code === lastRef.current.code && now - lastRef.current.at < 1200) return
      lastRef.current = { code, at: now }

      busyRef.current = true
      setMode('working')
      let outcome: RapidScanResult
      try {
        outcome = await onScan(code)
      } catch (err) {
        outcome = {
          ok: false,
          title: 'Scan failed',
          detail: err instanceof Error ? err.message : 'Please try again.',
        }
      }
      setResult(outcome)
      setMode('result')
      busyRef.current = false

      // Hold the confirmation briefly, then return to ready for the next sack.
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setMode('ready')
        setResult(null)
        focusInput()
      }, confirmMs)
    },
    [onScan, confirmMs, focusInput],
  )

  // Keep the hidden field focused so a hardware scanner always lands in it.
  useEffect(() => {
    focusInput()
    const onFocusWindow = () => focusInput()
    window.addEventListener('focus', onFocusWindow)
    return () => {
      window.removeEventListener('focus', onFocusWindow)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [focusInput])

  const isError = mode === 'result' && result && !result.ok
  const isOk = mode === 'result' && result?.ok

  return (
    <Card
      // A stray tap anywhere on the card returns focus to the scanner input.
      onClick={focusInput}
      className={cn(
        'transition-colors duration-fast',
        isOk && 'border-healthy-border bg-healthy-surface',
        isError && 'border-critical-border bg-critical-surface',
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-title-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-brand/10 text-accent-brand">
            <ScanLine className="h-4 w-4" />
          </span>
          {title}
        </CardTitle>
        <span
          className="shrink-0 rounded-full bg-chip-100 px-2.5 py-1 text-xs font-semibold tabular text-chip-700"
          aria-live="polite"
        >
          {sessionCount} scanned
        </span>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* The scan surface. Fixed height so the card never jumps between states. */}
        <div
          className={cn(
            'flex min-h-[168px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition-colors duration-fast',
            mode === 'ready' && 'border-chip-300 bg-chip-50',
            mode === 'working' && 'border-info-border bg-info-surface',
            isOk && 'border-healthy bg-healthy-surface',
            isError && 'border-critical bg-critical-surface',
          )}
          role="status"
          aria-live="polite"
        >
          {mode === 'ready' && (
            <>
              <ScanLine className="h-9 w-9 animate-breathe text-chip-400" aria-hidden="true" />
              <p className="mt-3 text-title-3 text-chip-700">Ready to scan</p>
              <p className="mt-1 text-sm text-chip-500">
                {hint ?? 'Point the scanner at the next label.'}
              </p>
            </>
          )}

          {mode === 'working' && (
            <>
              <Loader2 className="h-9 w-9 animate-spin text-info" aria-hidden="true" />
              <p className="mt-3 text-title-3 text-chip-700">Working…</p>
            </>
          )}

          {mode === 'result' && result && (
            <>
              {result.ok ? (
                <CheckCircle2 className="h-11 w-11 text-healthy" aria-hidden="true" />
              ) : (
                <XCircle className="h-11 w-11 text-critical" aria-hidden="true" />
              )}
              <p
                className={cn(
                  'mt-2.5 text-title-2',
                  result.ok ? 'text-healthy' : 'text-critical',
                )}
              >
                {result.title}
              </p>
              {result.detail && <p className="mt-1 text-sm text-chip-700">{result.detail}</p>}
              {result.warning && (
                <p className="mt-2 rounded-md bg-warning-surface px-2.5 py-1.5 text-xs font-medium text-warning-foreground">
                  {result.warning}
                </p>
              )}
            </>
          )}
        </div>

        {/* Hardware-scanner input. Visually minimal but a REAL focusable field — the
            scanner types into it and submits with its Enter keystroke. */}
        {!useCamera && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const el = inputRef.current
              if (!el) return
              const v = el.value
              el.value = ''
              void handle(v)
            }}
          >
            <label htmlFor="rapid-scan-input" className="sr-only">
              Scan or type a code
            </label>
            <Input
              id="rapid-scan-input"
              ref={inputRef}
              autoFocus
              autoComplete="off"
              inputMode="text"
              placeholder={placeholder}
              disabled={disabled}
              onBlur={() => {
                // Reclaim focus if anything steals it, so the scanner keeps working.
                if (!useCamera && !disabled) setTimeout(focusInput, 60)
              }}
              className="h-11 text-center font-mono"
            />
          </form>
        )}

        {useCamera && (
          <ErrorBoundary
            fallback={
              <div className="rounded-lg border border-warning-border bg-warning-surface p-5 text-center text-sm text-warning-foreground">
                Camera unavailable — switch back to the scanner input below.
              </div>
            }
          >
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 rounded-lg border bg-chip-50 py-10 text-sm text-chip-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading camera…
                </div>
              }
            >
              <CameraQrScanner onResult={(t) => void handle(t)} paused={mode !== 'ready'} />
            </Suspense>
          </ErrorBoundary>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setUseCamera((v) => !v)
            if (useCamera) focusInput()
          }}
          className="tactile flex min-h-11 w-full items-center justify-center gap-1.5 border-t pt-3 text-xs font-medium text-chip-500 hover:text-accent-brand"
        >
          <Keyboard className="h-3.5 w-3.5" />
          {useCamera ? 'Use the WiFi / USB scanner instead' : 'Use the phone camera instead'}
        </button>

        {/* Running log so the operator can see the last few sacks went through. */}
        {recent.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto border-t pt-2 text-xs">
            {recent.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 py-0.5">
                {r.ok ? (
                  <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-healthy" />
                ) : (
                  <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-critical" />
                )}
                <span className="min-w-0 flex-1 truncate text-chip-600">
                  <span className="font-medium text-chip-800">{r.title}</span>
                  {r.detail ? ` · ${r.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
