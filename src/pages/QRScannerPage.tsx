import { useState } from 'react'
import {
  ArrowRightLeft,
  History,
  PackageMinus,
  Scale,
} from 'lucide-react'
import { QRScanner } from '@/components/qr/QRScanner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fetchBagByQr } from '@/services/inventoryService'
import { fetchBagHistory } from '@/services/inventoryService'
import { formatWeight } from '@/lib/utils'
import { toast } from '@/hooks/useToast'
import { Modal } from '@/components/common/Modal'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { InventoryBag, MaterialActivity } from '@/types'

export function QRScannerPage() {
  const [scannedBag, setScannedBag] = useState<InventoryBag | null>(null)
  const [history, setHistory] = useState<MaterialActivity[]>([])
  const [scanning, setScanning] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [weightModalOpen, setWeightModalOpen] = useState(false)
  const [newWeight, setNewWeight] = useState('')

  const handleScan = async (qrId: string) => {
    setScanning(true)
    try {
      const bag = await fetchBagByQr(qrId)
      if (!bag) {
        toast({ title: 'Not Found', description: `No bag found for QR: ${qrId}`, variant: 'destructive' })
        return
      }
      setScannedBag(bag)
      toast({ title: 'Scan Successful', description: bag.materialName, variant: 'success' })
    } catch {
      toast({ title: 'Scan Failed', description: 'Unable to lookup QR code.', variant: 'destructive' })
    } finally {
      setScanning(false)
    }
  }

  const handleIssue = () => {
    toast({ title: 'Material Issued', description: 'Bag marked as issued for production.' })
  }

  const handleMoveRack = () => {
    toast({ title: 'Move Rack', description: 'Open warehouse view to move between racks.' })
  }

  const handleUpdateWeight = () => {
    if (scannedBag) {
      setNewWeight(String(scannedBag.remainingWeight))
      setWeightModalOpen(true)
    }
  }

  const handleShowHistory = async () => {
    if (!scannedBag) return
    const data = await fetchBagHistory(scannedBag.id)
    setHistory(data)
    setHistoryOpen(true)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Scan QR Code</CardTitle>
        </CardHeader>
        <CardContent>
          <QRScanner onScan={handleScan} scanning={scanning} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scan Result</CardTitle>
        </CardHeader>
        <CardContent>
          {!scannedBag ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              Scan a QR code to view bag details
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="font-mono text-lg font-semibold">{scannedBag.qrId}</div>
                <Badge className="mt-2">{scannedBag.status}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Material" value={scannedBag.materialName} />
                <InfoRow label="Supplier" value={scannedBag.supplierName} />
                <InfoRow label="Warehouse" value={scannedBag.warehouseName} />
                <InfoRow label="Rack" value={scannedBag.rackCode} />
                <InfoRow label="Original Weight" value={formatWeight(scannedBag.originalWeight)} />
                <InfoRow label="Remaining Weight" value={formatWeight(scannedBag.remainingWeight)} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button onClick={handleIssue} className="gap-2">
                  <PackageMinus className="h-4 w-4" />
                  Issue Material
                </Button>
                <Button variant="outline" onClick={handleMoveRack} className="gap-2">
                  <ArrowRightLeft className="h-4 w-4" />
                  Move Rack
                </Button>
                <Button variant="outline" onClick={handleUpdateWeight} className="gap-2">
                  <Scale className="h-4 w-4" />
                  Update Weight
                </Button>
                <Button variant="outline" onClick={handleShowHistory} className="gap-2">
                  <History className="h-4 w-4" />
                  History
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={historyOpen} onOpenChange={setHistoryOpen} title="Bag History">
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history found.</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="rounded border p-2 text-sm">
                <div className="font-medium">{h.description}</div>
                <div className="text-xs text-muted-foreground">{h.user} · {h.type}</div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal open={weightModalOpen} onOpenChange={setWeightModalOpen} title="Update Weight">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Remaining Weight (kg)</Label>
            <Input
              type="number"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            onClick={() => {
              toast({ title: 'Weight Updated', description: `New weight: ${newWeight} kg` })
              setWeightModalOpen(false)
            }}
          >
            Save Weight
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
