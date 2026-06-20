import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatWeight } from '@/lib/utils'
import type { InventoryBag } from '@/types'
import { cn } from '@/lib/utils'

interface InventoryDetailPanelProps {
  bag: InventoryBag | null
  open: boolean
  onClose: () => void
}

export function InventoryDetailPanel({ bag, open, onClose }: InventoryDetailPanelProps) {
  if (!bag) return null

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full max-w-md border-l bg-background shadow-lg transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <h2 className="text-sm font-semibold">Bag Details</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div>
            <div className="text-xs text-muted-foreground">QR ID</div>
            <div className="font-mono text-sm font-semibold">{bag.qrId}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DetailField label="Material" value={bag.materialName} />
            <DetailField label="SKU" value={bag.sku} />
            <DetailField label="Supplier" value={bag.supplierName} />
            <DetailField label="Status">
              <Badge>{bag.status}</Badge>
            </DetailField>
            <DetailField label="Original Weight" value={formatWeight(bag.originalWeight)} />
            <DetailField label="Remaining Weight" value={formatWeight(bag.remainingWeight)} />
            <DetailField label="Warehouse" value={bag.warehouseName} />
            <DetailField label="Rack" value={bag.rackCode} />
            <DetailField label="Batch" value={bag.batchNumber} />
            <DetailField label="PO" value={bag.purchaseOrder ?? '—'} />
            <DetailField label="Mfg Date" value={formatDate(bag.manufacturingDate)} />
            <DetailField label="Expiry" value={formatDate(bag.expiryDate)} />
            <DetailField label="Received" value={formatDate(bag.receivedAt)} />
          </div>

          {bag.remarks && (
            <DetailField label="Remarks" value={bag.remarks} />
          )}
        </div>
      </aside>
    </>
  )
}

function DetailField({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {children ?? <div className="text-sm">{value}</div>}
    </div>
  )
}
