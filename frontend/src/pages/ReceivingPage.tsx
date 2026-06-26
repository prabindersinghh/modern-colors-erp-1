import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { ScanLine, Scale, CheckCircle2, WifiOff, CloudUpload, Keyboard, RotateCcw, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Material } from '@/types/api'
import { enqueue, pending, flush } from '@/lib/offlineQueue'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

// Lazy-loaded so the QR library is only fetched on this screen.
const CameraQrScanner = lazy(() =>
  import('@/components/scan/CameraQrScanner').then((m) => ({ default: m.CameraQrScanner })),
)
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/hooks/useToast'

const DEVICE = 'web-client'

// QR payload is JSON ({ uniqueId, ... }); fall back to raw text for a plain ID.
function extractUniqueId(text: string): string {
  try {
    const o = JSON.parse(text)
    if (o && typeof o.uniqueId === 'string') return o.uniqueId
  } catch {
    /* not JSON */
  }
  return text.trim()
}

export function ReceivingPage() {
  const [scanId, setScanId] = useState('')
  const [unit, setUnit] = useState<Material | null>(null)
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)

  const refreshQueue = useCallback(async () => setQueued((await pending()).length), [])

  useEffect(() => {
    refreshQueue()
    const sync = async () => {
      const n = await flush()
      if (n > 0) toast({ title: `Synced ${n} queued action${n > 1 ? 's' : ''}` })
      refreshQueue()
    }
    void sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [refreshQueue])

  const scan = async (rawId: string) => {
    const id = rawId.trim()
    if (!id) return
    setBusy(true)
    try {
      const res = await api.post<{ material: Material; alreadyScanned: boolean }>('/receiving/scan', {
        uniqueId: id,
        device: DEVICE,
      })
      setUnit(res.material)
      setWeight(res.material.receivedWeight != null ? String(res.material.receivedWeight) : '')
      setScanId('')
      toast({
        title: res.alreadyScanned ? 'Already scanned' : 'Scanned',
        description: `${res.material.uniqueId} — ${res.material.materialName}`,
      })
    } catch (err) {
      if (err instanceof TypeError) {
        await enqueue({ kind: 'scan', uniqueId: id, device: DEVICE, clientTime: new Date().toISOString() })
        await refreshQueue()
        toast({ title: 'Offline — scan queued', description: `${id} will sync when online.` })
      } else if (err instanceof ApiError && err.status === 404) {
        toast({ variant: 'destructive', title: 'Unknown unit', description: `No unit with ID ${id}.` })
      } else {
        toast({ variant: 'destructive', title: 'Scan failed', description: err instanceof ApiError ? err.message : '' })
      }
    } finally {
      setBusy(false)
    }
  }

  const weigh = async () => {
    if (!unit) return
    const w = Number(weight)
    if (!(w > 0)) {
      toast({ variant: 'destructive', title: 'Enter a valid weight' })
      return
    }
    setBusy(true)
    try {
      const res = await api.post<{ material: Material }>(
        `/receiving/${encodeURIComponent(unit.uniqueId)}/weight`,
        { weight: w, device: DEVICE },
      )
      setUnit(res.material)
      toast({ title: 'Weight recorded', description: `${unit.uniqueId} → Ready for Production` })
    } catch (err) {
      if (err instanceof TypeError) {
        await enqueue({
          kind: 'weight',
          uniqueId: unit.uniqueId,
          weight: w,
          device: DEVICE,
          clientTime: new Date().toISOString(),
        })
        await refreshQueue()
        toast({ title: 'Offline — weight queued', description: 'Will sync when online.' })
      } else {
        toast({ variant: 'destructive', title: 'Could not save weight', description: err instanceof ApiError ? err.message : '' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {queued > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <WifiOff className="h-4 w-4" />
          {queued} action{queued > 1 ? 's' : ''} queued offline.
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1"
            onClick={async () => {
              await flush()
              await refreshQueue()
            }}
          >
            <CloudUpload className="h-4 w-4" /> Sync now
          </Button>
        </div>
      )}

      {/* PRIMARY: live camera QR scanning */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-4 w-4" /> Scan unit QR code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorBoundary
            fallback={
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                Camera scanner unavailable on this device — use manual entry below.
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
              <CameraQrScanner paused={!!unit || busy} onResult={(text) => scan(extractUniqueId(text))} />
            </Suspense>
          </ErrorBoundary>

          {/* SECONDARY: manual / USB-scanner entry */}
          {manualOpen ? (
            <form
              className="flex gap-2 border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                scan(scanId)
              }}
            >
              <Input
                placeholder="Type or USB-scan ID (MC-000001)"
                value={scanId}
                onChange={(e) => setScanId(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy || !scanId.trim()}>
                Submit
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 border-t pt-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <Keyboard className="h-3.5 w-3.5" /> Enter ID manually (USB scanner / typing)
            </button>
          )}
        </CardContent>
      </Card>

      {unit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="font-mono">{unit.uniqueId}</span>
              <Badge variant={unit.status === 'READY_FOR_PRODUCTION' ? 'default' : 'outline'}>
                {unit.status.replace(/_/g, ' ')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <div className="font-medium">{unit.materialName}</div>
              <div className="text-muted-foreground">
                {unit.sku ?? '—'} · {unit.supplier ?? '—'}
              </div>
            </div>

            {unit.status === 'READY_FOR_PRODUCTION' ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Weighed {unit.receivedWeight} — Ready for Production.
                </div>
                <Button variant="outline" className="w-full gap-1.5" onClick={() => setUnit(null)}>
                  <RotateCcw className="h-4 w-4" /> Scan next unit
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="w" className="flex items-center gap-1.5">
                  <Scale className="h-4 w-4" /> Confirmed receiving weight
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="w"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 24.8"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                  <Button onClick={weigh} disabled={busy}>
                    Save weight
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Saving the weight marks the unit Ready for Production automatically.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
