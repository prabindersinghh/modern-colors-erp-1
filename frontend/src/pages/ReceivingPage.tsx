import { useCallback, useEffect, useRef, useState } from 'react'
import { WifiOff, CloudUpload, PackageCheck, Play, CheckCircle2, Printer, FileDown, Timer } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { Material } from '@/types/api'
import { enqueue, pending, flush } from '@/lib/offlineQueue'
import { RapidScanPanel, type RapidScanResult } from '@/components/scan/RapidScanPanel'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SeverityAlert } from '@/components/ui/severity'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { toast } from '@/hooks/useToast'
import { formatUnitTotals } from '@/lib/units'
import {
  buildCsv,
  buildPrintHtml,
  closeSession,
  loadSession,
  recordAlready,
  recordError,
  recordReceived,
  saveSession,
  startSession,
  type ReceivingSession,
  type SessionSummary,
} from '@/lib/receivingSession'

const DEVICE = 'web-client'

const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

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

/** A previously-received unit, returned by GET /receiving/recent (newest first). */
interface RecentReceipt {
  uniqueId: string
  materialName: string
  balanceKg: number | null
  stockUnit: string
  needsWeight: boolean
  scannedAt: string | null
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

  // ── Receiving session (Start … Done) — client-side grouping of scans into one
  // truckload with a closing summary + printable slip. Scanning NEVER requires one.
  const [session, setSession] = useState<ReceivingSession | null>(() => loadSession())
  const [resumed] = useState(() => (loadSession()?.entries.length ?? 0) > 0)
  const [label, setLabel] = useState('')
  const [finished, setFinished] = useState<{ session: ReceivingSession; summary: SessionSummary } | null>(null)
  // handleScan is called from the scanner's async loop — read the live session via a
  // ref so a scan can never update a stale one.
  const sessionRef = useRef(session)
  sessionRef.current = session
  const applySession = (fn: (s: ReceivingSession) => ReceivingSession) => {
    const cur = sessionRef.current
    if (!cur) return
    const next = fn(cur)
    sessionRef.current = next
    setSession(next)
    saveSession(next)
  }

  const begin = () => {
    const s = startSession(label)
    setLabel('')
    setFinished(null)
    setSession(s)
    saveSession(s)
  }

  const finish = () => {
    const cur = sessionRef.current
    if (!cur) return
    setFinished({ session: cur, summary: closeSession(cur) })
    setSession(null)
    saveSession(null)
  }

