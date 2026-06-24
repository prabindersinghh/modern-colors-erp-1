import { useState } from 'react'
import { ScanLine, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface QRScannerProps {
  onScan: (qrId: string) => void
  scanning?: boolean
  className?: string
}

export function QRScanner({ onScan, scanning, className }: QRScannerProps) {
  const [manualInput, setManualInput] = useState('')
  const [animating, setAnimating] = useState(false)

  const handleMockScan = () => {
    setAnimating(true)
    setTimeout(() => {
      setAnimating(false)
      onScan('RM-TIO2-20260615-0001')
    }, 1200)
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (manualInput.trim()) {
      onScan(manualInput.trim())
      setManualInput('')
    }
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="relative aspect-video overflow-hidden rounded-lg border-2 border-dashed border-primary/30 bg-muted/30">
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Camera className="mb-3 h-16 w-16 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Camera preview (mock scanner)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Position QR code within the frame
          </p>
        </div>

        <div className="absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-primary/60" />
        {animating && (
          <div className="absolute inset-x-8 top-1/2 h-8 -translate-y-1/2 animate-pulse bg-primary/10" />
        )}

        <div className="absolute inset-4 border-2 border-primary/40">
          <div className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-primary" />
          <div className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-primary" />
          <div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-primary" />
          <div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-primary" />
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          className="flex-1 gap-2"
          size="lg"
          onClick={handleMockScan}
          disabled={scanning || animating}
        >
          <ScanLine className="h-5 w-5" />
          {animating ? 'Scanning...' : 'Simulate Scan'}
        </Button>
      </div>

      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <Input
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="Enter QR ID manually (e.g. RM-TIO2-20260615-0001)"
          className="font-mono text-sm"
        />
        <Button type="submit" variant="outline" disabled={!manualInput.trim()}>
          Submit
        </Button>
      </form>
    </div>
  )
}
