import { useCallback, useEffect, useState } from 'react'
import { Plus, Check, Printer, Trash2, Layers, ListPlus, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/hooks/useToast'
import { api, ApiError, tokenStore } from '@/lib/api'
import { cn } from '@/lib/utils'
import { RapidScanPanel, type RapidScanResult } from '@/components/scan/RapidScanPanel'
import { ScanSessionBar } from '@/components/scan/ScanSessionBar'
import type { PackerBatchCard, PackerBatchDetail, PackingList, PackingUnit, FgFamily } from '@/types/api'

const DEVICE = 'web-client'
const familyLabel: Record<FgFamily, string> = { FINISHED_GOOD: 'Paint', HARDENER: 'Hardener', THINNER: 'Thinner' }

function extractUniqueId(text: string): string {
  try {
    const o = JSON.parse(text)
    if (o && typeof o.uniqueId === 'string') return o.uniqueId
  } catch { /* not JSON */ }
  return text.trim()
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
 * The packing desk — PACKER only. Two places, that's it:
 *   HOME  — FG batch cards (per-family counts + a scan-in progress bar), and a Start/Done
 *           scan session to take units into UNDER_PACKING (same system as Receive Stock).
 *   NEW LIST — compose one packed-goods list (straights + combos), confirm once (every PG
 *           minted together), print all labels. Past lists live here too.
 */
export function PackingPage() {
  const [tab, setTab] = useState<'home' | 'list'>('home')
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title-2 font-semibold text-chip-900">Packing desk</h1>
          <p className="text-sm text-chip-600">Scan finished goods in, then build a packed-goods list.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-chip-200 bg-chip-50 p-1">
          <TabButton active={tab === 'home'} onClick={() => setTab('home')} icon={Boxes}>Batches</TabButton>
          <TabButton active={tab === 'list'} onClick={() => setTab('list')} icon={ListPlus}>New List</TabButton>
        </div>
      </header>
      {tab === 'home' ? <HomeTab /> : <NewListTab />}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Boxes; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-white text-chip-900 shadow-sm' : 'text-chip-500 hover:text-chip-800')}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  )
}

// ─────────────────────────────  HOME — batch cards + scan loop  ─────────────────────────────

function HomeTab() {
  const [batches, setBatches] = useState<PackerBatchCard[] | null>(null)
  const [count, setCount] = useState(0)
  const [recent, setRecent] = useState<RapidScanResult[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => api.get<{ batches: PackerBatchCard[] }>('/packing/batches').then((r) => setBatches(r.batches)).catch(() => setBatches([])), [])
  useEffect(() => void load(), [load])

  const scanIn = async (raw: string): Promise<RapidScanResult> => {
    const id = extractUniqueId(raw)
    if (!id) return { ok: false, title: 'Empty scan' }
    try {
      const unit = await api.post<PackingUnit>('/packing/scan-in', { uniqueId: id, device: DEVICE })
      setCount((c) => c + 1)
      const res: RapidScanResult = { ok: true, title: `${unit.uniqueId} taken in`, detail: `${familyLabel[unit.family]} · ${unit.productName ?? ''}`.trim() }
      setRecent((r) => [res, ...r].slice(0, 12))
      void load() // batch bars move as he scans
      return res
    } catch (err) {
      const res: RapidScanResult = { ok: false, title: 'Not taken in', detail: err instanceof ApiError ? err.message : 'Please try again.' }
      setRecent((r) => [res, ...r].slice(0, 12))
      return res
    }
  }

  const active = (batches ?? []).filter((b) => !b.done)
  const done = (batches ?? []).filter((b) => b.done)

  return (
    <div className="space-y-5">
      <ScanSessionBar kind="PACKING" title="Packing">
        <RapidScanPanel
          title="Scan finished goods in"
          hint="Scan each FG- / FGHD- / FGTH- unit to take it into packing."
          placeholder="FG-000123"
          onScan={scanIn}
          sessionCount={count}
          recent={recent}
        />
      </ScanSessionBar>

      <section className="space-y-2">
        <h2 className="text-title-3 font-semibold text-chip-900">Batches to pack</h2>
        {batches === null ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : active.length === 0 ? (
          <p className="text-sm text-chip-500">No batches waiting. Everything produced has been scanned in.</p>
        ) : (
          active.map((b) => <BatchCard key={b.batchId} batch={b} open={open === b.batchId} onToggle={() => setOpen(open === b.batchId ? null : b.batchId)} />)
        )}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-title-3 font-semibold text-chip-500">Fully scanned in</h2>
          {done.map((b) => <BatchCard key={b.batchId} batch={b} open={open === b.batchId} onToggle={() => setOpen(open === b.batchId ? null : b.batchId)} />)}
        </section>
      )}
    </div>
  )
}

