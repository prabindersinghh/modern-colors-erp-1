import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Keyboard, Loader2, ScanLine } from 'lucide-react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScanSuccess } from './ScanSuccess'
import type { ScanFlow } from './useScanFlow'

const CameraQrScanner = lazy(() =>
  import('./CameraQrScanner').then((m) => ({ default: m.CameraQrScanner })),
)

/**
 * The scan half of a scanning screen: live camera while `flow.isScanning`, the brief
 * success confirmation while `flow.mode === 'success'`, plus the manual/USB-scanner
 * fallback. Rendering the camera CONDITIONALLY (not merely paused) is what releases the
 * device camera between scans.
 */
export function ScanPanel({
  flow,
  title = 'Scan a QR code',
  hint,
  placeholder = 'MC-000001',
  successSub,
  onScan,
}: {
  flow: ScanFlow
  title?: string
  hint?: string
  /** Manual-entry placeholder (hardware scanners type here and press Enter). */
  placeholder?: string
  successSub?: string
  /** Called with the raw decoded text (camera) or the typed value (manual). */
  onScan: (raw: string) => void
}) {
  const [manual, setManual] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // After the success flash the loop returns to scanning; if the operator is using a
  // hardware scanner (manual field open), refocus it so the next scan just works.
  useEffect(() => {
    if (flow.isScanning && manualOpen) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50)
      return () => window.clearTimeout(t)
    }
  }, [flow.isScanning, manualOpen])

  if (flow.mode === 'success' && flow.successText) {
    return (
      <Card>
        <CardContent className="p-4">
          <ScanSuccess message={flow.successText} sub={successSub} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorBoundary
          fallback={
            <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Camera unavailable on this device — use manual entry below.
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/30 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading scanner…
              </div>
            }
          >
            {/* Mounted only while scanning — unmounting stops + releases the camera. */}
            <CameraQrScanner onResult={onScan} />
          </Suspense>
        </ErrorBoundary>

        {hint && <p className="text-center text-xs text-muted-foreground">{hint}</p>}

        {manualOpen ? (
          <form
            className="flex gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              const v = manual.trim()
              if (!v) return
              setManual('')
              onScan(v)
            }}
          >
            <Input
              ref={inputRef}
              autoFocus
              placeholder={placeholder}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              className="h-11"
            />
            <Button type="submit" variant="outline" className="h-11" disabled={!manual.trim()}>
              Go
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 border-t pt-3 text-xs text-muted-foreground hover:text-foreground"
          >
            <Keyboard className="h-3.5 w-3.5" /> Enter code manually (USB scanner / typing)
          </button>
        )}
      </CardContent>
    </Card>
  )
}
