import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Package, Check, Printer, Trash2, ScanLine, Layers, ListPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/useToast'
import { api, ApiError, tokenStore } from '@/lib/api'
import type { PackingList, PackingUnit, FgFamily } from '@/types/api'

const familyLabel: Record<FgFamily, string> = { FINISHED_GOOD: 'Paint', HARDENER: 'Hardener', THINNER: 'Thinner' }

const phaseBadge: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: 'Draft', variant: 'secondary' },
  CONFIRMED: { label: 'Confirmed', variant: 'outline' },
  PACKED: { label: 'Packed', variant: 'default' },
  DISPATCHED: { label: 'Dispatched', variant: 'default' },
  VOIDED: { label: 'Voided', variant: 'destructive' },
}

async function openPdf(path: string, onDone?: () => void) {
  const token = tokenStore.get()
  try {
    const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new Error('print failed')
    window.open(URL.createObjectURL(await res.blob()), '_blank')
    onDone?.()
  } catch {
    toast({ variant: 'destructive', title: 'Could not open the label PDF' })
  }
}

/**
 * The packing desk — PACKER only. The factory works in LISTS: scan finished goods in,
 * compose ONE list of straights (a drum passing alone) and combos (chosen sets), then ONE
 * confirm mints a PG for every entry and one print renders all their labels together.
 */
