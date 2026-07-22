import { useCallback, useEffect, useState } from 'react'
import { ScrollText, Printer, PackageCheck, Clock, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { useAutoRefresh } from '@/lib/refresh'
import { AppLink } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import type { ReceivingSlip } from '@/types/api'

/**
 * Store's inward surface.
 *
 * Store no longer sees the supplier's invoice, so this is what it works from: what the
 * gate says arrived, in materials and quantities, with no prices anywhere. Each slip
 * leads to Review & Confirm, and shows how far along it is.
 */

const STAGE: Record<string, { label: string; tone: string; icon: typeof Clock }> = {
  DRAFT: { label: 'Gate is checking it', tone: 'bg-chip-200 text-chip-700 hover:bg-chip-200', icon: Clock },
  AWAITING_STORE: { label: 'Ready for you', tone: 'bg-warning text-warning-foreground hover:bg-warning', icon: PackageCheck },
  CONFIRMED: { label: 'Confirmed', tone: 'bg-info text-info-foreground hover:bg-info', icon: CheckCircle2 },
  FINALIZED: { label: 'Received', tone: 'bg-healthy text-success-foreground hover:bg-healthy', icon: CheckCircle2 },
}

/** A confirmed-but-not-finished slip has no status of its own — it is DRAFT + units. */
const stageOf = (s: ReceivingSlip): keyof typeof STAGE =>
  s.status === 'FINALIZED' ? 'FINALIZED' : s.confirmedAt ? 'CONFIRMED' : s.status

export function SlipInbox() {
  const [slips, setSlips] = useState<ReceivingSlip[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api
        .get<ReceivingSlip[]>('/receiving-slips')
        // Degrades quietly on an older API rather than breaking Store's dashboard.
        .then(setSlips)
        .catch(() => setSlips([])),
    [],
  )
  useEffect(() => void load(), [load])
  useAutoRefresh(load)

  if (!slips) return <p className="text-sm text-chip-500">Loading…</p>
  if (slips.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No receiving slips yet"
        description="When the gate uploads an invoice and hands it over, it appears here."
      />
    )
  }

  return (
    <div className="stagger grid gap-2">
      {slips.map((s) => {
        const stage = STAGE[stageOf(s)] ?? STAGE.DRAFT
        const Icon = stage.icon
        const ready = s.status === 'AWAITING_STORE' && !s.confirmedAt
        return (
          <Card key={s.id} edge={ready ? 'warning' : undefined}>
            <CardContent className="space-y-2 p-3.5">
              <button
                type="button"
                onClick={() => setOpen(open === s.id ? null : s.id)}
                className="tactile flex w-full items-start justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <p className="font-medium text-chip-900">
                    {s.slipNumber}
                    <span className="ml-2 font-normal text-chip-600">{s.supplier ?? '—'}</span>
                  </p>
                  <p className="text-xs text-chip-500">
                    {s.receivedDate.slice(0, 10)} ·{' '}
                    {s.unitCount != null ? `${s.unitCount} units` : `${s.lines.length} lines, not yet confirmed`}
                  </p>
                </div>
                <Badge className={cn('shrink-0 gap-1', stage.tone)}>
                  <Icon className="h-3 w-3" /> {stage.label}
                </Badge>
              </button>

              {open === s.id && (
                <div className="space-y-3 border-t pt-3">
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
                        {s.lines.map((l, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1.5 pr-2">
                              <span className="font-medium text-chip-900">{l.materialName}</span>
                              {l.sku && <span className="block text-xs text-chip-500">{l.sku}</span>}
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                              {l.quantity} {l.unit ?? ''}
                            </td>
                            {/* kg and litres labelled per line, never summed together. */}
                            <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-chip-600">
                              {l.packWeight != null ? `${l.packWeight} ${l.measure}` : '—'}
                            </td>
                            <td className="whitespace-nowrap py-1.5 font-mono text-xs text-chip-600">
                              {l.idFrom ? (l.idFrom === l.idTo ? l.idFrom : `${l.idFrom}…${l.idTo}`) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {!s.confirmedAt && (
                      <Button asChild className="h-11 flex-1 gap-1.5">
                        <AppLink to={`/review/${s.poId}`}>
                          <PackageCheck className="h-4 w-4" /> Review &amp; Confirm
                        </AppLink>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="h-11 flex-1 gap-1.5"
                      onClick={() => void api.openBlob(`/receiving-slips/${s.id}/slip.pdf`)}
                    >
                      <Printer className="h-4 w-4" /> Print slip
                    </Button>
                  </div>
                  <p className="text-xs text-chip-500">
                    This is what the gate recorded as arriving. Prices stay on the supplier's
                    invoice, which the gate and the reviewers hold.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
