import { useCallback, useEffect, useRef, useState } from 'react'
import { PackagePlus, Send, Search, X, ClipboardList, Plus, Trash2 } from 'lucide-react'
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
  IN_PROGRESS: { label: 'In progress', cls: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30' },
  APPROVED: { label: 'Approved', cls: 'bg-success/15 text-success border-success/30' },
  PARTIAL: { label: 'Partial', cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  REJECTED: { label: 'Rejected', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS_STYLE[status]
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Pending" value={summary.requests.byStatus.PENDING} />
          <Stat label="In progress" value={summary.requests.byStatus.IN_PROGRESS} />
          <Stat label="Approved" value={summary.requests.byStatus.APPROVED} />
          <Stat label="Partial" value={summary.requests.byStatus.PARTIAL} />
          <Stat label="Rejected" value={summary.requests.byStatus.REJECTED} />
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
          <div className="space-y-3">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} showDepartment={!isHead} />
            ))}
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

function RequestCard({ request, showDepartment }: { request: ProductionRequest; showDepartment: boolean }) {
  const totalReq = request.items.reduce((s, i) => s + i.requestedKg, 0)
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {showDepartment && <Badge variant="outline">{request.department}</Badge>}
            <span>{request.items.length} material{request.items.length === 1 ? '' : 's'}</span>
            <span className="text-muted-foreground">· {totalReq} kg requested</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {request.requestedBy?.name ?? '—'} · {request.createdAt.slice(0, 10)}
            {request.note ? ` · ${request.note}` : ''}
          </div>
        </div>
        <StatusBadge status={request.status} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="min-w-[160px]">Material</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Requested</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.items.map((it, i) => (
                <TableRow key={it.id}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="whitespace-normal break-words font-medium">
                    {it.materialName}
                    {it.status === 'REJECTED' && it.rejectionReason && (
                      <div className="text-xs font-normal text-destructive">Reason: {it.rejectionReason}</div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{it.sku ?? '—'}</TableCell>
                  <TableCell className="text-right">{it.requestedKg} kg</TableCell>
                  <TableCell className="text-right">{it.approvedKg != null ? `${it.approvedKg} kg` : '—'}</TableCell>
                  <TableCell className="text-right">{it.issuedKg} kg</TableCell>
                  <TableCell><StatusBadge status={it.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

interface Selected {
  materialName: string
  sku: string | null
  catalogueItemId: string | null
}
interface DraftLine {
  key: number
  selected: Selected | null
  kg: string
}
let lineKeySeq = 1

/** Head-only: build a multi-material request, then submit all lines at once. */
function NewRequestForm({ onCreated }: { onCreated: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, selected: null, kg: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { key: lineKeySeq++, selected: null, kg: '' }])
  const removeLine = (key: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)))

  const validLines = lines.filter((l) => l.selected && Number(l.kg) > 0)

  const submit = async () => {
    if (validLines.length === 0) return
    setBusy(true)
    try {
      await api.post('/production-requests', {
        note: note.trim() || undefined,
        items: validLines.map((l) => ({
          materialName: l.selected!.materialName,
          sku: l.selected!.sku ?? undefined,
          catalogueItemId: l.selected!.catalogueItemId ?? undefined,
          requestedKg: Number(l.kg),
        })),
      })
      toast({ title: 'Request raised', description: `${validLines.length} material${validLines.length === 1 ? '' : 's'} sent to Store.` })
      setLines([{ key: lineKeySeq++, selected: null, kg: '' }])
      setNote('')
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
        <p className="text-xs text-muted-foreground">
          Add every material this batch needs. Store reviews each line and can accept, partially fulfill, or reject it.
        </p>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 sm:grid-cols-[24px_minmax(0,1fr)_130px_36px] sm:items-center">
              <div className="text-xs text-muted-foreground">{i + 1}</div>
              {l.selected ? (
                <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
                  <span className="truncate">
                    {l.selected.materialName}
                    {l.selected.sku && <span className="ml-2 font-mono text-xs text-muted-foreground">{l.selected.sku}</span>}
                  </span>
                  <button type="button" onClick={() => setLine(l.key, { selected: null })} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <MaterialPicker onSelect={(s) => setLine(l.key, { selected: s })} />
              )}
              <Input
                type="number"
                min={0}
                step="any"
                value={l.kg}
                onChange={(e) => setLine(l.key, { kg: e.target.value })}
                placeholder="kg"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-destructive"
                onClick={() => removeLine(l.key)}
                disabled={lines.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addLine}>
          <Plus className="h-4 w-4" /> Add material
        </Button>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Batch #123" />
          </div>
          <Button onClick={submit} disabled={busy || validLines.length === 0} className="gap-1.5">
            <Send className="h-4 w-4" />
            {busy ? 'Sending…' : `Send ${validLines.length || ''} to Store`.trim()}
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