  const printSlip = () => {
    if (!finished) return
    // Rendered via a Blob URL (no document.write): the slip is a self-contained page
    // whose only dynamic strings are HTML-escaped in buildPrintHtml.
    const blob = new Blob([buildPrintHtml(finished.summary)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank')
    if (!w) {
      URL.revokeObjectURL(url)
      toast({ variant: 'destructive', title: 'Pop-up blocked', description: 'Allow pop-ups to print the slip.' })
      return
    }
    // Revoke once the tab has had time to load the document.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const downloadCsv = () => {
    if (!finished) return
    const blob = new Blob([buildCsv(finished.session)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `receiving-${finished.summary.startedAt.slice(0, 16).replace('T', '-').replace(':', '')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const refreshQueue = useCallback(async () => setQueued((await pending()).length), [])

  // Seed the running log with the last few units received (from the server), so opening
  // this screen — or reloading it — shows recent context instead of an empty list. The
  // in-page log otherwise only holds what THIS session scanned. Best-effort: on any
  // failure the log simply stays session-only.
  useEffect(() => {
    let cancelled = false
    api
      .get<RecentReceipt[]>('/receiving/recent?take=12')
      .then((rows) => {
        if (cancelled) return
        setRecent((prev) => {
          // Never clobber live scans if the operator has already started.
          if (prev.length > 0) return prev
          return rows.map((r) => ({
            ok: true,
            title: `${r.uniqueId} received`,
            detail: `${r.materialName} · ${r.balanceKg != null ? `${r.balanceKg} ${r.stockUnit}` : 'no weight'}`,
          }))
        })
      })
      .catch(() => {
        /* best-effort context only */
      })
    return () => {
      cancelled = true
    }
  }, [])

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
    if (!id) {
      applySession(recordError)
      return push({ ok: false, title: 'Empty scan' })
    }

    // Wrong-prefix guard: a finished-goods label scanned at receiving is a real mistake
    // worth naming, rather than a generic "unknown unit".
    if (/^FG-/i.test(id)) {
      applySession(recordError)
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
      const kg = m.balanceKg != null ? `${m.balanceKg} ${m.stockUnit}` : 'no weight'

      if (res.alreadyScanned) {
        applySession(recordAlready)
        return push({
          ok: true,
          title: `${m.uniqueId} already received`,
          detail: `${m.materialName} · ${kg}`,
        })
      }

      setCount((c) => c + 1)
      if (res.needsWeight) setBlocked((b) => b + 1)
      applySession((s) =>
        recordReceived(s, {
          uniqueId: m.uniqueId,
          materialName: m.materialName,
          qty: m.balanceKg,
          unit: m.stockUnit,
          needsWeight: !!res.needsWeight,
          queued: false,
        }),
      )

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
        applySession((s) =>
          recordReceived(s, { uniqueId: id, materialName: null, qty: null, unit: 'kg', needsWeight: false, queued: true }),
        )
        return push({
          ok: true,
          title: `${id} queued`,
          detail: 'Offline — will sync automatically.',
        })
      }
      if (err instanceof ApiError && err.status === 404) {
        applySession(recordError)
        return push({ ok: false, title: 'Unknown unit', detail: `No unit with ID ${id}.` })
      }
      applySession(recordError)
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

      {/* ── Session controls. Optional — scanning below works with or without one. ── */}
      {session ? (
        <Card className="border-healthy-border">
          <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-healthy-surface text-healthy">
              <Timer className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-chip-900">
                {session.label || 'Receiving session'}
              </div>
              <div className="text-xs text-chip-500">
                Started {fmtClock(session.startedAt)}
                {resumed ? ' · resumed after reload' : ''} ·{' '}
                <span className="font-semibold text-chip-700">{session.entries.length}</span> received in this session
              </div>
            </div>
            <Button size="sm" className="gap-1.5" onClick={finish}>
              <CheckCircle2 className="h-4 w-4" /> Done
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Truck / supplier — optional"
              className="h-10 min-w-0 flex-1"
            />
            <Button className="h-10 gap-1.5" onClick={begin}>
              <Play className="h-4 w-4" /> Start session
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Closing summary — the "further can be done" part: review, print, export. ── */}
      {finished && (
        <Card edge="primary" className="animate-fade-up">
          <CardContent className="space-y-3 p-4">
            <div>
              <div className="text-title-3 text-chip-900">
                Session done{finished.summary.label ? ` — ${finished.summary.label}` : ''}
              </div>
              <div className="text-xs text-chip-500">
                {fmtClock(finished.summary.startedAt)} → {fmtClock(finished.summary.endedAt)} ·{' '}
                {finished.summary.durationMinutes} min ·{' '}
                <span className="font-semibold text-chip-700">
                  {finished.summary.receivedCount} unit{finished.summary.receivedCount === 1 ? '' : 's'}
                </span>{' '}
                · {formatUnitTotals(finished.summary.totals)}
              </div>
            </div>

            {finished.summary.byMaterial.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {finished.summary.byMaterial.map((m) => (
                  <li key={m.materialName} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{m.materialName}</span>
                    <span className="shrink-0 text-xs text-chip-500">{m.unitCount} unit{m.unitCount === 1 ? '' : 's'}</span>
                    <span className="shrink-0 text-xs font-semibold text-chip-700">{formatUnitTotals(m.totals)}</span>
                  </li>
                ))}
              </ul>
            )}

            {(finished.summary.blockedCount > 0 ||
              finished.summary.queuedCount > 0 ||
              finished.summary.alreadyCount > 0 ||
              finished.summary.errorCount > 0) && (
              <p className="text-xs text-warning-foreground">
                {[
                  finished.summary.blockedCount > 0 ? `${finished.summary.blockedCount} without pack weight` : null,
                  finished.summary.queuedCount > 0 ? `${finished.summary.queuedCount} queued offline` : null,
                  finished.summary.alreadyCount > 0 ? `${finished.summary.alreadyCount} already received` : null,
                  finished.summary.errorCount > 0 ? `${finished.summary.errorCount} failed scans` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={printSlip}>
                <Printer className="h-4 w-4" /> Print / Save PDF
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadCsv}>
                <FileDown className="h-4 w-4" /> Download CSV
              </Button>
              <Button size="sm" className="ml-auto gap-1.5" onClick={begin}>
                <Play className="h-4 w-4" /> Start next session
              </Button>
            </div>
          </CardContent>
        </Card>
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
