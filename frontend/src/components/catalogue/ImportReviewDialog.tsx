import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/common/Modal'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/useToast'

export type FlagField =
  | 'materialName' | 'sku' | 'hsnCode' | 'category' | 'unit' | 'standardPackaging' | null

export interface RowFlag {
  row: number
  field: FlagField
  severity: 'error' | 'warning'
  message: string
  suggestion?: string | null
}

export interface ValidationResult {
  flags: RowFlag[]
  aiUsed: boolean
  aiSkippedReason?: string
  usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }
  ms: number
}

export interface PreviewRow {
  row: number
  materialName: string | null
  sku: string | null
  hsnCode: string | null
  category: string | null
  unit: string | null
  standardPackaging: string | null
  valid: boolean
  error: string | null
}

export interface ImportPreview {
  rows: PreviewRow[]
  totalRows: number
  validRows: number
  invalidRows: number
  detectedColumns: string[]
  validation?: ValidationResult
}

const EDITABLE: { key: keyof PreviewRow; label: string; mono?: boolean; width: string }[] = [
  { key: 'materialName', label: 'Material', width: 'min-w-[180px]' },
  { key: 'sku', label: 'SKU', mono: true, width: 'min-w-[110px]' },
  { key: 'hsnCode', label: 'HSN', mono: true, width: 'min-w-[90px]' },
  { key: 'category', label: 'Category', width: 'min-w-[110px]' },
  { key: 'unit', label: 'Unit', width: 'min-w-[70px]' },
  { key: 'standardPackaging', label: 'Packaging', width: 'min-w-[130px]' },
]

/**
 * Review-and-fix dialog for a catalogue import.
 *
 * Store can correct flagged cells HERE and import, rather than editing the source file
 * and re-uploading. Rows are individually selectable, so a file with a few bad rows can
 * still have its good rows imported now and the rest sorted out later.
 *
 * AI validation is assistive: if it did not run (no key, timeout, skipped, file too
 * large) the dialog still works on the deterministic checks and the plain preview.
 */
