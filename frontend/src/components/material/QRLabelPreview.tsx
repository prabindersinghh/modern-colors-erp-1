import { QrCode } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { GeneratedQrLabel } from '@/types'

interface QRLabelPreviewProps {
  labels: GeneratedQrLabel[]
}

export function QRLabelPreview({ labels }: QRLabelPreviewProps) {
  if (labels.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="h-4 w-4" />
          Generated QR Labels ({labels.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>QR ID</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Bag #</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.map((label) => (
                <TableRow key={label.qrId}>
                  <TableCell className="font-mono text-xs">{label.qrId}</TableCell>
                  <TableCell>{label.materialName}</TableCell>
                  <TableCell>{label.bagNumber}</TableCell>
                  <TableCell>{formatWeight(label.weight)}</TableCell>
                  <TableCell>
                    <Badge variant="success">{label.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labels.slice(0, 6).map((label) => (
            <div
              key={label.qrId}
              className="rounded-lg border border-dashed p-4 print:break-inside-avoid"
            >
              <div className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Modern Colours
              </div>
              <div className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded border bg-muted">
                <QrCode className="h-12 w-12 text-muted-foreground" />
              </div>
              <div className="text-center font-mono text-xs font-semibold">{label.qrId}</div>
              <div className="mt-1 text-center text-[10px] text-muted-foreground">
                {label.materialName} · Bag {label.bagNumber}
              </div>
              <div className="text-center text-[10px] text-muted-foreground">
                {formatWeight(label.weight)} · {label.batchNumber}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
