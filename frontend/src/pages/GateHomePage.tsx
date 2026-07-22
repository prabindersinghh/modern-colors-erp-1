import { useCallback, useEffect, useState } from 'react'
import { FileUp, Camera, Send, CheckCircle2, Clock, Loader2, Pencil } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'
import { useAutoRefresh } from '@/lib/refresh'
import { cn } from '@/lib/utils'
import { useUrlId } from '@/lib/urlState'
import type { Paginated, POLineItem, PurchaseOrder, ReceivingSlip } from '@/types/api'

/**
 * The Gate desk. One job: photograph the invoice, upload it, check what was read off
 * it, hand it to Store.
 *
 * Everything else is gone — no factory dashboard, no catalogue, no QR labels, no
 * receiving. The list below is HIS OWN uploads and nobody else's, and that scoping is
 * done server-side (`uploadedById`), so it holds for a raw API call too.
 */
export function GateHomePage() {
  const [pos, setPos] = useState<PurchaseOrder[] | null>(null)
  const [selected, setSelected] = useUrlId('inv')
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api
        .get<Paginated<PurchaseOrder>>('/purchase-orders?pageSize=50')
        .then((r) => setPos(r.data))
        .catch(() => setPos([])),
    [],
  )
  useEffect(() => void load(), [load])
  useAutoRefresh(load)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const po = await api.postForm<PurchaseOrder>('/purchase-orders', form)
      toast({ title: 'Invoice uploaded', description: 'Reading it now…' })
      // Extraction is what creates the slip, so it runs immediately rather than
      // leaving the gate guard to remember a second button.
      await api.post(`/purchase-orders/${po.id}/extract`).catch(() => null)
      await load()
      setSelected(po.id)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card edge="primary">
        <CardContent className="space-y-3 p-3.5">
          <div>
            <h2 className="text-title-3 text-chip-900">Photograph the invoice</h2>
            <p className="mt-0.5 text-sm text-chip-600">
              Take a picture of the supplier's invoice, or choose a file. Everything else
              happens from there.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* capture="environment" opens the rear camera straight away on a phone. */}
            <label className="flex-1">
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
              <span className="tactile flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                {busy ? 'Working…' : 'Take a photo'}
              </span>
            </label>
            <label className="flex-1">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              />
              <span className="tactile flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-4 text-sm font-medium">
                <FileUp className="h-4 w-4" /> Choose a file
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-title-3 text-chip-900">Your scan history</h2>
        {!pos ? (
          <p className="text-sm text-chip-500">Loading…</p>
        ) : pos.length === 0 ? (
          <EmptyState icon={FileUp} title="Nothing yet" description="Your uploads will appear here." />
        ) : (
          <div className="stagger grid gap-2">
            {pos.map((po) => (
              <GateInvoiceCard
                key={po.id}
                po={po}
                open={selected === po.id}
                onToggle={() => setSelected(selected === po.id ? null : po.id)}
                onChanged={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One upload, with its proofread inline. */
function GateInvoiceCard({
  po,
  open,
  onToggle,
  onChanged,
}: {
  po: PurchaseOrder
  open: boolean
  onToggle: () => void
  onChanged: () => Promise<void>
}) {
  const [slip, setSlip] = useState<ReceivingSlip | null | undefined>(undefined)

  const loadSlip = useCallback(() => {
    // Degrades quietly: on an older API this route does not exist yet, and the card
    // simply shows no status rather than breaking the screen (the 6883b6d rule).
    api
      .get<ReceivingSlip | null>(`/receiving-slips/by-po/${po.id}`)
      .then(setSlip)
      .catch(() => setSlip(null))
  }, [po.id])
  useEffect(() => void loadSlip(), [loadSlip])

  const sent = !!slip?.status && slip.status !== 'DRAFT'
  // Exactly the three states the gate guard cares about, in his words.
  const state = slip?.confirmedAt
    ? { label: 'Confirmed', tone: 'bg-healthy text-success-foreground hover:bg-healthy', icon: CheckCircle2 }
    : sent
      ? { label: 'With Store', tone: 'bg-info text-info-foreground hover:bg-info', icon: Send }
      : { label: 'Draft', tone: 'bg-chip-200 text-chip-700 hover:bg-chip-200', icon: Clock }
  const extraction =
    slip === undefined ? 'checking…' : slip ? `${slip.lines.length} lines read` : 'nothing read yet'

  return (
    <Card className={open ? 'border-primary/40' : undefined}>
      <CardContent className="space-y-3 p-3.5">
        <button type="button" onClick={onToggle} className="tactile flex w-full items-start justify-between gap-2 text-left">
          <div className="min-w-0">
            <p className="truncate font-medium text-chip-900">{po.poNumber ?? po.fileName ?? 'Invoice'}</p>
            <p className="truncate text-xs text-chip-500">{po.supplier ?? 'Supplier not read yet'}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-chip-500">
              {/* When he uploaded it — to the minute, because a gate guard checks
                  "did that truck's invoice go through?" against the clock. */}
              <span className="tabular-nums">
                {new Date(po.createdAt).toLocaleString(undefined, {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              <span aria-hidden>·</span>
              <span>{extraction}</span>
              {slip?.slipNumber && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono">{slip.slipNumber}</span>
                </>
              )}
            </p>
          </div>
          <Badge className={cn('shrink-0 gap-1', state.tone)}>
            <state.icon className="h-3 w-3" /> {state.label}
          </Badge>
        </button>

        {open && <Proofread poId={po.id} locked={!!sent} onChanged={onChanged} onSent={loadSlip} />}
      </CardContent>
    </Card>
  )
}

/**
 * The proofread — read the extracted lines back against the paper, fix what was
 * misread, hand over. Deliberately NOT a Review & Confirm: nothing here mints, prints
 * or receives, and after handover the server refuses Gate's edits outright.
 */
function Proofread({
  poId,
  locked,
  onChanged,
  onSent,
}: {
  poId: string
  locked: boolean
  onChanged: () => Promise<void>
  onSent: () => void
}) {
  const [lines, setLines] = useState<POLineItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () => api.get<PurchaseOrder>(`/purchase-orders/${poId}`).then((p) => setLines(p.lineItems ?? [])).catch(() => setLines([])),
    [poId],
  )
  useEffect(() => void load(), [load])

  const save = async (line: POLineItem, patch: Partial<POLineItem>) => {
    setBusy(true)
    try {
      await api.patch(`/purchase-orders/${poId}/line-items/${line.id}`, patch)
      await load()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not save',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    setBusy(true)
    try {
      await api.post(`/purchase-orders/${poId}/send-to-store`)
      toast({ title: 'Sent to Store', description: 'Store will receive against this.' })
      onSent()
      await onChanged()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not send',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!lines) return <p className="text-sm text-chip-500">Reading the invoice…</p>
  if (lines.length === 0) {
    return (
      <p className="text-sm text-chip-600">
        Nothing could be read off this invoice yet. Try a clearer photo, or Store can enter
        the lines during Review &amp; Confirm.
      </p>
    )
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="flex items-start gap-1.5 text-xs text-chip-600">
        <Pencil className="mt-px h-3.5 w-3.5 shrink-0" />
        {locked
          ? 'Already sent to Store — corrections are Store’s now.'
          : 'Check these against the paper. Fix anything misread, then send.'}
      </p>

      <div className="space-y-2">
        {lines.map((l) => (
          <div key={l.id} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-4">
            <label className="col-span-2 space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-chip-500">Material</span>
              <Input
                defaultValue={l.materialName}
                disabled={locked || busy}
                className="h-10"
                onBlur={(e) => e.target.value !== l.materialName && void save(l, { materialName: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-chip-500">Packages</span>
              <Input
                type="number"
                inputMode="numeric"
                defaultValue={l.quantity}
                disabled={locked || busy}
                className="h-10"
                onBlur={(e) => Number(e.target.value) !== l.quantity && void save(l, { quantity: Number(e.target.value) })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-chip-500">Type</span>
              <Input
                defaultValue={l.unit ?? ''}
                disabled={locked || busy}
                className="h-10"
                onBlur={(e) => e.target.value !== (l.unit ?? '') && void save(l, { unit: e.target.value })}
              />
            </label>
            <label className="col-span-2 space-y-1 sm:col-span-4">
              <span className="text-[10px] uppercase tracking-wide text-chip-500">Weight of one package</span>
              <Input
                type="number"
                inputMode="decimal"
                defaultValue={l.weight ?? ''}
                disabled={locked || busy}
                className="h-10"
                placeholder="e.g. 25"
                onBlur={(e) =>
                  Number(e.target.value || 0) !== (l.weight ?? 0) &&
                  void save(l, { weight: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
          </div>
        ))}
      </div>

      {!locked && (
        <Button className="h-12 w-full gap-2" disabled={busy} onClick={() => void send()}>
          <Send className="h-4 w-4" /> Looks right — send to Store
        </Button>
      )}
    </div>
  )
}
