import { useEffect, useState } from 'react'
import { useAutoRefresh } from '@/lib/refresh'
import { ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { useUrlText } from '@/lib/urlState'
import type { AuditEntry } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { formatDateTime } from '@/lib/utils'

export function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useUrlText('q')

  useEffect(() => {
    api.get<AuditEntry[]>('/audit?take=200').then(setRows).catch(() => {})
  }, [])
  useAutoRefresh(() => api.get<AuditEntry[]>('/audit?take=200').then(setRows).catch(() => {}))

  const shown = filter
    ? rows.filter(
        (r) =>
          r.action.toLowerCase().includes(filter.toLowerCase()) ||
          r.entityType.toLowerCase().includes(filter.toLowerCase()) ||
          (r.actor?.name ?? '').toLowerCase().includes(filter.toLowerCase()),
      )
    : rows

  return (
    <div className="space-y-4">
      <Input
        placeholder="Filter by action, entity, or operator…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
      />
      {shown.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Device</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.entityType}
                    <span className="ml-1 font-mono text-muted-foreground">{r.entityId.slice(0, 8)}</span>
                  </TableCell>
                  <TableCell className="text-sm">{r.actor?.name ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.device ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
