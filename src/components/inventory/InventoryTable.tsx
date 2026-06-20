import { ChevronLeft, ChevronRight, Eye, ArrowUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatWeight } from '@/lib/utils'
import type { BagStatus, InventoryBag, SortDirection } from '@/types'

const statusVariant: Record<BagStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  available: 'success',
  reserved: 'warning',
  issued: 'default',
  consumed: 'secondary',
  expired: 'destructive',
  quarantine: 'warning',
}

interface InventoryTableProps {
  bags: InventoryBag[]
  loading?: boolean
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  onView: (bag: InventoryBag) => void
  onSort?: (field: keyof InventoryBag, direction: SortDirection) => void
  sortBy?: keyof InventoryBag
  sortDirection?: SortDirection
}

export function InventoryTable({
  bags,
  page,
  totalPages,
  onPageChange,
  onView,
  onSort,
  sortBy,
  sortDirection,
}: InventoryTableProps) {
  const handleSort = (field: keyof InventoryBag) => {
    if (!onSort) return
    const newDirection =
      sortBy === field && sortDirection === 'asc' ? 'desc' : 'asc'
    onSort(field, newDirection)
  }

  const SortHeader = ({
    field,
    children,
  }: {
    field: keyof InventoryBag
    children: React.ReactNode
  }) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => handleSort(field)}
    >
      {children}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  )

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead><SortHeader field="qrId">QR</SortHeader></TableHead>
              <TableHead><SortHeader field="materialName">Material</SortHeader></TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Orig. Wt</TableHead>
              <TableHead className="text-right">Rem. Wt</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Rack</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead className="w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bags.map((bag) => (
              <TableRow key={bag.id}>
                <TableCell className="font-mono text-xs">{bag.qrId}</TableCell>
                <TableCell className="font-medium">{bag.materialName}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{bag.sku}</TableCell>
                <TableCell className="text-xs">{bag.supplierName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWeight(bag.originalWeight)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWeight(bag.remainingWeight)}
                </TableCell>
                <TableCell className="text-xs">{bag.warehouseName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{bag.rackCode}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[bag.status]}>{bag.status}</Badge>
                </TableCell>
                <TableCell className="text-xs">{bag.batchNumber}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => onView(bag)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
