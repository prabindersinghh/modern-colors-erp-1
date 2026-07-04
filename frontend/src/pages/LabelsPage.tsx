import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, QrCode, ImageDown } from 'lucide-react'
import { api } from '@/lib/api'
import type { Paginated, PurchaseOrder } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'

export function LabelsPage() {
  const [params] = useSearchParams()
  const poId = params.get('poId')
  return poId ? <LabelsForPo poId={poId} /> : <RegisteredPoPicker />
}

function RegisteredPoPicker() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  useEffect(() => {
    api
      .get<Paginated<PurchaseOrder>>('/purchase-orders?status=REGISTERED&pageSize=50')
      .then((r) => setPos(r.data))
      .catch(() => {})
  }, [])
  if (pos.length === 0)
    return <EmptyState icon={QrCode} title="No registered POs" description="Confirm a PO to generate QR labels." />
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Registered purchase orders:</p>
      {pos.map((p) => (
        <Link
          key={p.id}
          to={`/labels?poId=${p.id}`}
          className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
        >
          <span className="font-medium">{p.poNumber ?? p.fileName ?? p.id.slice(0, 8)}</span>
          <span className="text-muted-foreground">{p._count?.materials ?? 0} units</span>
        </Link>
      ))}
    </div>
  )
}

interface LabelUnit {
  id: string
  uniqueId: string
  materialName: string
  sku: string | null
  hsnCode: string | null
  status: string
  qrImage: string | null
}

function LabelsForPo({ poId }: { poId: string }) {
  const [units, setUnits] = useState<LabelUnit[]>([])
  const [busy, setBusy] = useState<null | 'pdf' | 'zip'>(null)
  useEffect(() => {
    api
      .get<LabelUnit[]>(`/purchase-orders/${poId}/units`)
      .then(setUnits)
      .catch(() => {})
  }, [poId])

  const downloadPdf = async () => {
    setBusy('pdf')
    try {
      await api.openBlob(`/purchase-orders/${poId}/labels.pdf`)
    } catch {
      toast({ variant: 'destructive', title: 'Could not open labels PDF' })
    } finally {
      setBusy(null)
    }
  }
  const downloadZip = async () => {
    setBusy('zip')
    try {
      await api.downloadBlob(`/purchase-orders/${poId}/labels.zip`, `qr-codes-${poId}.zip`)
    } catch {
      toast({ variant: 'destructive', title: 'Could not download ZIP' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">{units.length}</span> QR-coded units
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadPdf} className="gap-1.5" disabled={!units.length || busy !== null}>
            <Printer className="h-4 w-4" /> {busy === 'pdf' ? 'Preparing…' : 'Label sheet (PDF)'}
          </Button>
          <Button variant="outline" onClick={downloadZip} className="gap-1.5" disabled={!units.length || busy !== null}>
            <ImageDown className="h-4 w-4" /> {busy === 'zip' ? 'Zipping…' : 'Individual PNGs (ZIP)'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Labels are 3×1.5" stickers. The ZIP has one PNG per unit, named by unique ID (e.g. MC-000001.png).
      </p>

      {units.length === 0 ? (
        <EmptyState icon={QrCode} title="No units for this PO" />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">S.No</TableHead>
                <TableHead className="w-16">QR</TableHead>
                <TableHead>Unique ID</TableHead>
                <TableHead className="min-w-[180px]">Material</TableHead>
                <TableHead>HSN Code</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((m, i) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    {m.qrImage ? (
                      <img src={m.qrImage} alt={m.uniqueId} className="h-10 w-10 rounded border" />
                    ) : (
                      <QrCode className="h-5 w-5 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.uniqueId}</TableCell>
                  <TableCell className="whitespace-normal break-words font-medium">{m.materialName}</TableCell>
                  <TableCell className="font-mono text-xs">{m.hsnCode ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{m.sku ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.status.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
