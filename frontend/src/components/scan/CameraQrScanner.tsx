import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState, type CameraDevice } from 'html5-qrcode'
import { CameraOff, Loader2 } from 'lucide-react'

interface CameraQrScannerProps {
  onResult: (text: string) => void
  /** Pause decoding (e.g. while the parent processes a scan). */
  paused?: boolean
}

const REGION_ID = 'qr-camera-region'

/**
 * Live rear-camera QR scanner (mobile-first) built on html5-qrcode.
 * Requests the environment-facing camera, decodes continuously, and de-dupes
 * repeat reads of the same code. Falls back gracefully if the camera or
 * permission is unavailable (manual entry remains on the page).
 */
export function CameraQrScanner({ onResult, paused = false }: CameraQrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    let cancelled = false
    let scanner: Html5Qrcode
    try {
      scanner = new Html5Qrcode(REGION_ID, { verbose: false })
    } catch {
      setStatus('error')
      setError('Scanner could not initialise. Use manual entry below.')
      return
    }
    scannerRef.current = scanner

    const onDecode = (text: string) => {
      if (pausedRef.current) return
      const now = Date.now()
      // De-dupe: ignore the same code re-read within 2.5s.
      if (text === lastRef.current.text && now - lastRef.current.at < 2500) return
      lastRef.current = { text, at: now }
      onResult(text)
    }

    const config = {
      fps: 10,
      qrbox: (w: number, h: number) => {
        const size = Math.floor(Math.min(w, h) * 0.7)
        return { width: size, height: size }
      },
      aspectRatio: 1,
    }

    const start = async () => {
      try {
        await scanner.start({ facingMode: 'environment' }, config, onDecode, () => {})
        if (!cancelled) setStatus('running')
      } catch {
        // Fallback: enumerate cameras and pick a rear one explicitly.
        try {
          const cams: CameraDevice[] = await Html5Qrcode.getCameras()
          if (!cams.length) throw new Error('No camera found')
          const rear =
            cams.find((c) => /back|rear|environment/i.test(c.label)) ?? cams[cams.length - 1]
          await scanner.start(rear.id, config, onDecode, () => {})
          if (!cancelled) setStatus('running')
        } catch (err2) {
          if (cancelled) return
          setStatus('error')
          setError(
            err2 instanceof Error && /permission|denied|NotAllowed/i.test(err2.message)
              ? 'Camera permission denied. Allow camera access, or use manual entry below.'
              : 'No camera available. Use manual entry below.',
          )
        }
      }
    }
    void start()

    return () => {
      cancelled = true
      const s = scannerRef.current
      if (!s) return
      // Only stop a scanner that is actually running — stop() throws otherwise.
      // Guard every call so React StrictMode's double-mount can't crash the page.
      try {
        const state = s.getState?.()
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
          s.stop()
            .then(() => {
              try {
                s.clear()
              } catch {
                /* noop */
              }
            })
            .catch(() => {})
        } else {
          try {
            s.clear()
          } catch {
            /* noop */
          }
        }
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-2">
      <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-lg border bg-black">
        <div id={REGION_ID} className="mx-auto w-full [&_video]:block [&_video]:w-full" />
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting camera…
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CameraOff className="h-6 w-6" />
            <span>{error}</span>
          </div>
        )}
      </div>
      {status === 'running' && (
        <p className="text-center text-xs text-muted-foreground">
          Point the rear camera at a unit's QR code.
        </p>
      )}
    </div>
  )
}
