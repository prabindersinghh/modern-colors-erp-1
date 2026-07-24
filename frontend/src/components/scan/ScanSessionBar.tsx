import { useState } from 'react'
import { Play, Square, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from '@/hooks/useToast'
import { useScanSession, type ScanKind } from '@/lib/useScanSession'

/**
 * Start/Done around a scanning run, gating the children on an OPEN server session.
 *
 * Scanning simply isn't shown until Start is pressed — and even if the UI were bypassed,
 * the server refuses a scan with no open session. Done closes the session and shows the
 * run's count, the same style of closing summary the client-only sessions gave, now
 * driven by the server's real total.
 */
export function ScanSessionBar({
  kind,
  title,
  children,
}: {
  kind: ScanKind
  title: string
  children: React.ReactNode
}) {
  const { session, isOpen, loading, busy, start, done } = useScanSession(kind)
  const [lastSummary, setLastSummary] = useState<{ scanCount: number } | null>(null)

  const onStart = async () => {
    try {
      await start()
      setLastSummary(null)
    } catch {
      toast({ variant: 'destructive', title: 'Could not start the session' })
    }
  }
  const onDone = async () => {
    try {
      const summary = await done()
      setLastSummary(summary)
      toast({ title: 'Session closed', description: `${summary.scanCount} scanned this session` })
    } catch {
      toast({ variant: 'destructive', title: 'Could not close the session' })
    }
  }

  if (loading) return <p className="text-sm text-chip-500">Loading…</p>

  if (!isOpen) {
    return (
      <Card edge="primary">
        <CardContent className="space-y-3 p-4 text-center">
          <div>
            <h2 className="text-title-3 text-chip-900">{title}</h2>
            <p className="mt-1 text-sm text-chip-600">
              Start a session before scanning. Every scan is recorded against it, and it is
              closed with a count when you are done.
            </p>
          </div>
          {lastSummary && (
            <p className="text-sm font-medium text-healthy">
              Last session: {lastSummary.scanCount} scanned.
            </p>
          )}
          <Button className="h-12 w-full gap-2" disabled={busy} onClick={() => void onStart()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Start session
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-chip-900">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-healthy" />
          Session live · {session?.scanCount ?? 0} scanned
        </span>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={busy} onClick={() => void onDone()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Done
        </Button>
      </div>
      {children}
    </div>
  )
}
