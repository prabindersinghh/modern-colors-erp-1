import { useEffect, useState, useCallback } from 'react'
import { Scale, CheckCircle2, WifiOff, CloudUpload, RotateCcw, ChevronLeft } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Material } from '@/types/api'
import { enqueue, pending, flush } from '@/lib/offlineQueue'
import { ScanPanel } from '@/components/scan/ScanPanel'
import { useScanFlow } from '@/components/scan/useScanFlow'

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
  const [unit, setUnit] = useState<Material | null>(null)
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(0)
  // UPI-style loop: camera → weigh → save → 2s success → camera.
  const flow = useScanFlow()

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
      flow.openDetail() // close the camera; the weigh screen takes over
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

  /** Return to the camera (Back / scan next). */
  const backToScan = () => {
    flow.backToScan()
    setUnit(null)
    setWeight('')
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
      await api.post<{ material: Material }>(
        `/receiving/${encodeURIComponent(unit.uniqueId)}/weight`,
        { weight: w, device: DEVICE },
      )
      // Brief confirmation, then the camera reopens automatically for the next unit.
      flow.finish(`${unit.uniqueId} weighed ${w} kg · ready for production`)
      setUnit(null)
      setWeight('')
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
        <div className="flex items-center gap-2 rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
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

      {/* PRIMARY: live camera QR scanning — mounted only while scanning, so the camera
          is genuinely released once a unit is picked up. */}
      {!unit && (
        <ScanPanel
          flow={flow}
          title="Scan unit QR code"
          hint="Point the rear camera at a unit's QR code."
          placeholder="MC-000001"
          successSub="Ready for the next unit"
          onScan={(raw) => scan(extractUniqueId(raw))}
        />
      )}

      {unit && (
        <Card>
          <CardHeader className="pb-3">
            {/* Back returns to the camera — wrong unit or re-scan. */}
            <button
              type="button"
              onClick={backToScan}
              className="tactile mb-2 -ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-chip-500 hover:text-chip-900"
            >
              <ChevronLeft className="h-4 w-4" /> Back to scan
            </button>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="font-mono">{unit.uniqueId}</span>
              <Badge
                variant={unit.status === 'READY_FOR_PRODUCTION' ? 'healthy' : 'secondary'}
                className="shrink-0 whitespace-nowrap"
              >
                {unit.status.replace(/_/g, ' ')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              <div className="text-title-3 text-chip-900">{unit.materialName}</div>
              <div className="text-muted-foreground">
                {unit.sku ?? '—'} · {unit.supplier ?? '—'}
              </div>
            </div>

            {unit.status === 'READY_FOR_PRODUCTION' ? (
              <div className="space-y-3">
                <div className="chip-edge flex items-center gap-2 rounded-lg border border-healthy-border bg-healthy-surface py-2.5 pl-4 pr-3 text-sm font-medium text-healthy [--chip-edge-color:hsl(var(--healthy))]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Weighed {unit.receivedWeight} — Ready for Production.
                </div>
                <Button variant="outline" className="w-full gap-1.5" onClick={backToScan}>
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
