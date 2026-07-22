import { useCallback, useEffect, useState } from 'react'
import { FileText, ScrollText, AlertTriangle, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { useAutoRefresh } from '@/lib/refresh'
import { useUrlId } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import type { Inward, ReceivingSlip } from '@/types/api'

/**
 * The Reviewer's only screen: the actual invoice document beside the digital slip.
 *
 * The point is a like-for-like check — what the supplier billed against what the gate
 * says physically arrived — so this renders the REAL document inline (PDF or photo),
 * not a metadata card with a download link. On a phone the two stack, document first,
 * because that is the thing being checked.
 *
 * Reviewer holds no write anywhere in the application; this screen offers none.
 */
export function ReviewInwardsPage() {
  const [inwards, setInwards] = useState<Inward[] | null>(null)
  const [selected, setSelected] = useUrlId('inward')

  const load = useCallback(
    () => api.get<Inward[]>('/inwards').then(setInwards).catch(() => setInwards([])),
    [],
  )
  useEffect(() => void load(), [load])
  useAutoRefresh(load)

  const current = inwards?.find((i) => i.id === selected) ?? inwards?.[0] ?? null

  if (!inwards) return <p className="text-sm text-chip-500">Loading…</p>
  if (inwards.length === 0) {
    return <EmptyState icon={ScrollText} title="No inwards yet" description="Nothing has been received." />
  }

  return (
    <div className="space-y-4">
      {/* The list of inwards — compact, so the document gets the room. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {inwards.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setSelected(i.id)}
            className={cn(
              'tactile min-h-11 shrink-0 rounded-md border px-3 py-2 text-left text-xs',
              current?.id === i.id ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent',
            )}
          >
            <span className="block font-medium text-chip-900">{i.poNumber ?? 'No number'}</span>
            <span className="block text-chip-500">{i.supplier ?? '—'}</span>
            <span className="block text-chip-400">{i.createdAt.slice(0, 10)}</span>
          </button>
        ))}
      </div>

      {current && <InwardView inward={current} />}
    </div>
  )
}

function InwardView({ inward }: { inward: Inward }) {
  return (
    // Document and slip side by side on a desktop; stacked on a phone with the document
    // first, because that is what is being checked against.
    <div className="grid gap-4 lg:grid-cols-2">
      <InvoiceDocument poId={inward.id} fileName={inward.fileName} />
      <SlipPanel slip={inward.slip} />
    </div>
  )
}

/** The real document, fetched as a blob so the Reviewer's token is used to authorise it. */
function InvoiceDocument({ poId, fileName }: { poId: string; fileName: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    setUrl(null)
    setFailed(false)
    if (!fileName) return
    // An <img>/<iframe> src cannot carry an Authorization header, so the file is pulled
    // with the session token and handed to the browser as an object URL.
    api
      .fetchBlobUrl(`/purchase-orders/${poId}/file`)
      .then(({ url: u }) => {
        revoked = u
        setUrl(u)
      })
      .catch(() => setFailed(true))
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [poId, fileName])

  const isPdf = (fileName ?? '').toLowerCase().endsWith('.pdf')

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-2 p-3.5">
        <h2 className="flex items-center gap-1.5 text-title-3 text-chip-900">
          <FileText className="h-4 w-4 shrink-0" /> Supplier invoice
        </h2>
        {!fileName ? (
          <p className="py-8 text-center text-sm text-chip-500">
            This inward was entered by hand — there is no invoice document.
          </p>
        ) : failed ? (
          <p className="py-8 text-center text-sm text-critical">The invoice document could not be loaded.</p>
        ) : !url ? (
          <div className="h-[60vh] animate-pulse rounded-md bg-muted" />
        ) : isPdf ? (
          <>
            <object data={url} type="application/pdf" className="h-[60vh] w-full rounded-md border">
              {/* iOS Safari will not render a PDF in an object — give it a real way through. */}
              <p className="p-4 text-sm text-chip-600">
                This device cannot show the PDF inline.{' '}
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
                  Open the invoice <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </p>
            </object>
            <p className="truncate text-xs text-chip-500">{fileName}</p>
          </>
        ) : (
          <>
            <img src={url} alt={`Invoice ${fileName}`} className="max-h-[60vh] w-full rounded-md border object-contain" />
            <p className="truncate text-xs text-chip-500">{fileName}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SlipPanel({ slip }: { slip: ReceivingSlip | null }) {
  if (!slip) {
    return (
      <Card edge="warning">
        <CardContent className="space-y-2 p-3.5">
          <h2 className="flex items-center gap-1.5 text-title-3 text-chip-900">
            <ScrollText className="h-4 w-4 shrink-0" /> Receiving slip
          </h2>
          <p className="flex items-start gap-2 text-sm text-chip-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            No digital slip — this inward was received before the slip system existed. The
            invoice above is the only record.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-title-3 text-chip-900">
            <ScrollText className="h-4 w-4 shrink-0" /> {slip.slipNumber}
          </h2>
          <Badge variant={slip.status === 'FINALIZED' ? 'default' : 'secondary'}>
            {slip.status === 'FINALIZED' ? 'Finalised' : 'Draft'}
          </Badge>
        </div>
        <div className="text-sm text-chip-600">
          {slip.supplier ?? '—'} · received {slip.receivedDate.slice(0, 10)} ·{' '}
          <span className="font-medium text-chip-900">{slip.unitCount} units</span>
          {slip.scannedCount != null && ` · ${slip.scannedCount} scanned in`}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-chip-500">
                <th className="py-1.5 pr-2">Material</th>
                <th className="py-1.5 pr-2">Qty</th>
                <th className="py-1.5 pr-2">Pack</th>
                <th className="py-1.5">Unit IDs</th>
              </tr>
            </thead>
            <tbody>
              {slip.lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-chip-900">{l.materialName}</span>
                    {l.sku && <span className="block text-xs text-chip-500">{l.sku}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                    {l.quantity} {l.unit ?? ''}
                  </td>
                  {/* kg and litres are labelled per line and never added together. */}
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-chip-600">
                    {l.packWeight != null ? `${l.packWeight} ${l.measure}` : '—'}
                  </td>
                  <td className="whitespace-nowrap py-1.5 font-mono text-xs text-chip-600">
                    {l.idFrom === l.idTo ? l.idFrom : `${l.idFrom}…${l.idTo}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-chip-500">
          The slip records what physically arrived. It carries no prices or amounts — those
          stay on the invoice.
        </p>
      </CardContent>
    </Card>
  )
}
