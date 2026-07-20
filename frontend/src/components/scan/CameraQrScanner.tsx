import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState, type CameraDevice } from 'html5-qrcode'
import { CameraOff, Loader2, Camera, RefreshCw } from 'lucide-react'

interface CameraQrScannerProps {
  onResult: (text: string) => void
  /** Pause decoding (e.g. while the parent processes a scan). */
  paused?: boolean
  /**
   * Skip the "Tap to start" gate and open the camera immediately on mount. Only honoured
   * once the camera has already run successfully in this session (see `cameraUnlocked`)
   * — the FIRST start always needs a real user gesture, which mobile browsers require.
   */
  autoStart?: boolean
}

const REGION_ID = 'qr-camera-region'

/**
 * Set after the first successful start. Browsers require a user gesture before the
 * initial getUserMedia, but once permission is granted in this session further calls
 * succeed without one — which is what lets the scan → confirm → scan loop reopen the
 * camera automatically instead of asking for a tap every single time.
 */
let cameraUnlocked = false

const SCAN_CONFIG = {
  fps: 15,
  qrbox: (w: number, h: number) => {
    const size = Math.max(200, Math.floor(Math.min(w, h) * 0.8))
    return { width: size, height: size }
  },
  aspectRatio: 1,
  // Native BarcodeDetector when supported (Android Chrome) — faster + more reliable.
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
}

const isPermissionError = (e: unknown) =>
  (e instanceof DOMException && e.name === 'NotAllowedError') ||
  (e instanceof Error && /permission|denied|notallowed/i.test(e.message))

// Fully stop + clear a scanner instance so its DOM is clean before we build a fresh
// one. A FRESH instance per attempt avoids html5-qrcode's "already under transition"
// error, which is thrown if start() is called again on an instance whose previous
// start() failed mid-transition.
async function disposeScanner(s: Html5Qrcode | null) {
  if (!s) return
  try {
    const st = s.getState?.()
    if (st === Html5QrcodeScannerState.SCANNING || st === Html5QrcodeScannerState.PAUSED) {
      try {
        await s.stop()
      } catch {
        /* noop */
      }
    }
    try {
      s.clear()
    } catch {
      /* noop */
    }
  } catch {
    /* noop */
  }
}

/**
 * Live rear-camera QR scanner (mobile-first) built on html5-qrcode.
 *
 * Started by an explicit TAP (mobile browsers block getUserMedia without a user
 * gesture). Each start attempt uses a fresh Html5Qrcode instance and tries a
 * sequence of cameras (rear → any → each enumerated device). Manual entry always
 * remains available on the page.
 */
export function CameraQrScanner({ onResult, paused = false, autoStart = true }: CameraQrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const cancelledRef = useRef(false)
  const startingRef = useRef(false)
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      // Genuinely stops the media track — the phone's camera is released, not just hidden.
      void disposeScanner(scannerRef.current)
      scannerRef.current = null
    }
  }, [])


  const startCamera = useCallback(async () => {
    if (startingRef.current) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('Camera needs a secure (HTTPS) connection. Use manual entry below.')
      return
    }
    startingRef.current = true
    setStatus('starting')
    setError(null)

    const onDecode = (text: string) => {
      if (pausedRef.current) return
      const now = Date.now()
      if (text === lastRef.current.text && now - lastRef.current.at < 2500) return
      lastRef.current = { text, at: now }
      onResult(text)
    }

    let lastErr: unknown

    // One start() call per FRESH instance. Returns true on success.
    const tryStart = async (target: MediaTrackConstraints | string): Promise<boolean> => {
      await disposeScanner(scannerRef.current)
      if (cancelledRef.current) return false
      let scanner: Html5Qrcode
      try {
        scanner = new Html5Qrcode(REGION_ID, { verbose: false })
      } catch (e) {
        lastErr = e
        return false
      }
      scannerRef.current = scanner
      try {
        await scanner.start(target, SCAN_CONFIG, onDecode, () => {})
        if (!cancelledRef.current) {
          cameraUnlocked = true // permission granted: later remounts can auto-start
          setStatus('running')
          // Best-effort continuous autofocus — never allowed to break the running scanner.
          scanner
            .applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints)
            .catch(() => {})
        }
        return true
      } catch (e) {
        lastErr = e
        return false
      }
    }

    try {
      // Rear camera, high-res first, then a plain rear request. "ideal" constraints
      // degrade gracefully instead of failing.
      const targets: MediaTrackConstraints[] = [
        { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        { facingMode: { ideal: 'environment' } },
        {},
      ]
      for (const t of targets) {
        if (await tryStart(t)) return
        if (isPermissionError(lastErr)) break
      }

      // Last resort: enumerate devices and try each (rear-labelled first).
      if (!isPermissionError(lastErr)) {
        let cams: CameraDevice[] = []
        try {
          cams = await Html5Qrcode.getCameras()
        } catch (e) {
          lastErr = e
        }
        const ids = cams
          .slice()
          .sort(
            (a, b) =>
              Number(/back|rear|environment/i.test(b.label)) -
              Number(/back|rear|environment/i.test(a.label)),
          )
          .map((c) => c.id)
        for (const id of ids) {
          if (await tryStart(id)) return
          if (isPermissionError(lastErr)) break
        }
      }

      if (cancelledRef.current) return
      const name =
        lastErr instanceof Error ? lastErr.name || lastErr.message : String(lastErr ?? 'unknown')
      setStatus('error')
      setError(
        isPermissionError(lastErr)
          ? 'Camera access was blocked. Allow camera for this site in your browser settings, then tap Try again.'
          : `Could not start the camera (${name}). Tap Try again, or use manual entry below.`,
      )
    } finally {
      startingRef.current = false
    }
  }, [onResult])


  // Reopen automatically between scans. The very first start still needs a tap (browser
  // gesture requirement); after that `cameraUnlocked` is true and the loop is seamless.
  useEffect(() => {
    if (autoStart && cameraUnlocked && status === 'idle') void startCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, status])

  const retry = useCallback(() => {
    setError(null)
    setStatus('idle')
    void disposeScanner(scannerRef.current)
    scannerRef.current = null
  }, [])

  return (
    <div className="space-y-2">
      <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-lg border bg-black">
        <div id={REGION_ID} className="mx-auto w-full [&_video]:block [&_video]:w-full" />

        {status === 'idle' && (
          <button
            type="button"
            onClick={startCamera}
            className="tactile absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-white/90"
          >
            {/* A brand-red target ring rather than a bare icon: it reads as
                "aim here", and gives the tap a visible affordance on a dark panel. */}
            <span className="relative flex h-20 w-20 items-center justify-center">
              <span
                aria-hidden="true"
                className="animate-breathe absolute inset-0 rounded-full border-2 border-accent-brand/70"
              />
              <Camera className="h-9 w-9" />
            </span>
            <span className="text-base font-semibold">Tap to start camera</span>
          </button>
        )}

        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting camera…
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/85">
            <CameraOff className="h-6 w-6" />
            <span>{error}</span>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/30 px-3 py-1.5 text-white"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </div>
        )}
      </div>

      {status === 'running' && (
        <p className="text-center text-xs text-muted-foreground">
          Point the rear camera at a unit's QR code.
        </p>
      )}
      {status === 'idle' && (
        <p className="text-center text-xs text-muted-foreground">
          Tap the camera above to begin scanning.
        </p>
      )}
    </div>
  )
}
