const OPTIONS = [7, 30, 90]

/** 7d / 30d / 90d window selector for the analytics dashboards. */
export function WindowToggle({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border text-xs">
      {OPTIONS.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-2.5 py-1 transition-colors ${
            days === d ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  )
}
