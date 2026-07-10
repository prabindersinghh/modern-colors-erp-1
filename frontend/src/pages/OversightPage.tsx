import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, ClipboardList, ArrowRight, PlusCircle, MinusCircle, Trash2, Activity } from 'lucide-react'
import { api } from '@/lib/api'
import type { Department, Overview, RequestStatus, StockTxnType } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/pages/RequestsPage'
import { EmptyState } from '@/components/common/EmptyState'

const DEPARTMENTS: Department[] = ['PU', 'ENAMEL', 'POWDER']
const STATUSES: RequestStatus[] = ['PENDING', 'IN_PROGRESS', 'APPROVED', 'PARTIAL', 'REJECTED']
const DEPT_LABEL: Record<Department, string> = { PU: 'PU', ENAMEL: 'Enamel', POWDER: 'Powder' }
const TXN_META: Record<StockTxnType, { icon: typeof PlusCircle; cls: string }> = {
  ADD: { icon: PlusCircle, cls: 'text-success' },
  DEDUCT: { icon: MinusCircle, cls: 'text-blue-600' },
  DISCARD: { icon: Trash2, cls: 'text-destructive' },
}

export function OversightPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.get<Overview>('/production-requests/overview').then(setData).catch(() => setError(true))
  }, [])

  if (error) return <EmptyState title="Could not load oversight" description="Please refresh to try again." />
  if (!data) return <p className="text-sm text-muted-foreground">Loading oversight…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Factory oversight</h1>
        <div className="flex gap-2 text-sm">
          <Link to="/requests" className="flex items-center gap-1 text-primary hover:underline">
            <ClipboardList className="h-4 w-4" /> Requests
          </Link>
          <Link to="/stock-levels" className="flex items-center gap-1 text-primary hover:underline">
            <Boxes className="h-4 w-4" /> Stock levels
          </Link>
        </div>
      </div>

      {/* Top-line stock + movement snapshot */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SnapshotCard label="On-hand stock" value={`${data.stock.grandTotalKg} kg`} sub={`${data.stock.unitCount} units · ${data.stock.materialCount} materials`} />
        <SnapshotCard label={`Added (${data.movements.sinceDays}d)`} value={`${data.movements.recent.ADD} kg`} sub={`${data.movements.allTime.ADD} kg all-time`} />
        <SnapshotCard label={`Deducted (${data.movements.sinceDays}d)`} value={`${data.movements.recent.DEDUCT} kg`} sub={`${data.movements.allTime.DEDUCT} kg all-time`} />
        <SnapshotCard label={`Discarded (${data.movements.sinceDays}d)`} value={`${data.movements.recent.DISCARD} kg`} sub={`${data.movements.allTime.DISCARD} kg all-time`} />
      </div>

      {/* Requests by department × status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Requests by department</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  {STATUSES.map((s) => (
                    <TableHead key={s} className="text-center">
                      <StatusBadge status={s} />
                    </TableHead>
                  ))}
                  <TableHead className="text-center">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEPARTMENTS.map((d) => {
                  const row = data.requestMatrix[d]
                  const total = STATUSES.reduce((s, k) => s + (row?.[k] ?? 0), 0)
                  return (
                    <TableRow key={d}>
                      <TableCell className="font-medium">{DEPT_LABEL[d]}</TableCell>
                      {STATUSES.map((s) => (
                        <TableCell key={s} className="text-center">
                          {row?.[s] ? row[s] : <span className="text-muted-foreground">·</span>}
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-medium">{total}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Per-department fulfilment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fulfilment by department</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {DEPARTMENTS.map((d) => {
            const f = data.fulfilment[d]
            const req = f?.requestedKg ?? 0
            const iss = f?.issuedKg ?? 0
            const pct = req > 0 ? Math.min(100, Math.round((iss / req) * 100)) : 0
            return (
              <div key={d}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{DEPT_LABEL[d]}</span>
                  <span className="text-muted-foreground">
                    {iss} / {req} kg issued · {f?.approvedKg ?? 0} kg approved
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <Activity className="h-4 w-4" /> Recent movements
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock movements yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentActivity.movements.map((m) => {
                  const Icon = TXN_META[m.type].icon
                  return (
                    <li key={m.id} className="flex items-center gap-2 py-1.5">
                      <Icon className={`h-4 w-4 shrink-0 ${TXN_META[m.type].cls}`} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{m.type} {m.quantityKg} kg</span>
                        {' · '}
                        <span className="font-mono text-xs">{m.material?.uniqueId ?? '—'}</span>
                        {m.department ? ` · ${m.department}` : ''}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {m.createdAt.slice(5, 16).replace('T', ' ')}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <ClipboardList className="h-4 w-4" /> Recent request reviews
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentActivity.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentActivity.reviews.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-1.5">
                    <Badge variant="outline" className="shrink-0">{DEPT_LABEL[r.department]}</Badge>
                    <StatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {r.reviewedBy?.name ?? '—'}
                    </span>
                    <Link to="/requests" className="shrink-0 text-primary hover:underline">
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SnapshotCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}
