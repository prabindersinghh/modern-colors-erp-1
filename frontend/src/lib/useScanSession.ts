import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

export type ScanKind = 'RECEIVING' | 'DISPATCH' | 'PACKING'

export interface ScanSession {
  id: string
  kind: ScanKind
  openedAt: string
  closedAt: string | null
  scanCount: number
}

/**
 * The client half of server-enforced scan sessions. The SERVER refuses a scan outside an
 * open session; this only reflects and drives that state so the UI can gate its own
 * controls and show a Start/Done. The localStorage session of old is gone — this single
 * server record is the one source of truth.
 */
export function useScanSession(kind: ScanKind) {
  const [session, setSession] = useState<ScanSession | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(
    () =>
      api
        .get<ScanSession | null>(`/scan-sessions/current?kind=${kind}`)
        .then((s) => setSession(s ?? null))
        .catch(() => setSession(null)),
    [kind],
  )
  useEffect(() => void refresh(), [refresh])

  const start = useCallback(async () => {
    setBusy(true)
    try {
      const s = await api.post<ScanSession>('/scan-sessions', { kind })
      setSession(s)
      return s
    } finally {
      setBusy(false)
    }
  }, [kind])

  const done = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.post<{ summary: { scanCount: number; openedAt: string; closedAt: string } }>(
        `/scan-sessions/${kind}/close`,
      )
      setSession(null)
      return res.summary
    } finally {
      setBusy(false)
    }
  }, [kind])

  return { session, isOpen: !!session, loading: session === undefined, busy, start, done, refresh }
}
