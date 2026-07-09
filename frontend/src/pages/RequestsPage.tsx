import { useCallback, useEffect, useRef, useState } from 'react'
import { PackagePlus, Send, Search, X, ClipboardList } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type {
  CatalogueItem,
  Paginated,
  ProductionRequest,
  RequestStatus,
  RequestSummary,
} from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'

export const STATUS_STYLE: Record<RequestStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Pending', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  APPROVED: { label: 'Approved', cls: 'bg-success/15 text-success border-success/30' },
  PARTIAL: { label: 'Partially fulfilled', cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  REJECTED: { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS_STYLE[status]
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
}

export function RequestsPage() {
  const { user } = useAuth()
  const isHead = user?.role === 'PRODUCTION_HEAD'
  const [requests, setRequests] = useState<ProductionRequest[]>([])
  const [summary, setSummary] = useState<RequestSummary | null>(null)

  const load = useCallback(() => {
    api.get<Paginated<ProductionRequest>>('/production-requests?pageSize=100').then((r) => setRequests(r.data)).catch(() => {})
    api.get<RequestSummary>('/production-requests/summary').then(setSummary).catch(() => {})
  }, [])
  useEffect(() => void load(), [load])

  return (
    <div className="space-y-5">
      {isHead && <NewRequestForm onCreated={load} />}

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Pending" value={summary.byStatus.PENDING} />
          <Stat label="Approved" value={summary.byStatus.APPROVED} />
          <Stat label="Partial" value={summary.byStatus.PARTIAL} />
          <Stat label="Rejected" value={summary.byStatus.REJECTED} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">{isHead ? 'My requests' : 'All requests'}</h2>
        {requests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requests yet"
            description={isHead ? 'Raise a material request above.' : 'No production requests have been raised.'}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">S.No</TableHead>
                  {!isHead && <TableHead>Dept</TableHead>}
                  <TableHead className="min-w-[180px]">Material</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Requested (kg)</TableHead>
                  <TableHead className="text-right">Approved (kg)</TableHead>
                  <TableHead className="text-right">Issued (kg)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    {!isHead && <TableCell><Badge variant="outline">{r.department}</Badge></TableCell>}
                    <TableCell className="whitespace-normal break-words font-medium">
                      {r.materialName}
                      {r.status === 'REJECTED' && r.rejectionReason && (
                        <div className="text-xs font-normal text-destructive">Reason: {r.rejectionReason}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.sku ?? '—'}</TableCell>
                    <TableCell className="text-right">{r.requestedKg}</TableCell>
                    <TableCell className="text-right">{r.approvedKg ?? '—'}</TableCell>
                    <TableCell className="text-right">{r.issuedKg}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.createdAt.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

interface Selected {
  materialName: string
  sku: string | null
  catalogueItemId: string | null
}

/** Head-only: pick a material from the Master Catalogue + KG, then submit. */
function NewRequestForm({ onCreated }: { onCreated: () => void }) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [kg, setKg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!selected || !(Number(kg) > 0)) return
    setBusy(true)
    try {
      await api.post('/production-requests', {
        materialName: selected.materialName,
        sku: selected.sku ?? undefined,
        catalogueItemId: selected.catalogueItemId ?? undefined,
        requestedKg: Number(kg),
      })
      toast({ title: 'Request raised', description: `${kg} kg ${selected.materialName} — sent to Store.` })
      setSelected(null)
      setKg('')
      onCreated()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not raise request', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <PackagePlus className="h-4 w-4" /> Raise a material request
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>Material</Label>
            {selected ? (
              <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
                <span className="truncate">
                  {selected.materialName}
                  {selected.sku && <span className="ml-2 font-mono text-xs text-muted-foreground">{selected.sku}</span>}
                </span>
                <button type="button" onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <MaterialPicker onSelect={setSelected} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kg">Quantity (kg)</Label>
            <Input id="kg" type="number" min={0} step="any" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="e.g. 5" />
          </div>
          <Button onClick={submit} disabled={busy || !selected || !(Number(kg) > 0)} className="gap-1.5">
            <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send to Store'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Debounced Master-Catalogue search → pick a material. */
function MaterialPicker({ onSelect }: { onSelect: (s: Selected) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogueItem[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      api
        .get<Paginated<CatalogueItem>>(`/catalogue?pageSize=8&search=${encodeURIComponent(q)}`)
        .then((r) => {
          setResults(r.data)
          setOpen(true)
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search material / SKU…"
          className="pl-8"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg">
          {results.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => {
                onSelect({ materialName: it.materialName, sku: it.sku, catalogueItemId: it.id })
                setOpen(false)
                setQ('')
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="truncate">{it.materialName}</span>
              <span className="font-mono text-xs text-muted-foreground">{it.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
