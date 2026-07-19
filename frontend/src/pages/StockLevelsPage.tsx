import { Fragment, useCallback, useEffect, useState } from 'react'
import { Boxes, ScrollText, Search, ChevronRight, Lock, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import type {
  Department,
  Paginated,
  StockAgeing,
  StockLevels,
  StockTransaction,
  StockTxnType,
} from '@/types/api'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/common/EmptyState'

const TYPE_CLS: Record<StockTxnType, string> = {
  ADD: 'text-success',
  DEDUCT: 'text-blue-600',
  DISCARD: 'text-destructive',
}
const DEPARTMENTS: Department[] = ['PU', 'ENAMEL', 'POWDER']
const TYPES: StockTxnType[] = ['ADD', 'DEDUCT', 'DISCARD']
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }) : '—'

export function StockLevelsPage() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="levels">
        <TabsList>
          <TabsTrigger value="levels" className="gap-1.5">
            <Boxes className="h-4 w-4" /> Live levels
          </TabsTrigger>
          <TabsTrigger value="ageing" className="gap-1.5">
            <Clock className="h-4 w-4" /> Stock ageing
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <ScrollText className="h-4 w-4" /> Movement ledger
          </TabsTrigger>
        </TabsList>
        <TabsContent value="levels" className="mt-4">
          <LevelsTab />
        </TabsContent>
        <TabsContent value="ageing" className="mt-4">
          <AgeingTab />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <LedgerTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function LevelsTab() {
  const [q, setQ] = useState('')
  const [data, setData] = useState<StockLevels | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const res = await api.get<StockLevels>(`/stock/levels${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      setData(res)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(q), 250)
    return () => clearTimeout(t)
  }, [q, load])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search material / SKU / unit" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {data && (
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.grandTotalKg} kg</span> across {data.unitCount} unit
            {data.unitCount === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Expand a material to see its units — listed oldest-first (FIFO); use the "use first" unit before newer ones.</p>

      {!loading && data && data.materials.length === 0 ? (
        <EmptyState title="No stock in hand" description="Weighed units with a remaining balance will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="min-w-[180px]">Material</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">In hand</TableHead>
                <TableHead className="text-right">Units</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.materials.map((m) => {
                const key = m.sku ?? m.materialName
                const open = expanded === key
                return (
                  <Fragment key={key}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      <TableCell>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                      </TableCell>
                      <TableCell className="font-medium">{m.materialName}</TableCell>
                      <TableCell className="font-mono text-xs">{m.sku ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">{m.totalBalanceKg} kg</TableCell>
                      <TableCell className="text-right">{m.unitCount}</TableCell>
                    </TableRow>
                    {open &&
                      m.units.map((u, ui) => {
                        const ageCls =
                          u.ageingLevel === 'RED'
                            ? 'text-destructive font-medium'
                            : u.ageingLevel === 'AMBER'
                              ? 'text-warning font-medium'
                              : 'text-muted-foreground'
                        return (
                          <TableRow key={u.uniqueId} className="bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={2}>
                              <span className="font-mono text-xs">{u.uniqueId}</span>
                              {ui === 0 && (
                                <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  use first
                                </span>
                              )}
                              <span className={`ml-2 text-[11px] ${ageCls}`}>
                                {fmtDate(u.arrivedAt)} · {u.ageDays}d
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{u.balanceKg} kg</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="text-[10px]">{u.status.replace(/_/g, ' ')}</Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Stock ageing — the plain "how old is my stock" view (30-day / 60-day buckets). */
function AgeingTab() {
  const [q, setQ] = useState('')
  const [data, setData] = useState<StockAgeing | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'ALL' | 'AMBER' | 'RED'>('ALL')

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        setData(await api.get<StockAgeing>(`/stock/ageing${q ? `?q=${encodeURIComponent(q)}` : ''}`))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const rows = (data?.units ?? []).filter((u) => (filter === 'ALL' ? true : u.level === filter))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search material / SKU / unit" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {data && (
          <div className="text-sm text-muted-foreground">
            Oldest unit: <span className="font-medium text-foreground">{data.oldestAgeDays} days</span>
          </div>
        )}
      </div>

      {/* Age buckets — click to filter */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <BucketCard
            tone="fresh" label={data.buckets.fresh.label} b={data.buckets.fresh}
            active={filter === 'ALL'} onClick={() => setFilter('ALL')}
          />
          <BucketCard
            tone="amber" label={data.buckets.amber.label} b={data.buckets.amber}
            active={filter === 'AMBER'} onClick={() => setFilter(filter === 'AMBER' ? 'ALL' : 'AMBER')}
          />
          <BucketCard
            tone="red" label={data.buckets.red.label} b={data.buckets.red}
            active={filter === 'RED'} onClick={() => setFilter(filter === 'RED' ? 'ALL' : 'RED')}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Stock held {data?.thresholds.amberDays ?? 30}+ days is flagged amber, {data?.thresholds.redDays ?? 60}+ days red.
        Oldest first — use these before newer stock.
      </p>

      {!loading && rows.length === 0 ? (
        <EmptyState title="No stock in this range" description="Nothing matches the current filter." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead className="min-w-[150px]">Material</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Supplier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u, i) => {
                const cls = u.level === 'RED' ? 'text-destructive' : u.level === 'AMBER' ? 'text-warning' : 'text-muted-foreground'
                return (
                  <TableRow key={u.uniqueId}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs">{u.uniqueId}</span>
                      {i === 0 && filter === 'ALL' && (
                        <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">use first</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {u.materialName}
                      {u.sku ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{u.sku}</span> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm">{u.balanceKg} kg</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(u.arrivedAt)}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${cls}`}>{u.ageDays}d</TableCell>
                    <TableCell className="truncate text-xs text-muted-foreground">{u.supplier ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function BucketCard({
  tone, label, b, active, onClick,
}: {
  tone: 'fresh' | 'amber' | 'red'
  label: string
  b: { unitCount: number; totalKg: number }
  active: boolean
  onClick: () => void
}) {
  const styles = {
    fresh: 'border-success/30 bg-success/5 text-success',
    amber: 'border-warning/40 bg-warning/10 text-warning',
    red: 'border-destructive/40 bg-destructive/10 text-destructive',
  }[tone]
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-all ${styles} ${active ? 'ring-2 ring-offset-1' : 'opacity-90 hover:opacity-100'}`}
    >
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{b.totalKg} kg</div>
      <div className="text-xs opacity-80">{b.unitCount} unit{b.unitCount === 1 ? '' : 's'}</div>
    </button>
  )
}

function LedgerTab() {
  const [type, setType] = useState<StockTxnType | ''>('')
  const [department, setDepartment] = useState<Department | ''>('')
  const [unitId, setUnitId] = useState('')
  const [page, setPage] = useState(1)
  const [res, setRes] = useState<Paginated<StockTransaction> | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (department) params.set('department', department)
      if (unitId.trim()) params.set('uniqueId', unitId.trim())
      params.set('page', String(page))
      const data = await api.get<Paginated<StockTransaction>>(`/stock/transactions?${params.toString()}`)
      setRes(data)
    } finally {
      setLoading(false)
    }
  }, [type, department, unitId, page])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  // Reset to page 1 when a filter changes.
  useEffect(() => setPage(1), [type, department, unitId])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        Append-only — every movement is permanent. Corrections are recorded as new entries, never edits.
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as StockTxnType)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value as Department)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <Input
          className="h-9 w-40"
          placeholder="Unit ID (MC-…)"
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
        />
      </div>

      {!loading && res && res.data.length === 0 ? (
        <EmptyState title="No movements" description="Stock movements matching these filters will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="min-w-[140px]">Material</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead className="text-right">Balance after</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res?.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {t.createdAt.slice(0, 16).replace('T', ' ')}
                  </TableCell>
                  <TableCell className={`font-medium ${TYPE_CLS[t.type]}`}>{t.type}</TableCell>
                  <TableCell className="font-mono text-xs">{t.material?.uniqueId ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {t.material?.materialName ?? '—'}
                    {t.requestItem ? <Badge variant="outline" className="ml-1 text-[10px]">request</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right">{t.quantityKg} kg</TableCell>
                  <TableCell>{t.department ?? '—'}</TableCell>
                  <TableCell className="text-right">{t.balanceAfter} kg</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.actor?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {res && res.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            className="rounded border px-2 py-1 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <span className="text-muted-foreground">
            Page {res.page} / {res.totalPages}
          </span>
          <button
            className="rounded border px-2 py-1 disabled:opacity-40"
            disabled={page >= res.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
