import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Package, X, Check, Printer, Trash2, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/useToast'
import { api, ApiError } from '@/lib/api'
import { tokenStore } from '@/lib/api'
import type { Carton, PackingUnit, FgFamily } from '@/types/api'

const familyLabel: Record<FgFamily, string> = {
  FINISHED_GOOD: 'Paint',
  HARDENER: 'Hardener',
  THINNER: 'Thinner',
}

const phaseBadge: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  CONFIRMED: { label: 'Confirmed — awaiting seal', variant: 'outline' },
  PACKED: { label: 'Packed', variant: 'default' },
  DISPATCHED: { label: 'Dispatched', variant: 'default' },
  VOIDED: { label: 'Voided', variant: 'destructive' },
}

/**
 * The packing desk — PACKER only.
 *
 * Scan finished goods in, group them into a carton, confirm (mints the PG and freezes the
 * contents), print the mega label, seal it (scan the PG PACKED), and void + repack a wrong
 * one. The server enforces every rule; this screen simply drives it.
 */
export function PackingPage() {
  const [pool, setPool] = useState<{ toScanIn: PackingUnit[]; loose: PackingUnit[] }>({ toScanIn: [], loose: [] })
  const [cartons, setCartons] = useState<Carton[]>([])
  const [loading, setLoading] = useState(true)
  const [scanId, setScanId] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeCartonId, setActiveCartonId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      api.get<{ toScanIn: PackingUnit[]; loose: PackingUnit[] }>('/packing/pool'),
      api.get<Carton[]>('/packing/cartons'),
    ])
    setPool(p)
    setCartons(c)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh().catch(() => setLoading(false))
  }, [refresh])

  const activeCarton = useMemo(
    () => cartons.find((c) => c.id === activeCartonId) ?? null,
    [cartons, activeCartonId],
  )

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
      if (ok) toast({ title: ok })
    } catch (e) {
      toast({ variant: 'destructive', title: e instanceof ApiError ? e.message : 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  const onScanIn = async () => {
    const id = scanId.trim()
    if (!id) return
    await run(() => api.post('/packing/scan-in', { uniqueId: id }), `${id} taken in for packing`)
    setScanId('')
  }

  const onMarkPacked = async () => {
    const id = scanId.trim()
    if (!id) return
    await run(() => api.post('/packing/mark-packed', { uniqueId: id }), `${id} sealed`)
    setScanId('')
  }

  const startCarton = () =>
    run(async () => {
      const c = await api.post<Carton>('/packing/cartons', {})
      setActiveCartonId(c.id)
    }, 'New carton started')

  const addToCarton = (unitId: string) => {
    if (!activeCarton) {
      toast({ variant: 'destructive', title: 'Start or open a draft carton first' })
      return
    }
    void run(() => api.post(`/packing/cartons/${activeCarton.id}/items`, { uniqueId: unitId }))
  }

  const removeFromCarton = (cartonId: string, fgUniqueId: string) =>
    run(() => api.del(`/packing/cartons/${cartonId}/items/${fgUniqueId}`))

  const confirmCarton = (cartonId: string) =>
    run(() => api.post(`/packing/cartons/${cartonId}/confirm`, {}), 'Carton confirmed — PG minted')

  const voidCarton = (cartonId: string) => {
    const reason = window.prompt('Reason for voiding this carton? Its units return to the pool.')
    if (reason == null || !reason.trim()) return
    void run(() => api.post(`/packing/cartons/${cartonId}/void`, { reason }), 'Carton voided; units released')
  }

  const printLabel = (cartonId: string) => {
    const token = tokenStore.get()
    // The PDF route needs the bearer token; open via fetch → blob so the header is sent.
    void (async () => {
      try {
        const res = await fetch(`/api/packing/cartons/${cartonId}/labels.pdf`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) throw new Error('print failed')
        const blob = await res.blob()
        window.open(URL.createObjectURL(blob), '_blank')
        await refresh()
      } catch {
        toast({ variant: 'destructive', title: 'Could not print the carton label' })
      }
    })()
  }

  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />

  const drafts = cartons.filter((c) => c.phase === 'DRAFT' || c.phase === 'CONFIRMED')
  const packed = cartons.filter((c) => c.phase === 'PACKED')
  const closed = cartons.filter((c) => c.phase === 'DISPATCHED' || c.phase === 'VOIDED')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title-2 font-semibold text-chip-900">Packing desk</h1>
        <p className="text-sm text-chip-600">Scan finished goods in, pack them into cartons, confirm and seal.</p>
      </header>

      {/* Scan bar — one input drives both scan-in and seal (mark-packed). */}
      <Card edge="primary">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-chip-500">
              Scan a unit (FG/FGHD/FGTH) or a carton (PG)
            </label>
            <div className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 shrink-0 text-chip-400" />
              <Input
                value={scanId}
                onChange={(e) => setScanId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onScanIn()}
                placeholder="FG-000123"
                className="h-11"
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 gap-2" disabled={busy || !scanId.trim()} onClick={() => void onScanIn()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Take in
            </Button>
            <Button variant="outline" className="h-11 gap-2" disabled={busy || !scanId.trim()} onClick={() => void onMarkPacked()}>
              <Check className="h-4 w-4" /> Seal (PG)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loose pool — units taken in, awaiting a carton. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-title-3">
            Ready to pack <span className="text-chip-500">({pool.loose.length})</span>
          </CardTitle>
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void startCarton()}>
            <Package className="h-4 w-4" /> New carton
          </Button>
        </CardHeader>
        <CardContent>
          {pool.loose.length === 0 ? (
            <p className="text-sm text-chip-500">Nothing scanned in yet. Scan a finished-goods unit above.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pool.loose.map((u) => (
                <li key={u.id} className="flex items-center justify-between rounded-md border border-chip-200 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-chip-900">{u.uniqueId}</div>
                    <div className="truncate text-xs text-chip-500">{familyLabel[u.family]} · {u.productName}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="gap-1" disabled={busy || !activeCarton} onClick={() => addToCarton(u.uniqueId)}>
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Draft / confirmed cartons. */}
      <section className="space-y-3">
        <h2 className="text-title-3 font-semibold text-chip-900">Cartons in progress</h2>
        {drafts.length === 0 && <p className="text-sm text-chip-500">No open cartons. Start one above.</p>}
        {drafts.map((c) => {
          const isActive = c.id === activeCartonId
          const isDraft = c.phase === 'DRAFT'
          return (
            <Card key={c.id} edge={isActive ? 'primary' : undefined}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{c.pg ?? 'Draft carton'}</CardTitle>
                  <Badge variant={phaseBadge[c.phase].variant}>{phaseBadge[c.phase].label}</Badge>
                  <span className="text-xs text-chip-500">{c.items.length} unit{c.items.length === 1 ? '' : 's'}</span>
                </div>
                <div className="flex gap-2">
                  {isDraft && !isActive && (
                    <Button size="sm" variant="outline" onClick={() => setActiveCartonId(c.id)}>Open</Button>
                  )}
                  {isDraft && (
                    <Button size="sm" className="gap-1" disabled={busy || c.items.length === 0} onClick={() => void confirmCarton(c.id)}>
                      <Check className="h-4 w-4" /> Confirm
                    </Button>
                  )}
                  {!isDraft && (
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => printLabel(c.id)}>
                      <Printer className="h-4 w-4" /> Label
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1 text-critical" disabled={busy} onClick={() => voidCarton(c.id)}>
                    <Trash2 className="h-4 w-4" /> Void
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {c.items.length === 0 ? (
                  <p className="text-sm text-chip-500">Empty. Add units from the pool above.</p>
                ) : (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {c.items.map((it) => (
                      <li key={it.finishedGood.id} className="flex items-center justify-between rounded border border-chip-100 px-2 py-1 text-sm">
                        <span className="truncate">
                          <span className="font-medium">{it.finishedGood.uniqueId}</span>
                          <span className="text-chip-500"> · {familyLabel[it.finishedGood.family]}</span>
                        </span>
                        {isDraft && (
                          <button className="text-chip-400 hover:text-critical" disabled={busy} onClick={() => void removeFromCarton(c.id, it.finishedGood.uniqueId)}>
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {c.phase === 'CONFIRMED' && (
                  <p className="mt-2 text-xs text-chip-500">Confirmed. Print the label, then scan {c.pg} above to seal it.</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </section>

      {/* Sealed cartons awaiting dispatch. */}
      {packed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-title-3 font-semibold text-chip-900">Sealed — awaiting dispatch</h2>
          {packed.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border border-chip-200 px-3 py-2">
              <span className="font-medium text-chip-900">{c.pg} <span className="text-xs text-chip-500">· {c.items.length} units</span></span>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => printLabel(c.id)}>
                <Printer className="h-4 w-4" /> Label
              </Button>
            </div>
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-title-3 font-semibold text-chip-900">Recent</h2>
          {closed.slice(0, 10).map((c) => (
            <div key={c.id} className="flex items-center justify-between px-1 py-1 text-sm text-chip-600">
              <span>{c.pg ?? '—'} · {c.items.length} units</span>
              <Badge variant={phaseBadge[c.phase].variant}>{phaseBadge[c.phase].label}</Badge>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
