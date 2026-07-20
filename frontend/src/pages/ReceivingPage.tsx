import { useCallback, useEffect, useState } from 'react'
import { WifiOff, CloudUpload, PackageCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Material } from '@/types/api'
import { enqueue, pending, flush } from '@/lib/offlineQueue'
import { RapidScanPanel, type RapidScanResult } from '@/components/scan/RapidScanPanel'
import { Card, CardContent } from '@/components/ui/card'
import { SeverityAlert } from '@/components/ui/severity'
import { AnimatedNumber } from '@/components/ui/animated-number'
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

interface ScanResponse {
  material: Material
  alreadyScanned: boolean
  /** Server flag: this unit has no pack weight, so it is blocked from being issued. */
  needsWeight?: boolean
}

/**
 * Receiving — rapid-fire scanning, no weighing.
 *
 * A truckload can be ~2,500 sacks. Typing a weight per sack made receiving take days,
 * so weighing was removed here entirely: a unit's opening stock balance now comes from
 * the PO's per-package weight, applied when the unit is registered. Scanning is the
 * only action on the floor.
 *
 * Weighing still happens where the exact figure genuinely matters — Store → Production
 * issue, which is untouched.
 */
export function ReceivingPage() {
  const [queued, setQueued] = useState(0)
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<RapidScanResult[]>([])
  const [blocked, setBlocked] = useState(0)

  const refreshQueue = useCallback(async () => setQueued((await pending()).length), [])

  useEffect(() => {
    refreshQueue()
    const sync = async () => {
      const n = await flush()
      if (n > 0) toast({ title: `Synced ${n} queued scan${n > 1 ? 's' : ''}` })
      refreshQueue()
    }
    void sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [refreshQueue])

  const push = (r: RapidScanResult) => {
    setRecent((prev) => [r, ...prev].slice(0, 12))
    return r
  }

  const handleScan = async (raw: string): Promise<RapidScanResult> => {
    const id = extractUniqueId(raw)
    if (!id) return push({ ok: false, title: 'Empty scan' })

    // Wrong-prefix guard: a finished-goods label scanned at receiving is a real mistake
    // worth naming, rather than a generic "unknown unit".
    if (/^FG-/i.test(id)) {
      return push({
        ok: false,
        title: 'Finished-goods label',
        detail: `${id} belongs at Dispatch, not receiving.`,
      })
    }

    try {
      const res = await api.post<ScanResponse>('/receiving/scan', {
        uniqueId: id,
        device: DEVICE,
      })
      const m = res.material
      const kg = m.balanceKg != null ? `${m.balanceKg} kg` : 'no weight'

      if (res.alreadyScanned) {
        return push({
          ok: true,
          title: `${m.uniqueId} already received`,
          detail: `${m.materialName} · ${kg}`,
        })
      }

      setCount((c) => c + 1)
      if (res.needsWeight) setBlocked((b) => b + 1)

      return push({
        ok: true,
        title: `${m.uniqueId} received`,
        detail: `${m.materialName} · ${kg}`,
        warning: res.needsWeight
          ? 'No pack weight on the invoice — this unit cannot be issued until the pack weight is set on its PO.'
          : undefined,
      })
    } catch (err) {
      // Offline: queue and keep the line moving. The operator must not have to stop
      // scanning a truckload because the factory WiFi dropped.
      if (err instanceof TypeError) {
        await enqueue({
          kind: 'scan',
          uniqueId: id,
          device: DEVICE,
          clientTime: new Date().toISOString(),
        })
        await refreshQueue()
        setCount((c) => c + 1)
        return push({
          ok: true,
          title: `${id} queued`,
          detail: 'Offline — will sync automatically.',
        })
      }
      if (err instanceof ApiError && err.status === 404) {
        return push({ ok: false, title: 'Unknown unit', detail: `No unit with ID ${id}.` })
      }
      return push({
        ok: false,
        title: 'Scan failed',
        detail: err instanceof ApiError ? err.message : 'Please try again.',
      })
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {queued > 0 && (
        <SeverityAlert
          severity="warning"
          title={`${queued} scan${queued > 1 ? 's' : ''} waiting to sync`}
          detail="They will upload automatically when the connection returns."
        />
      )}

      {blocked > 0 && (
        <SeverityAlert
          severity="warning"
          title={`${blocked} unit${blocked > 1 ? 's' : ''} received without a pack weight`}
          detail="Received, but blocked from being issued to production until the pack weight is set on their purchase order."
        />
      )}

      <RapidScanPanel
        title="Scan to receive"
        hint="Scan each sack in turn — no typing, no weighing."
        placeholder="MC-000001"
        onScan={handleScan}
        sessionCount={count}
        recent={recent}
      />

      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-healthy-surface text-healthy">
              <PackageCheck className="h-4 w-4" />
            </span>
            <div>
              <div className="text-label uppercase text-chip-500">Received this session</div>
              <div className="text-metric text-chip-900">
                <AnimatedNumber value={count} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-chip-500">
            {queued > 0 ? (
              <>
                <WifiOff className="h-3.5 w-3.5" /> {queued} queued
              </>
            ) : (
              <>
                <CloudUpload className="h-3.5 w-3.5" /> All synced
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
