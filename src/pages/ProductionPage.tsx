import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useProduction } from '@/hooks/useProduction'
import { QRScanner } from '@/components/qr/QRScanner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/hooks/useToast'
import { formatWeight } from '@/lib/utils'
import type { ProductionOrderItem } from '@/types'

export function ProductionPage() {
  const { order, scanning, error, createOrder, scanBag, updateConsumption, complete } =
    useProduction()

  const [form, setForm] = useState({
    batchNumber: '',
    paintType: '',
    supervisor: '',
    targetQuantity: 0,
    date: new Date().toISOString().slice(0, 10),
  })

  const handleCreateOrder = async () => {
    if (!form.batchNumber || !form.paintType) {
      toast({ title: 'Validation', description: 'Fill batch and paint type.', variant: 'destructive' })
      return
    }
    await createOrder({
      batchNumber: form.batchNumber,
      paintType: form.paintType,
      supervisor: form.supervisor,
      targetQuantity: form.targetQuantity,
      date: form.date,
    })
    toast({ title: 'Production Order Created', description: form.batchNumber })
  }

  const handleScan = async (qrId: string) => {
    const bag = await scanBag(qrId)
    if (bag) {
      toast({ title: 'Bag Added', description: bag.qrId })
    }
  }

  const handleConsumptionChange = async (bagId: string, value: number) => {
    await updateConsumption(bagId, value)
  }

  const handleComplete = async () => {
    await complete()
    toast({ title: 'Production Complete', description: 'Batch marked as completed.', variant: 'success' })
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!order ? (
        <Card>
          <CardHeader>
            <CardTitle>New Production Order</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Production Batch *</Label>
                <Input
                  value={form.batchNumber}
                  onChange={(e) => setForm({ ...form, batchNumber: e.target.value })}
                  placeholder="PB-2026-044"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Paint Type *</Label>
                <Input
                  value={form.paintType}
                  onChange={(e) => setForm({ ...form, paintType: e.target.value })}
                  placeholder="Premium Emulsion White"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Supervisor</Label>
                <Input
                  value={form.supervisor}
                  onChange={(e) => setForm({ ...form, supervisor: e.target.value })}
                  placeholder="Suresh Reddy"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Target Quantity (L)</Label>
                <Input
                  type="number"
                  value={form.targetQuantity}
                  onChange={(e) =>
                    setForm({ ...form, targetQuantity: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>
            <Button className="mt-4 gap-2" onClick={handleCreateOrder}>
              <Plus className="h-4 w-4" />
              Create Order
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <OrderHeader order={order} onComplete={handleComplete} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Scan Material Bags</CardTitle>
              </CardHeader>
              <CardContent>
                <QRScanner onScan={handleScan} scanning={scanning} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Selected Bags ({order.consumedBags.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {order.consumedBags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Scan bags to add materials.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>QR</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Consumed (kg)</TableHead>
                        <TableHead>Remaining</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.consumedBags.map((bag) => (
                        <TableRow key={bag.bagId}>
                          <TableCell className="font-mono text-xs">{bag.qrId}</TableCell>
                          <TableCell>{bag.materialName}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-8 w-24"
                              value={bag.consumedWeight}
                              onChange={(e) =>
                                handleConsumptionChange(
                                  bag.bagId,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatWeight(bag.remainingWeight)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function OrderHeader({
  order,
  onComplete,
}: {
  order: ProductionOrderItem
  onComplete: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
      <div>
        <div className="font-mono text-sm font-semibold">{order.batchNumber}</div>
        <div className="text-sm">{order.paintType}</div>
        <div className="text-xs text-muted-foreground">
          Target: {order.targetQuantity} L · {order.supervisor}
        </div>
      </div>
      <Button variant="secondary" onClick={onComplete} className="gap-2">
        Complete Production
      </Button>
    </div>
  )
}