function BatchCard({ batch, open, onToggle }: { batch: PackerBatchCard; open: boolean; onToggle: () => void }) {
  const [detail, setDetail] = useState<PackerBatchDetail | null>(null)
  useEffect(() => {
    if (open && !detail) api.get<PackerBatchDetail>(`/packing/batches/${batch.batchId}`).then(setDetail).catch(() => {})
  }, [open, detail, batch.batchId])

  return (
    <Card edge={batch.done ? undefined : 'primary'}>
      <CardContent className="space-y-3 p-4">
        <button className="tactile flex w-full items-start justify-between gap-3 text-left" onClick={onToggle}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-chip-900">{batch.batchNumber}</span>
              <Badge variant="secondary">{batch.department}</Badge>
              {batch.done && <Badge variant="outline">scanned in</Badge>}
            </div>
            <p className="truncate text-sm text-chip-600">{batch.productName}</p>
            {/* Per-family counts — kg/L shown per family, never blended. */}
            <p className="mt-1 text-xs text-chip-500">
              {batch.families.map((f) => `${f.count} × ${f.size}${f.unit} ${f.label} (${f.family === 'FINISHED_GOOD' ? 'FG' : f.family === 'HARDENER' ? 'FGHD' : 'FGTH'})`).join(' · ')}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-title-3 font-semibold text-chip-900">{batch.progress}%</div>
            <div className="text-[11px] text-chip-500">{batch.scannedIn}/{batch.total} in</div>
          </div>
        </button>
        <div className="h-2 w-full overflow-hidden rounded-full bg-chip-100">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${batch.progress}%` }} />
        </div>
        {open && (
          <div className="rounded-md border border-chip-100 p-2">
            {!detail ? (
              <p className="text-xs text-chip-500">Loading units…</p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {detail.units.map((u) => (
                  <li key={u.id} className="flex items-center justify-between rounded px-2 py-1 text-xs">
                    <span className="truncate"><span className="font-medium">{u.uniqueId}</span> · {familyLabel[u.family]}</span>
                    <Badge variant={u.status === 'GENERATED' ? 'secondary' : 'outline'}>{u.status.replace('_', ' ').toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────  NEW LIST — compose + confirm + print  ─────────────────────────────

function NewListTab() {
  const [pool, setPool] = useState<{ loose: PackingUnit[] }>({ loose: [] })
  const [lists, setLists] = useState<PackingList[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [combo, setCombo] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const [p, l] = await Promise.all([
      api.get<{ toScanIn: PackingUnit[]; loose: PackingUnit[] }>('/packing/pool'),
      api.get<PackingList[]>('/packing/lists'),
    ])
    setPool({ loose: p.loose })
    setLists(l)
    setLoading(false)
  }, [])
  useEffect(() => void refresh().catch(() => setLoading(false)), [refresh])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try { await fn(); await refresh(); if (ok) toast({ title: ok }) }
    catch (e) { toast({ variant: 'destructive', title: e instanceof ApiError ? e.message : 'Something went wrong' }) }
    finally { setBusy(false) }
  }

  const ensureList = async (): Promise<string> => {
    if (activeListId) return activeListId
    const draft = lists.find((l) => l.status === 'DRAFT')
    if (draft) { setActiveListId(draft.id); return draft.id }
    const l = await api.post<PackingList>('/packing/lists', {})
    setActiveListId(l.id)
    return l.id
  }
  const addStraight = (unitId: string) => run(async () => { const id = await ensureList(); await api.post(`/packing/lists/${id}/entries`, { uniqueIds: [unitId] }) })
  const addCombo = () => { if (!combo.size) return; void run(async () => { const id = await ensureList(); await api.post(`/packing/lists/${id}/entries`, { uniqueIds: [...combo] }); setCombo(new Set()) }, 'Combo added') }
  const removeEntry = (listId: string, cartonId: string) => run(() => api.del(`/packing/lists/${listId}/entries/${cartonId}`))
  const confirmList = (listId: string) => run(() => api.post(`/packing/lists/${listId}/confirm`, {}), 'List confirmed — every PG minted')
  const voidEntry = (cartonId: string) => { const reason = window.prompt('Reason for voiding this entry? Its units return to the pool.'); if (reason == null || !reason.trim()) return; void run(() => api.post(`/packing/cartons/${cartonId}/void`, { reason }), 'Entry voided') }
  const toggleCombo = (id: string) => setCombo((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-muted" />
  const drafts = lists.filter((l) => l.status === 'DRAFT')
  const confirmed = lists.filter((l) => l.status === 'CONFIRMED')

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-title-3">Ready to pack <span className="text-chip-500">({pool.loose.length})</span></CardTitle>
          {combo.size > 0 && (
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={addCombo}><Layers className="h-4 w-4" /> Add combo ({combo.size})</Button>
          )}
        </CardHeader>
        <CardContent>
          {pool.loose.length === 0 ? (
            <p className="text-sm text-chip-500">Nothing scanned in yet. Scan units in on the <b>Batches</b> tab first.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pool.loose.map((u) => (
                <li key={u.id} className={cn('flex items-center justify-between rounded-md border px-3 py-2', combo.has(u.uniqueId) ? 'border-primary bg-primary/5' : 'border-chip-200')}>
                  <label className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={combo.has(u.uniqueId)} onChange={() => toggleCombo(u.uniqueId)} className="h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-chip-900">{u.uniqueId}</span>
                      <span className="block truncate text-xs text-chip-500">{familyLabel[u.family]} · {u.sizePerPackage} {u.sizeUnit}</span>
                    </span>
                  </label>
                  <Button size="sm" variant="ghost" className="gap-1 whitespace-nowrap" disabled={busy} onClick={() => void addStraight(u.uniqueId)}><Plus className="h-4 w-4" /> Straight</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-title-3 font-semibold text-chip-900">Lists in progress</h2>
        {drafts.length === 0 && <p className="text-sm text-chip-500">No open list. Add a straight or combo above to start one.</p>}
        {drafts.map((l) => (
          <Card key={l.id} edge={l.id === activeListId ? 'primary' : undefined}>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2"><CardTitle className="text-base">Packing list</CardTitle><Badge variant="secondary">{l.cartons.length} entr{l.cartons.length === 1 ? 'y' : 'ies'}</Badge></div>
              <div className="flex gap-2">
                {l.id !== activeListId && <Button size="sm" variant="outline" onClick={() => setActiveListId(l.id)}>Open</Button>}
                <Button size="sm" className="gap-1" disabled={busy || l.cartons.length === 0} onClick={() => void confirmList(l.id)}><Check className="h-4 w-4" /> Confirm list ({l.cartons.length})</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {l.cartons.length === 0 ? (
                <p className="text-sm text-chip-500">Empty. Add straights or combos from the pool.</p>
              ) : l.cartons.map((c, i) => (
                <div key={c.id} className="flex items-start justify-between rounded border border-chip-100 px-2.5 py-1.5">
                  <div className="min-w-0 text-sm"><span className="font-medium">#{i + 1} · {c.items.length === 1 ? 'Straight' : `Combo (${c.items.length})`}</span><span className="ml-2 text-chip-500">{c.items.map((it) => it.finishedGood.uniqueId).join(', ')}</span></div>
                  <button className="ml-2 shrink-0 text-chip-400 hover:text-critical" disabled={busy} onClick={() => void removeEntry(l.id, c.id)}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>

      {confirmed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-title-3 font-semibold text-chip-900">Confirmed lists</h2>
          {confirmed.slice(0, 8).map((l) => (
            <Card key={l.id}>
              <CardHeader className="flex-row items-center justify-between">
                <div className="flex items-center gap-2"><CardTitle className="text-base">Packing list</CardTitle><Badge variant="outline">{l.cartons.length} PGs</Badge></div>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => void openPdf(`/packing/lists/${l.id}/labels.pdf`, () => void refresh())}><Printer className="h-4 w-4" /> Print all labels</Button>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {l.cartons.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded border border-chip-100 px-2.5 py-1.5 text-sm">
                    <span className="min-w-0 truncate"><span className="font-medium">{c.pg}</span><span className="ml-2 text-chip-500">{c.items.length === 1 ? 'Straight' : `Combo (${c.items.length})`} · {c.items.map((it) => it.finishedGood.uniqueId).join(', ')}</span></span>
                    <span className="ml-2 flex shrink-0 items-center gap-2">
                      <Badge variant={c.phase === 'DISPATCHED' ? 'default' : c.phase === 'VOIDED' ? 'destructive' : 'outline'}>{c.phase.toLowerCase()}</Badge>
                      {(c.phase === 'CONFIRMED' || c.phase === 'PACKED') && (
                        <button className="text-chip-400 hover:text-critical" disabled={busy} onClick={() => voidEntry(c.id)} title="Void this entry"><Trash2 className="h-4 w-4" /></button>
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
