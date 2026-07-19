import { useEffect, useRef, useState } from 'react'
import { FileDown, Printer, Loader2, CheckCircle2, RotateCcw, QrCode } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/useToast'

type Stage = 'idle' | 'generating' | 'ready'

/**
 * Explicit GENERATE → SAVE → PRINT flow for a label roll (item 4).
 *
 * Previously "download" did all three implicitly, so a 100+ label batch looked like an
 * unexplained freeze. Now each stage is its own visible step:
 *   1. Generate — builds the PDF server-side, with a progress indicator + ETA
 *   2. Save     — downloads the generated file
 *   3. Print    — opens it in the browser's print dialog
 * The generated PDF is held in memory, so saving and printing never regenerate it.
 */
export function LabelRollFlow({
  path,
  fileName,
  unitCount,
  label = 'label roll',
}: {
  /** API path returning the PDF, e.g. `/purchase-orders/x/labels.pdf`. */
  path: string
  /** Suggested download filename. */
  fileName: string
  /** How many labels — drives the progress estimate. */
  unitCount: number
  label?: string
}) {
  const [stage, setStage] = useState<Stage>('idle')
  const [pct, setPct] = useState(0)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  // Revoke the object URL when this unmounts or a new PDF replaces it.
  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  /**
   * Measured server rate is ~26 ms/label; we pace the bar to that estimate and hold at
   * 90% until the real response lands, so the bar never lies about being finished.
   */
  const estimatedMs = Math.max(800, unitCount * 30)

  const generate = async () => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl)
      setBlobUrl(null)
    }
    setStage('generating')
    setPct(0)

    const started = Date.now()
    timer.current = window.setInterval(() => {
      const elapsed = Date.now() - started
      setPct(Math.min(90, Math.round((elapsed / estimatedMs) * 100)))
    }, 100)

    try {
      const { url } = await api.fetchBlobUrl(path)
      setBlobUrl(url)
      setPct(100)
      setStage('ready')
    } catch (err) {
      setStage('idle')
      setPct(0)
      toast({
        variant: 'destructive',
        title: 'Could not generate labels',
        description: err instanceof ApiError ? err.message : 'Please try again.',
      })
    } finally {
      if (timer.current) window.clearInterval(timer.current)
      timer.current = null
    }
  }

  const save = () => {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: 'Saved', description: fileName })
  }

  const print = () => {
    if (!blobUrl) return
    // Open in a new tab and trigger the print dialog once it has rendered.
    const w = window.open(blobUrl, '_blank')
    if (!w) {
      toast({
        variant: 'destructive',
        title: 'Pop-up blocked',
        description: 'Allow pop-ups for this site, or use Save and print the file.',
      })
      return
    }
    w.addEventListener('load', () => {
      try {
        w.focus()
        w.print()
      } catch {
        /* the user can still print from the viewer */
      }
    })
  }

  return (
    <div className="rounded-lg border p-3">
      {/* Step indicator */}
      <ol className="mb-3 flex items-center gap-2 text-xs">
        <Step n={1} label="Generate" active={stage === 'generating'} done={stage === 'ready'} />
        <span className="h-px flex-1 bg-border" />
        <Step n={2} label="Save" active={false} done={false} dim={stage !== 'ready'} />
        <span className="h-px flex-1 bg-border" />
        <Step n={3} label="Print" active={false} done={false} dim={stage !== 'ready'} />
      </ol>

      {stage === 'generating' && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating {unitCount} label{unitCount === 1 ? '' : 's'}…
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all duration-150" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {stage === 'ready' && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-4 w-4" />
          {unitCount} label{unitCount === 1 ? '' : 's'} ready — save the file or print it now.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {stage !== 'ready' ? (
          <Button onClick={generate} disabled={stage === 'generating' || unitCount === 0} className="gap-1.5">
            <QrCode className="h-4 w-4" />
            {stage === 'generating' ? 'Generating…' : `Generate ${label}`}
          </Button>
        ) : (
          <>
            <Button onClick={save} className="gap-1.5">
              <FileDown className="h-4 w-4" /> Save PDF
            </Button>
            <Button onClick={print} variant="outline" className="gap-1.5">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={generate} variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <RotateCcw className="h-4 w-4" /> Regenerate
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function Step({
  n,
  label,
  active,
  done,
  dim,
}: {
  n: number
  label: string
  active?: boolean
  done?: boolean
  dim?: boolean
}) {
  return (
    <li className={`flex items-center gap-1.5 ${dim ? 'opacity-40' : ''}`}>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
          done
            ? 'bg-success text-success-foreground'
            : active
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <span className={done || active ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
    </li>
  )
}
