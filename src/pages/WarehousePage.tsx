import { useState } from 'react'
import { ArrowRightLeft, Package } from 'lucide-react'
import { useWarehouse } from '@/hooks/useWarehouse'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorState } from '@/components/common/ErrorState'
import { EmptyState } from '@/components/common/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/useToast'
import { formatWeight } from '@/lib/utils'
import type { InventoryBag } from '@/types'
import type { RackWithBags } from '@/services/warehouseService'
import { cn } from '@/lib/utils'

export function WarehousePage() {
  const { racks, loading, error, refetch, moveBag } = useWarehouse()
  const [selectedRack, setSelectedRack] = useState<RackWithBags | null>(null)
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [bagToMove, setBagToMove] = useState<InventoryBag | null>(null)
  const [targetRackId, setTargetRackId] = useState('')

  const displayRacks = racks.filter((r) =>
    ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].includes(r.code)
  )

  const handleMoveClick = (bag: InventoryBag) => {
    setBagToMove(bag)
    setMoveDialogOpen(true)
  }

  const handleConfirmMove = async () => {
    if (!bagToMove || !targetRackId) return
    await moveBag(bagToMove.id, targetRackId)
    toast({ title: 'Bag Moved', description: `${bagToMove.qrId} relocated successfully.` })
    setMoveDialogOpen(false)
    setBagToMove(null)
    setTargetRackId('')
    if (selectedRack) {
      const updated = racks.find((r) => r.id === selectedRack.id)
      if (updated) setSelectedRack(updated)
    }
  }

  if (loading) return <LoadingSkeleton variant="card" count={6} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Raw Material Store — Rack Layout
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayRacks.map((rack) => (
            <RackCard
              key={rack.id}
              rack={rack}
              selected={selectedRack?.id === rack.id}
              onClick={() => setSelectedRack(rack)}
            />
          ))}
        </div>
      </div>

      {selectedRack && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Rack {selectedRack.code} — Stored Bags
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedRack.bags.length === 0 ? (
              <EmptyState title="No bags on this rack" description="This rack is empty." />
            ) : (
              <div className="space-y-2">
                {selectedRack.bags.map((bag) => (
                  <div
                    key={bag.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <div className="font-mono text-xs font-semibold">{bag.qrId}</div>
                      <div className="text-sm">{bag.materialName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatWeight(bag.remainingWeight)} remaining
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge>{bag.status}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => handleMoveClick(bag)}
                      >
                        <ArrowRightLeft className="h-3 w-3" />
                        Move
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {moveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
            <h3 className="font-semibold">Select Target Rack</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Move {bagToMove?.qrId} to:
            </p>
            <Select value={targetRackId} onValueChange={setTargetRackId}>
              <SelectTrigger className="mt-4">
                <SelectValue placeholder="Select rack" />
              </SelectTrigger>
              <SelectContent>
                {displayRacks
                  .filter((r) => r.id !== bagToMove?.rackId)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.code} ({r.occupied}/{r.capacity})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!targetRackId} onClick={handleConfirmMove}>
                Confirm Move
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RackCard({
  rack,
  selected,
  onClick,
}: {
  rack: RackWithBags
  selected: boolean
  onClick: () => void
}) {
  const utilization = Math.round((rack.occupied / rack.capacity) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-4 text-left transition-colors hover:border-primary/50',
        selected && 'border-primary ring-2 ring-primary/20'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold">{rack.code}</span>
        <Badge variant={utilization > 80 ? 'warning' : 'secondary'}>
          {rack.occupied}/{rack.capacity}
        </Badge>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            utilization > 80 ? 'bg-warning' : 'bg-primary'
          )}
          style={{ width: `${utilization}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{utilization}% utilized</div>
    </button>
  )
}
