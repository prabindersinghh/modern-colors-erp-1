import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The UPI-style scanning loop, shared by every scanning screen.
 *
 *   camera → locks on → camera CLOSES → detail screen → confirm
 *   → ~2s success overlay → camera reopens, ready for the next unit
 *
 * Why a mode instead of a `paused` flag: the caller renders <CameraQrScanner> only in
 * `scanning` mode, so the component UNMOUNTS on a hit. Its cleanup calls stop()+clear(),
 * which genuinely releases the camera track — merely hiding it would leave the phone's
 * camera powered and drain the battery on the floor.
 *
 * A failed scan (unknown unit, wrong prefix, already dispatched) deliberately stays in
 * `scanning` so the operator can retry immediately without navigating.
 */
export type ScanMode = 'scanning' | 'detail' | 'success'

export interface ScanFlow {
  mode: ScanMode
  /** True only while the camera should be mounted and running. */
  isScanning: boolean
  /** Text of the success overlay (null unless mode === 'success'). */
  successText: string | null
  /** A scan/lookup succeeded → close the camera and show the detail screen. */
  openDetail: () => void
  /** Back / wrong unit → return to the camera. */
  backToScan: () => void
  /** Action confirmed → flash a confirmation, then reopen the camera automatically. */
  finish: (message: string) => void
  /** Guard so a burst of decodes can't fire the handler more than once. */
  lockScan: () => boolean
}

const SUCCESS_MS = 2000

export function useScanFlow(options: { successMs?: number } = {}): ScanFlow {
  const successMs = options.successMs ?? SUCCESS_MS
  const [mode, setMode] = useState<ScanMode>('scanning')
  const [successText, setSuccessText] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const busyRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])

  const openDetail = useCallback(() => {
    clearTimer()
    setSuccessText(null)
    setMode('detail')
    busyRef.current = false
  }, [])

  const backToScan = useCallback(() => {
    clearTimer()
    setSuccessText(null)
    setMode('scanning')
    busyRef.current = false
  }, [])

  const finish = useCallback(
    (message: string) => {
      clearTimer()
      setSuccessText(message)
      setMode('success')
      busyRef.current = false
      // Brief confirmation, then straight back to the camera for the next unit.
      timerRef.current = window.setTimeout(() => {
        setSuccessText(null)
        setMode('scanning')
        timerRef.current = null
      }, successMs)
    },
    [successMs],
  )

  /**
   * Returns true if this caller won the lock (should proceed). The scanner can emit the
   * same code several times in a frame; only the first should trigger a lookup.
   */
  const lockScan = useCallback(() => {
    if (busyRef.current) return false
    busyRef.current = true
    return true
  }, [])

  return {
    mode,
    isScanning: mode === 'scanning',
    successText,
    openDetail,
    backToScan,
    finish,
    lockScan,
  }
}
