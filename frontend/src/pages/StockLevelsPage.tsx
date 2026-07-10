import { Fragment, useCallback, useEffect, useState } from 'react'
import { Boxes, ScrollText, Search, ChevronRight, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import type {
  Department,
  Paginated,
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

export function StockLevelsPage() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="levels">
        <TabsList>
          <TabsTrigger value="levels" className="gap-1.5">
            <Boxes className="h-4 w-4" /> Live levels
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-1.5">
            <ScrollText className="h-4 w-4" /> Movement ledger
          </TabsTrigger>
        </TabsList>
        <TabsContent value="levels" className="mt-4">
          <LevelsTab />
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

      {!loading && data && data.materials.length === 0 ? (
        <EmptyState title="No stock on hand" description="Weighed units with a remaining balance will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="min-w-[180px]">Material</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">On hand</TableHead>
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
                      m.units.map((u) => (
                        <TableRow key={u.uniqueId} className="bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={2} className="font-mono text-xs">{u.uniqueId}</TableCell>
                          <TableCell className="text-right text-sm">{u.balanceKg} kg</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="text-[10px]">{u.status.replace(/_/g, ' ')}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
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
