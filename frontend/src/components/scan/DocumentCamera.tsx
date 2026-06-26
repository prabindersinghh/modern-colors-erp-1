import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DocumentCameraProps {
  onCapture: (file: File) => void
  onClose: () => void
}

/**
 * Live rear-camera document capture for PO/invoice photos.
 * Shows an in-page preview and captures a high-resolution still. Uses the
 * ImageCapture API (full sensor resolution) where available — important for
 * reliable AI extraction of dense document text — falling back to a canvas
 * frame grab (e.g. iOS Safari). Produces a JPEG File fed into the same upload
 * → extraction flow as the file picker.
 */
export function DocumentCamera({ onCapture, onClose }: DocumentCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setStatus('running')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(
          err instanceof Error && /permission|denied|NotAllowed/i.test(err.message)
            ? 'Camera permission denied. Allow access or use “Choose file”.'
            : 'No camera available. Use “Choose file” instead.',
        )
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const stop = () => streamRef.current?.getTracks().forEach((t) => t.stop())

  const capture = async () => {
    const stream = streamRef.current
    const video = videoRef.current
    if (!stream || !video) return
    setBusy(true)
    try {
      const track = stream.getVideoTracks()[0]
      let blob: Blob | null = null

      // Preferred: full-resolution still via ImageCapture (Android Chrome).
      const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture
      if (ImageCaptureCtor) {
        try {
          blob = await new ImageCaptureCtor(track).takePhoto()
        } catch {
          blob = null
        }
      }

      // Fallback: grab the current frame from the video element (iOS Safari).
      if (!blob) {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 1280
        canvas.height = video.videoHeight || 720
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
      }

      if (!blob) throw new Error('Capture failed')
      const file = new File([blob], `po-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      stop()
      onCapture(file)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="block max-h-[60vh] w-full object-contain"
        />
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
          Fit the whole document in frame, hold steady, then capture.
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            stop()
            onClose()
          }}
        >
          <X className="mr-1.5 h-4 w-4" /> Cancel
        </Button>
        <Button className="flex-1" onClick={capture} disabled={status !== 'running' || busy}>
          <Camera className="mr-1.5 h-4 w-4" /> {busy ? 'Capturing…' : 'Capture'}
        </Button>
      </div>
    </div>
  )
}