export function ImportReviewDialog({
  preview,
  onCancel,
  onImported,
}: {
  preview: ImportPreview
  onCancel: () => void
  onImported: () => void
}) {
  // Local editable copy — the operator's fixes live here until they import.
  const [rows, setRows] = useState<PreviewRow[]>(preview.rows)
  const [validation, setValidation] = useState<ValidationResult | undefined>(preview.validation)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preview.rows.filter((r) => r.valid).map((r) => r.row)),
  )
  const [busy, setBusy] = useState(false)
  const [revalidating, setRevalidating] = useState(false)

  // row -> field -> flag, for O(1) lookup while rendering the table.
  const flagMap = useMemo(() => {
    const m = new Map<number, RowFlag[]>()
    for (const f of validation?.flags ?? []) {
      m.set(f.row, [...(m.get(f.row) ?? []), f])
    }
    return m
  }, [validation])

  const flagFor = (row: number, field: FlagField) =>
    (flagMap.get(row) ?? []).find((f) => f.field === field)

  const errorRows = useMemo(
    () => new Set((validation?.flags ?? []).filter((f) => f.severity === 'error').map((f) => f.row)),
    [validation],
  )

  const edit = (row: number, key: keyof PreviewRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.row === row ? { ...r, [key]: value.trim() === '' ? null : value } : r)),
    )
  }

  const toggle = (row: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }

  const revalidate = async (useAi: boolean) => {
    setRevalidating(true)
    try {
      const res = await api.post<ValidationResult>('/catalogue/import/revalidate', {
        ai: useAi,
        rows: rows.map((r) => ({
          row: r.row,
          materialName: r.materialName ?? '',
          sku: r.sku,
          hsnCode: r.hsnCode,
          category: r.category,
          unit: r.unit,
          standardPackaging: r.standardPackaging,
        })),
      })
      setValidation(res)
      toast({
        title: res.flags.length === 0 ? 'No issues found' : `${res.flags.length} issue(s) flagged`,
        description: res.aiUsed ? 'Checked with AI.' : 'Basic checks only.',
      })
    } catch (err) {
      // Re-validation failing must never strand the operator — they can still import.
      toast({
        variant: 'destructive',
        title: 'Could not re-check',
        description: err instanceof ApiError ? err.message : 'You can still import.',
      })
    } finally {
      setRevalidating(false)
    }
  }

  const importSelected = async () => {
    const chosen = rows.filter((r) => selected.has(r.row) && (r.materialName ?? '').trim())
    if (chosen.length === 0) return
    setBusy(true)
    try {
      const r = await api.post<{ created: number; updated: number; skipped: number; errors: unknown[] }>(
        '/catalogue/import/rows',
        {
          rows: chosen.map((c) => ({
            materialName: (c.materialName ?? '').trim(),
            sku: c.sku,
            hsnCode: c.hsnCode,
            category: c.category,
            unit: c.unit,
            standardPackaging: c.standardPackaging,
          })),
        },
      )
      toast({
        title: 'Catalogue imported',
        description:
          `${r.created} created, ${r.updated} updated` +
          (r.skipped ? `, ${r.skipped} skipped` : '') + '.',
      })
      onImported()
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Import failed',
        description: err instanceof ApiError ? err.message : 'Unexpected error',
      })
    } finally {
      setBusy(false)
    }
  }

  const selectableCount = rows.filter((r) => (r.materialName ?? '').trim()).length
  const chosenCount = rows.filter((r) => selected.has(r.row) && (r.materialName ?? '').trim()).length

  return (
    <Modal open onOpenChange={(o) => !o && onCancel()} title="Review import">
      <div className="space-y-3">
        {/* Summary */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <span className="inline-flex items-center gap-1 text-healthy">
            <CheckCircle2 className="h-4 w-4" /> {chosenCount} selected
          </span>
          {errorRows.size > 0 && (
            <span className="inline-flex items-center gap-1 text-critical">
              <XCircle className="h-4 w-4" /> {errorRows.size} with errors
            </span>
          )}
          {(validation?.flags.length ?? 0) > errorRows.size && (
            <span className="inline-flex items-center gap-1 text-brand-amber">
              <AlertTriangle className="h-4 w-4" />
              {(validation?.flags.length ?? 0) - errorRows.size} warnings
            </span>
          )}
          <span className="text-chip-500">{rows.length} rows in file</span>
        </div>

        {/* Validation status — always honest about whether AI actually ran. */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-chip-50 px-3 py-2 text-xs">
          {validation?.aiUsed ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-healthy">
              <Sparkles className="h-3.5 w-3.5" /> Checked with AI
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-chip-600">
              <Sparkles className="h-3.5 w-3.5" /> Basic checks only
              {validation?.aiSkippedReason === 'no_key' && ' — no API key in Settings'}
              {validation?.aiSkippedReason === 'skipped' && ' — AI check skipped'}
              {validation?.aiSkippedReason?.startsWith('too_many_rows') && ' — file too large for AI check'}
            </span>
          )}
          {validation?.usage && (
            <span className="text-chip-400">
              · {validation.usage.inputTokens + validation.usage.outputTokens} tokens · $
              {validation.usage.estimatedCostUsd.toFixed(4)}
            </span>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={revalidating} onClick={() => revalidate(false)}>
              Re-check
            </Button>
            <Button size="sm" variant="outline" disabled={revalidating} onClick={() => revalidate(true)}>
              {revalidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Check with AI
            </Button>
          </div>
        </div>

        {/* Editable rows */}
        <div className="max-h-[46vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all importable rows"
                    checked={chosenCount > 0 && chosenCount === selectableCount}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(rows.filter((r) => (r.materialName ?? '').trim()).map((r) => r.row))
                          : new Set(),
                      )
                    }
                  />
                </TableHead>
                <TableHead className="w-10">#</TableHead>
                {EDITABLE.map((c) => (
                  <TableHead key={c.key} className={c.width}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const rowFlags = flagMap.get(r.row) ?? []
                const hasError = rowFlags.some((f) => f.severity === 'error')
                const hasWarn = rowFlags.some((f) => f.severity === 'warning')
                return (
                  <TableRow
                    key={r.row}
                    className={cn(
                      hasError && 'bg-critical-surface',
                      !hasError && hasWarn && 'bg-warning-surface',
                    )}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Import row ${r.row}`}
                        checked={selected.has(r.row)}
                        disabled={!(r.materialName ?? '').trim()}
                        onChange={() => toggle(r.row)}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-chip-500">{r.row}</TableCell>
                    {EDITABLE.map((c) => {
                      const flag = flagFor(r.row, c.key as FlagField)
                      return (
                        <TableCell key={c.key} className="p-1.5 align-top">
                          <Input
                            value={(r[c.key] as string | null) ?? ''}
                            onChange={(e) => edit(r.row, c.key, e.target.value)}
                            title={flag?.message}
                            className={cn(
                              'h-8 text-xs',
                              c.mono && 'font-mono',
                              flag?.severity === 'error' && 'border-critical bg-card',
                              flag?.severity === 'warning' && 'border-warning bg-card',
                            )}
                          />
                          {flag && (
                            <p
                              className={cn(
                                'mt-0.5 text-[11px] leading-snug',
                                flag.severity === 'error' ? 'text-critical' : 'text-warning-foreground',
                              )}
                            >
                              {flag.message}
                              {flag.suggestion && (
                                <button
                                  type="button"
                                  className="ml-1 underline underline-offset-2"
                                  onClick={() => edit(r.row, c.key, flag.suggestion as string)}
                                >
                                  use “{flag.suggestion}”
                                </button>
                              )}
                            </p>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {/* Row-level flags with no specific column (e.g. "this looks like a heading"). */}
        {(validation?.flags ?? []).some((f) => f.field === null) && (
          <ul className="space-y-1 text-xs">
            {(validation?.flags ?? [])
              .filter((f) => f.field === null)
              .map((f, i) => (
                <li key={i} className={f.severity === 'error' ? 'text-critical' : 'text-warning-foreground'}>
                  Row {f.row}: {f.message}
                </li>
              ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={importSelected} disabled={busy || chosenCount === 0}>
            {busy ? 'Importing…' : `Import ${chosenCount} row${chosenCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