export function PackingPage() {
  const [pool, setPool] = useState<{ toScanIn: PackingUnit[]; loose: PackingUnit[] }>({ toScanIn: [], loose: [] })
  const [lists, setLists] = useState<PackingList[]>([])
  const [loading, setLoading] = useState(true)
  const [scanId, setScanId] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [combo, setCombo] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const [p, l] = await Promise.all([
      api.get<{ toScanIn: PackingUnit[]; loose: PackingUnit[] }>('/packing/pool'),
      api.get<PackingList[]>('/packing/lists'),
    ])
    setPool(p)
    setLists(l)
    setLoading(false)
  }, [])
  useEffect(() => void refresh().catch(() => setLoading(false)), [refresh])

  const activeList = useMemo(() => lists.find((l) => l.id === activeListId) ?? null, [lists, activeListId])

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
    await run(() => api.post('/packing/scan-in', { uniqueId: id }), `${id} taken in`)
    setScanId('')
  }
  const onSeal = async () => {
    const id = scanId.trim()
    if (!id) return
    await run(() => api.post('/packing/mark-packed', { uniqueId: id }), `${id} sealed`)
    setScanId('')
  }

  const startList = () =>
    run(async () => {
      const l = await api.post<PackingList>('/packing/lists', {})
      setActiveListId(l.id)
      setCombo(new Set())
    }, 'Packing list started')

  const ensureList = async (): Promise<string | null> => {
    if (activeListId) return activeListId
    const draft = lists.find((l) => l.status === 'DRAFT')
    if (draft) { setActiveListId(draft.id); return draft.id }
    const l = await api.post<PackingList>('/packing/lists', {})
    setActiveListId(l.id)
    return l.id
  }

  const addStraight = (unitId: string) =>
    run(async () => {
      const listId = await ensureList()
      await api.post(`/packing/lists/${listId}/entries`, { uniqueIds: [unitId] })
    })

  const addCombo = () => {
    if (combo.size === 0) return
    void run(async () => {
      const listId = await ensureList()
      await api.post(`/packing/lists/${listId}/entries`, { uniqueIds: [...combo] })
      setCombo(new Set())
    }, 'Combo added')
  }

  const removeEntry = (listId: string, cartonId: string) =>
    run(() => api.del(`/packing/lists/${listId}/entries/${cartonId}`))

  const confirmList = (listId: string) =>
    run(() => api.post(`/packing/lists/${listId}/confirm`, {}), 'List confirmed — every PG minted')

  const voidEntry = (cartonId: string) => {
    const reason = window.prompt('Reason for voiding this entry? Its units return to the pool.')
    if (reason == null || !reason.trim()) return
    void run(() => api.post(`/packing/cartons/${cartonId}/void`, { reason }), 'Entry voided; units released')
  }

  const toggleCombo = (id: string) =>
    setCombo((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />

  const drafts = lists.filter((l) => l.status === 'DRAFT')
  const confirmed = lists.filter((l) => l.status === 'CONFIRMED')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title-2 font-semibold text-chip-900">Packing desk</h1>
        <p className="text-sm text-chip-600">Scan goods in, build one list of straights &amp; combos, confirm it whole.</p>
      </header>

      {/* Scan bar — take a unit in, or seal a carton (scan its PG). */}
      <Card edge="primary">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-chip-500">
              Scan a unit (FG/FGHD/FGTH) or a carton (PG) to seal
            </label>
            <div className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 shrink-0 text-chip-400" />
              <Input value={scanId} onChange={(e) => setScanId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void onScanIn()} placeholder="FG-000123" className="h-11" autoFocus />
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 gap-2" disabled={busy || !scanId.trim()} onClick={() => void onScanIn()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Take in
            </Button>
            <Button variant="outline" className="h-11 gap-2" disabled={busy || !scanId.trim()} onClick={() => void onSeal()}>
              <Check className="h-4 w-4" /> Seal (PG)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pool → build the active list. Each loose unit can go in as a straight, or be
          checked into the combo being assembled. */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-title-3">Ready to pack <span className="text-chip-500">({pool.loose.length})</span></CardTitle>
          <div className="flex gap-2">
            {combo.size > 0 && (
              <Button size="sm" className="gap-1.5" disabled={busy} onClick={addCombo}>
                <Layers className="h-4 w-4" /> Add combo ({combo.size})
              </Button>
            )}
            {!activeList && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void startList()}>
                <ListPlus className="h-4 w-4" /> New list
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {pool.loose.length === 0 ? (
            <p className="text-sm text-chip-500">Nothing scanned in yet. Scan a finished-goods unit above.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pool.loose.map((u) => (
                <li key={u.id} className={`flex items-center justify-between rounded-md border px-3 py-2 ${combo.has(u.uniqueId) ? 'border-primary bg-primary/5' : 'border-chip-200'}`}>
                  <label className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={combo.has(u.uniqueId)} onChange={() => toggleCombo(u.uniqueId)} className="h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-chip-900">{u.uniqueId}</span>
                      <span className="block truncate text-xs text-chip-500">{familyLabel[u.family]} · {u.sizePerPackage} {u.sizeUnit}</span>
                    </span>
                  </label>
                  <Button size="sm" variant="ghost" className="gap-1 whitespace-nowrap" disabled={busy} onClick={() => void addStraight(u.uniqueId)}>
                    <Plus className="h-4 w-4" /> Straight
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Draft lists — entries side by side, one confirm mints every PG. */}
      <section className="space-y-3">
        <h2 className="text-title-3 font-semibold text-chip-900">Lists in progress</h2>
        {drafts.length === 0 && <p className="text-sm text-chip-500">No open list. Add a straight or combo above to start one.</p>}
        {drafts.map((l) => (
          <Card key={l.id} edge={l.id === activeListId ? 'primary' : undefined}>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Packing list</CardTitle>
                <Badge variant="secondary">{l.cartons.length} entr{l.cartons.length === 1 ? 'y' : 'ies'}</Badge>
              </div>
              <div className="flex gap-2">
                {l.id !== activeListId && <Button size="sm" variant="outline" onClick={() => setActiveListId(l.id)}>Open</Button>}
                <Button size="sm" className="gap-1" disabled={busy || l.cartons.length === 0} onClick={() => void confirmList(l.id)}>
                  <Check className="h-4 w-4" /> Confirm list ({l.cartons.length})
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {l.cartons.length === 0 ? (
                <p className="text-sm text-chip-500">Empty. Add straights or combos from the pool.</p>
              ) : (
                l.cartons.map((c, i) => (
                  <div key={c.id} className="flex items-start justify-between rounded border border-chip-100 px-2.5 py-1.5">
                    <div className="min-w-0 text-sm">
                      <span className="font-medium">#{i + 1} · {c.items.length === 1 ? 'Straight' : `Combo (${c.items.length})`}</span>
                      <span className="ml-2 text-chip-500">{c.items.map((it) => it.finishedGood.uniqueId).join(', ')}</span>
                    </div>
                    <button className="ml-2 shrink-0 text-chip-400 hover:text-critical" disabled={busy} onClick={() => void removeEntry(l.id, c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Confirmed lists — print every label at once, seal, void/repack per entry. */}
      {confirmed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-title-3 font-semibold text-chip-900">Confirmed lists</h2>
          {confirmed.slice(0, 8).map((l) => (
            <Card key={l.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Packing list</CardTitle>
                  <Badge variant="outline">{l.cartons.length} PGs</Badge>
                </div>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => void openPdf(`/packing/lists/${l.id}/labels.pdf`, () => void refresh())}>
                  <Printer className="h-4 w-4" /> Print all labels
                </Button>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {l.cartons.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border border-chip-100 px-2.5 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{c.pg}</span>
                      <span className="ml-2 text-chip-500">{c.items.length === 1 ? 'Straight' : `Combo (${c.items.length})`} · {c.items.map((it) => it.finishedGood.uniqueId).join(', ')}</span>
                    </span>
                    <span className="ml-2 flex shrink-0 items-center gap-2">
                      <Badge variant={phaseBadge[c.phase]?.variant ?? 'secondary'}>{phaseBadge[c.phase]?.label ?? c.phase}</Badge>
                      {(c.phase === 'CONFIRMED' || c.phase === 'PACKED') && (
                        <button className="text-chip-400 hover:text-critical" disabled={busy} onClick={() => voidEntry(c.id)} title="Void this entry">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  )
}
