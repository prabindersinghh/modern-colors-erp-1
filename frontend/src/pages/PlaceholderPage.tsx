import { Construction } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  description?: string
}

// Temporary stand-in for Phase 1 pages whose UI is built in a later slice
// (see docs/PROGRESS.md). Keeps routes valid while the backend modules land.
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Construction className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {description ?? 'This Phase 1 screen is under construction.'}
      </p>
    </div>
  )
}
