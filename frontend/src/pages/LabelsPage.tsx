import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { QrCode, ImageDown, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { Paginated, PurchaseOrder } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'
import { LabelRollFlow } from '@/components/labels/LabelRollFlow'

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
    return <EmptyState icon={QrCode} title="No registered invoices" description="Confirm an invoice to generate QR labels." />
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Registered invoices:</p>
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
  const [busy, setBusy] = useState<null | 'pdf' | 'zip' | 'csv'>(null)
  useEffect(() => {
    api
      .get<LabelUnit[]>(`/purchase-orders/${poId}/units`)
      .then(setUnits)
      .catch(() => {})
  }, [poId])

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
  const downloadCsv = async () => {
    setBusy('csv')
    try {
      await api.downloadBlob(`/purchase-orders/${poId}/labels.csv`, `labels-${poId}.csv`)
    } catch {
      toast({ variant: 'destructive', title: 'Could not download CSV' })
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

          <Button variant="outline" onClick={downloadZip} className="gap-1.5" disabled={!units.length || busy !== null}>
            <ImageDown className="h-4 w-4" /> {busy === 'zip' ? 'Zipping…' : 'Individual PNGs (ZIP)'}
          </Button>
          <Button variant="outline" onClick={downloadCsv} className="gap-1.5" disabled={!units.length || busy !== null}>
            <FileSpreadsheet className="h-4 w-4" /> {busy === 'csv' ? 'Exporting…' : 'Label data (CSV)'}
          </Button>
        </div>
      </div>
      {/* Explicit Generate → Save → Print for the label roll (item 4). */}
      <LabelRollFlow
        path={`/purchase-orders/${poId}/labels.pdf`}
        fileName={`labels-${poId}.pdf`}
        unitCount={units.length}
      />

      <p className="text-xs text-muted-foreground">
        <span className="font-medium">PDF</span> — one 3×1.5" label per page ({units.length} page{units.length === 1 ? '' : 's'}), ready for the label-roll printer.{' '}
        <span className="font-medium">ZIP</span> — one PNG per unit (MC-000001.png…).{' '}
        <span className="font-medium">CSV</span> — label data for BarTender / NiceLabel to merge onto your own .btw template.
      </p>

      {units.length === 0 ? (
        <EmptyState icon={QrCode} title="No units for this invoice" />
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
