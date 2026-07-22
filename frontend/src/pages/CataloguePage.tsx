import { useEffect, useRef, useState } from 'react'
import { useAutoRefresh } from '@/lib/refresh'
import { Upload, Plus, BookMarked, AlertTriangle, FileDown } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { CatalogueItem, Paginated } from '@/types/api'
import { useAuth } from '@/lib/auth'
import { useUrlFlag, useUrlText } from '@/lib/urlState'
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
import { Modal } from '@/components/common/Modal'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from '@/hooks/useToast'
import { ImportReviewDialog, type ImportPreview } from '@/components/catalogue/ImportReviewDialog'


const isProvisional = (sku: string) => sku.startsWith('TMP-')

export function CataloguePage() {
  const { hasRole } = useAuth()
  const isAdmin = hasRole('ADMIN')
  const canEdit = hasRole('ADMIN') || hasRole('OPERATOR')
  const [items, setItems] = useState<CatalogueItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useUrlText('q')
  const [provisionalOnly, setProvisionalOnly] = useUrlFlag('provisional')
  const [provisionalCount, setProvisionalCount] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [preview, setPreview] = useState<{ file: File; data: ImportPreview } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = (q = search, prov = provisionalOnly) =>
    api
      .get<Paginated<CatalogueItem>>(
        `/catalogue?pageSize=200&search=${encodeURIComponent(q)}${prov ? '&provisional=true' : ''}`,
      )
      .then((r) => {
        setItems(r.data)
        setTotal(r.total)
      })
      .catch(() => {})

  const loadCount = () =>
    api.get<{ count: number }>('/catalogue/provisional-count').then((r) => setProvisionalCount(r.count)).catch(() => {})

  useEffect(() => {
    // Defaults to the current search/provisional filter, so arriving with ?q= in the
    // URL lists the matching SKUs rather than the whole catalogue.
    void load()
    void loadCount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Min/max edits or imports from another session appear on focus/reconnect.
  useAutoRefresh(() => { void load(); void loadCount() })

  const refresh = async () => {
    await load()
    await loadCount()
  }

  /** Download the import template so Store fills in a known-good structure. */
  const downloadTemplate = async (format: 'csv' | 'xlsx') => {
    try {
      await api.downloadBlob(
        `/catalogue/import/template?format=${format}`,
        `catalogue-template.${format}`,
      )
    } catch {
      toast({ variant: 'destructive', title: 'Could not download the template' })
    }
  }

  // Step 1: parse + preview (no writes).
  const onPickFile = async (file: File) => {
    setPreviewBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // Validating preview: parse + deterministic checks + (best-effort) AI pass.
      // Falls back gracefully — the endpoint never fails because AI is unavailable.
      const data = await api.postForm<ImportPreview>('/catalogue/import/validate', form)
      setPreview({ file, data })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not read file',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setPreviewBusy(false)
    }
  }


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search material / SKU / category…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            load(e.target.value)
          }}
          className="max-w-xs"
        />
        <div className="ml-auto flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add SKU
          </Button>
          {isAdmin && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPickFile(f)
                  e.target.value = ''
                }}
              />
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => downloadTemplate('xlsx')}
                title="Download a ready-made file with the correct columns and examples"
              >
                <FileDown className="h-4 w-4" /> Template
              </Button>
              <Button className="gap-1.5" onClick={() => fileInput.current?.click()} disabled={previewBusy}>
                <Upload className="h-4 w-4" /> {previewBusy ? 'Checking…' : 'Import CSV/Excel'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{total} {provisionalOnly ? 'provisional ' : ''}SKUs</p>
        {/* Gentle nudge: how many materials still need a real SKU. */}
        {provisionalCount > 0 && (
          <button
            onClick={() => {
              const next = !provisionalOnly
              setProvisionalOnly(next)
              load(search, next)
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
              provisionalOnly
                ? 'border-warning bg-warning text-white'
                : 'border-warning-border bg-warning-surface text-warning-foreground hover:bg-warning-surface'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {provisionalCount} awaiting a real SKU
            {provisionalOnly ? ' · show all' : ''}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title={provisionalOnly ? 'No provisional SKUs' : 'No catalogue items'}
          description={provisionalOnly ? 'Every material has a real SKU.' : 'Import a CSV/Excel master list or add SKUs manually.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Material</TableHead>
                <TableHead className="min-w-[160px]">SKU</TableHead>
                <TableHead>HSN Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Packaging</TableHead>
                <TableHead className="whitespace-nowrap">Min / Max stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} className={isProvisional(it.sku) ? 'bg-warning-surface' : ''}>
                  <TableCell className="font-medium">{it.materialName}</TableCell>
                  <TableCell>
                    <SkuCell item={it} canEdit={canEdit} onSaved={refresh} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{it.hsnCode ?? '—'}</TableCell>
                  <TableCell>{it.category ?? '—'}</TableCell>
                  <TableCell>{it.unit ?? '—'}</TableCell>
                  <TableCell>{it.standardPackaging ?? '—'}</TableCell>
                  <TableCell>
                    <MinMaxCell item={it} canEdit={isAdmin} onSaved={refresh} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddSkuModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={refresh} />
      {preview && (
        <ImportReviewDialog
          preview={preview.data}
          onCancel={() => setPreview(null)}
          onImported={() => {
            setPreview(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}


/**
 * Min/max stock thresholds, Admin-editable inline. In the material's OWN unit; they
 * drive the stock-percentage display and replace the built-in low-stock defaults for
 * this material. Server validates max > min and audits the change.
 */
function MinMaxCell({ item, canEdit, onSaved }: { item: CatalogueItem; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const minLevel = min.trim() === '' ? null : Number(min)
    const maxLevel = max.trim() === '' ? null : Number(max)
    if ((minLevel != null && !(minLevel >= 0)) || (maxLevel != null && !(maxLevel >= 0))) {
      toast({ variant: 'destructive', title: 'Levels must be zero or more' })
      return
    }
    if (minLevel != null && maxLevel != null && maxLevel <= minLevel) {
      toast({ variant: 'destructive', title: 'Max must be greater than min' })
      return
    }
    setBusy(true)
    try {
      await api.patch(`/catalogue/${item.id}`, { minLevel, maxLevel })
      toast({ title: 'Stock levels updated', description: item.materialName })
      setEditing(false)
      onSaved()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update levels', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="number"
          min={0}
          step="any"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          placeholder="min"
          className="h-7 w-16 text-xs"
        />
        <span className="text-xs text-muted-foreground">/</span>
        <Input
          type="number"
          min={0}
          step="any"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder="max"
          className="h-7 w-16 text-xs"
        />
        <Button size="sm" className="h-7" onClick={save} disabled={busy}>Save</Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>✕</Button>
      </div>
    )
  }

  const label =
    item.minLevel != null || item.maxLevel != null
      ? `${item.minLevel ?? '—'} / ${item.maxLevel ?? '—'}`
      : null

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={label ? 'tabular text-chip-700' : 'text-muted-foreground'}>{label ?? 'not set'}</span>
      {canEdit && (
        <button
          type="button"
          className="tactile text-[11px] font-medium text-chip-500 underline-offset-2 hover:text-primary hover:underline"
          onClick={() => {
            setMin(item.minLevel != null ? String(item.minLevel) : '')
            setMax(item.maxLevel != null ? String(item.maxLevel) : '')
            setEditing(true)
          }}
        >
          Edit
        </button>
      )}
    </div>
  )
}

/** SKU cell: shows the code + a "Provisional" badge for TMP- entries, with one-click
 * inline edit to replace a provisional code with a real SKU (audited server-side). */
function SkuCell({ item, canEdit, onSaved }: { item: CatalogueItem; canEdit: boolean; onSaved: () => void }) {
  const provisional = isProvisional(item.sku)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const sku = value.trim()
    if (!sku || sku === item.sku) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await api.patch(`/catalogue/${item.id}`, { sku })
      toast({ title: 'SKU updated', description: `${item.materialName} → ${sku}` })
      setEditing(false)
      setValue('')
      onSaved()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not update SKU', description: err instanceof ApiError ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="Real SKU"
          className="h-7 w-32 font-mono text-xs"
        />
        <Button size="sm" className="h-7" onClick={save} disabled={busy}>Save</Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>✕</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`font-mono text-xs ${provisional ? 'text-warning-foreground' : ''}`}>{item.sku}</span>
      {provisional && (
        <span className="rounded border border-warning-border bg-warning-surface px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
          Provisional — SKU pending
        </span>
      )}
      {canEdit && (
        <button
          onClick={() => { setValue(provisional ? '' : item.sku); setEditing(true) }}
          className="text-[11px] font-medium text-chip-600 hover:text-accent-brand"
        >
          {provisional ? 'Set real SKU' : 'Edit'}
        </button>
      )}
    </div>
  )
}

function AddSkuModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [form, setForm] = useState({ materialName: '', sku: '', hsnCode: '', category: '', unit: '', standardPackaging: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const submit = async () => {
    if (!form.materialName.trim()) return
    setBusy(true)
    try {
      await api.post('/catalogue', {
        materialName: form.materialName.trim(),
        sku: form.sku.trim() || undefined,
        hsnCode: form.hsnCode.trim() || undefined,
        category: form.category.trim() || undefined,
        unit: form.unit.trim() || undefined,
        standardPackaging: form.standardPackaging.trim() || undefined,
      })
      toast({ title: 'SKU added' })
      setForm({ materialName: '', sku: '', hsnCode: '', category: '', unit: '', standardPackaging: '' })
      onAdded()
      onClose()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Could not add SKU',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add a new SKU">
      <div className="space-y-3">
        {(
          [
            ['materialName', 'Material name *'],
            ['sku', 'SKU (optional — auto-generated if blank)'],
            ['hsnCode', 'HSN code'],
            ['category', 'Category'],
            ['unit', 'Unit'],
            ['standardPackaging', 'Standard packaging'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={k}>{label}</Label>
            <Input id={k} value={form[k]} onChange={set(k)} />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !form.materialName.trim()}>
            {busy ? 'Adding…' : 'Add SKU'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
