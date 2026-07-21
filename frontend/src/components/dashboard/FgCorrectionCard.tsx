import { useState } from 'react'
import { PenLine, Search, AlertTriangle } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { FinishedGood } from '@/types/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/useToast'

/**
 * The factory Admin's ONE write: an audited correction to a finished-goods record.
 * Non-identity fields only — the server refuses everything else, records before→after
 * with a required reason, and flags the label for reprint when a printed field changed.
 */
export function FgCorrectionCard() {
  const [query, setQuery] = useState('')
  const [unit, setUnit] = useState<FinishedGood | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ productName: '', sizePerPackage: '', sizeUnit: '', dispatchNote: '', note: '' })

  const lookup = async () => {
    const id = query.trim()
    if (!id) return
    setBusy(true)
    try {
      const u = await api.get<FinishedGood>(`/finished-goods/unit/${encodeURIComponent(id)}`)
      setUnit(u)
      setForm({
        productName: u.productName,
        sizePerPackage: String(u.sizePerPackage),
        sizeUnit: u.sizeUnit,
        dispatchNote: u.dispatchNote ?? '',
        note: '',
      })
    } catch (err) {
      toast({ variant: 'destructive', title: 'Not found', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!unit) return
    if (!form.note.trim()) {
      toast({ variant: 'destructive', title: 'A reason is required', description: 'Every correction is audited with why.' })
      return
    }
    // Send only what actually differs — the server also enforces this.
    const body: Record<string, unknown> = { note: form.note.trim() }
    if (form.productName.trim() && form.productName.trim() !== unit.productName) body.productName = form.productName.trim()
    if (form.sizePerPackage && Number(form.sizePerPackage) !== unit.sizePerPackage) body.sizePerPackage = Number(form.sizePerPackage)
    if (form.sizeUnit && form.sizeUnit !== unit.sizeUnit) body.sizeUnit = form.sizeUnit
    if ((form.dispatchNote.trim() || null) !== (unit.dispatchNote ?? null)) body.dispatchNote = form.dispatchNote.trim() || null
    if (Object.keys(body).length === 1) {
      toast({ variant: 'destructive', title: 'Nothing to correct', description: 'No field differs from the record.' })
      return
    }
    setBusy(true)
    try {
      const res = await api.post<{ unit: FinishedGood; labelReprintNeeded: boolean }>(
        `/finished-goods/corrections/${encodeURIComponent(unit.uniqueId)}`,
        body,
      )
      toast({
        title: `${unit.uniqueId} corrected`,
        description: res.labelReprintNeeded
          ? 'A printed field changed — the physical label needs reprinting.'
          : 'Recorded in the audit trail.',
      })
      setUnit(null)
      setQuery('')
    } catch (err) {
      toast({ variant: 'destructive', title: 'Correction refused', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-title-3">
          <PenLine className="h-4 w-4 text-chip-400" /> Correct a finished-goods record
          <span className="text-xs font-normal text-chip-500">audited · non-identity fields only</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void lookup()}
            placeholder="FG-000001"
            className="h-10 font-mono"
          />
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => void lookup()} disabled={busy}>
            <Search className="h-4 w-4" /> Find
          </Button>
        </div>

        {unit && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-sm">
              <span className="font-mono font-semibold">{unit.uniqueId}</span>
              <span className="text-muted-foreground">
                {' '}· Batch {unit.batch?.batchNumber} · {unit.status.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Product name</Label>
                <Input value={form.productName} onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Size per package</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={form.sizePerPackage}
                    onChange={(e) => setForm((f) => ({ ...f, sizePerPackage: e.target.value }))}
                  />
                  <select
                    value={form.sizeUnit}
                    onChange={(e) => setForm((f) => ({ ...f, sizeUnit: e.target.value }))}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="L">L</option>
                    <option value="Kg">Kg</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Dispatch note</Label>
                <Input value={form.dispatchNote} onChange={(e) => setForm((f) => ({ ...f, dispatchNote: e.target.value }))} placeholder="empty clears the note" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Reason for the correction (required)</Label>
                <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. name typo on entry" />
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-chip-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Identity never changes here — unit ID, status, batch, dispatch and return facts are
              untouchable. If the name or size changes, the drum's label must be reprinted.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void submit()} disabled={busy || !form.note.trim()}>
                Record correction
              </Button>
              <Button variant="outline" onClick={() => setUnit(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
