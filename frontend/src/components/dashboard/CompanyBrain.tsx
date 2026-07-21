import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sankey, Tooltip, ResponsiveContainer, Layer, Rectangle } from 'recharts'
import { ArrowRight, Boxes, FlaskConical, PackageCheck, Truck, TrendingDown } from 'lucide-react'
import { api } from '@/lib/api'
import type { Department, FactoryFlow, UnitTotal } from '@/types/api'
import { formatUnitTotals } from '@/lib/units'
import { useAutoRefresh } from '@/lib/refresh'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'

/** Preset ranges. Custom is handled by the two date inputs. */
type Preset = 'today' | 'week' | 'month' | 'custom'

const iso = (d: Date) => d.toISOString().slice(0, 10)
function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  if (p === 'week') from.setDate(to.getDate() - 6)
  if (p === 'month') from.setDate(to.getDate() - 29)
  return { from: iso(from), to: iso(to) }
}

/**
 * Node colours. Each stage of the chain has its own hue so the eye can follow the
 * material left-to-right without reading a single label.
 */
const STAGE_COLOR: Record<string, string> = {
  received: 'hsl(var(--chart-add))',
  PU: 'hsl(var(--chart-1))',
  ENAMEL: 'hsl(var(--chart-3))',
  POWDER: 'hsl(var(--chart-5))',
  produced: 'hsl(var(--brand-amber))',
  dispatched: 'hsl(var(--healthy))',
  awaiting: 'hsl(var(--info))',
  discarded: 'hsl(var(--critical))',
  inprocess: 'hsl(var(--chip-400))',
}

interface FlowNode {
  name: string
  key: string
  /** The real measured figure for this node, with its own unit. */
  label: string
  color: string
}

/**
 * Builds the Sankey graph from the API response.
 *
 * IMPORTANT — units change mid-chain. Raw material is measured in KILOGRAMS; finished
 * paint comes out in LITRES (or kg, depending on the product). Those cannot be summed,
 * and a single value scale across the whole diagram would make one side invisible
 * (2,000 L next to 11 kg).
 *
 * So link WIDTH is normalised within each half of the chain, while every link and node
 * carries its TRUE measured number as a label. The UI states this explicitly rather than
 * letting the reader assume one continuous scale — the numbers are the truth, the
 * ribbons are the shape.
 */
function buildGraph(flow: FactoryFlow) {
  const s = flow.stages
  const nodes: FlowNode[] = []
  const links: { source: number; target: number; value: number; real: string; color?: string }[] = []
  const idx = (key: string) => nodes.findIndex((n) => n.key === key)

  const add = (key: string, name: string, label: string, color: string) => {
    nodes.push({ key, name, label, color })
    return nodes.length - 1
  }

  const kgFmt = (n: number) => `${n.toLocaleString('en-IN')} kg`
  /**
   * Ribbon WIDTH needs one number per flow. Raw material may be part kg and part litres,
   * which cannot be added — so the magnitude below is used purely to size the ribbon and
   * is NEVER displayed. Every label the reader sees is the per-unit breakdown.
   */
  const magnitude = (t: UnitTotal[]) => t.reduce((sum, x) => sum + x.total, 0)

  // ---- left half: raw material, measured in kg and/or litres ---------------
  const received = add('received', 'Raw received', formatUnitTotals(s.received.totals), STAGE_COLOR.received)

  const depts = s.issued.byDepartment.filter((d) => magnitude(d.totals) > 0)
  // Scale so the thinnest visible ribbon is still readable.
  const rawMax = Math.max(1, magnitude(s.received.totals))

  for (const d of depts) {
    const lbl = formatUnitTotals(d.totals)
    const n = add(d.department, d.department, lbl, STAGE_COLOR[d.department])
    links.push({ source: received, target: n, value: Math.max(0.5, (magnitude(d.totals) / rawMax) * 100), real: lbl, color: STAGE_COLOR[d.department] })
  }

  if (magnitude(s.discarded.totals) > 0) {
    const lbl = formatUnitTotals(s.discarded.totals)
    const n = add('discarded', 'Discarded', lbl, STAGE_COLOR.discarded)
    links.push({ source: received, target: n, value: Math.max(0.5, (magnitude(s.discarded.totals) / rawMax) * 100), real: lbl, color: STAGE_COLOR.discarded })
  }

  // Received but NOT yet issued or discarded — it is still sitting in the store.
  // Without this the left side does not balance and the diagram silently implies
  // everything that came in went out, which is the opposite of the truth.
  // Balanced PER UNIT: litres in must never be netted off against kilograms out.
  const stillByUnit = s.received.totals
    .map((r) => {
      const out =
        (s.issued.totals.find((t) => t.unit === r.unit)?.total ?? 0) +
        (s.discarded.totals.find((t) => t.unit === r.unit)?.total ?? 0)
      return { unit: r.unit, total: Number((r.total - out).toFixed(3)) }
    })
    .filter((t) => t.total > 0)

  if (stillByUnit.length > 0) {
    const lbl = formatUnitTotals(stillByUnit)
    const n = add('instock', 'Still in store', lbl, STAGE_COLOR.inprocess)
    links.push({
      source: received,
      target: n,
      value: Math.max(0.5, (magnitude(stillByUnit) / rawMax) * 100),
      real: `${lbl} not yet issued`,
      color: STAGE_COLOR.inprocess,
    })
  }

  // ---- right half: finished goods, measured in litres / packages -----------
  const producedLabel =
    s.produced.litres > 0 && s.produced.kg > 0
      ? `${s.produced.litres.toLocaleString('en-IN')} L + ${kgFmt(s.produced.kg)}`
      : s.produced.litres > 0
        ? `${s.produced.litres.toLocaleString('en-IN')} L`
        : kgFmt(s.produced.kg)

  const producedTotal = s.produced.packages || 1
  const produced = add('produced', 'Produced', `${producedLabel} · ${s.produced.packages} pkgs`, STAGE_COLOR.produced)

  // Each department that actually produced feeds the produced node.
  for (const d of s.produced.byDepartment.filter((x) => x.packages > 0)) {
    const from = idx(d.department)
    if (from === -1) continue
    const lbl = d.litres > 0 ? `${d.litres.toLocaleString('en-IN')} L` : kgFmt(d.kg)
    links.push({
      source: from,
      target: produced,
      value: Math.max(0.5, (d.packages / producedTotal) * 100),
      real: `${lbl} · ${d.packages} pkgs`,
      color: STAGE_COLOR[d.department],
    })
  }

  if (s.dispatched.units > 0) {
    const n = add('dispatched', 'Dispatched', `${s.dispatched.units} units`, STAGE_COLOR.dispatched)
    links.push({
      source: produced,
      target: n,
      value: Math.max(0.5, (s.dispatched.units / producedTotal) * 100),
      real: `${s.dispatched.units} units`,
      color: STAGE_COLOR.dispatched,
    })
  }
  if (flow.derived.awaitingDispatchUnits > 0) {
    const n = add('awaiting', 'Awaiting dispatch', `${flow.derived.awaitingDispatchUnits} units`, STAGE_COLOR.awaiting)
    links.push({
      source: produced,
      target: n,
      value: Math.max(0.5, (flow.derived.awaitingDispatchUnits / producedTotal) * 100),
      real: `${flow.derived.awaitingDispatchUnits} units`,
      color: STAGE_COLOR.awaiting,
    })
  }

  return { nodes, links }
}

/**
 * Custom ribbon. Tinted by the stage it flows FROM, so material can be followed
 * left-to-right by colour without reading a label. Kept translucent so overlapping
 * ribbons stay legible where they cross.
 */
function FlowLinkShape(props: {
  sourceX: number; targetX: number; sourceY: number; targetY: number
  sourceControlX: number; targetControlX: number; linkWidth: number
  payload: { color?: string }
}) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props
  const [hover, setHover] = useState(false)
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      stroke={payload?.color ?? 'hsl(var(--chip-400))'}
      strokeWidth={Math.max(1, linkWidth)}
      strokeOpacity={hover ? 0.55 : 0.3}
      fill="none"
      style={{ transition: 'stroke-opacity 150ms' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  )
}

/** Custom node: a coloured bar with the stage name and its real figure. */
function FlowNodeShape(props: {
  x: number; y: number; width: number; height: number; index: number;
  payload: FlowNode; containerWidth: number;
  onPick?: (n: FlowNode) => void
}) {
  const { x, y, width, height, payload, containerWidth, onPick } = props
  const isRight = x + width + 160 > containerWidth
  return (
    <Layer>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={Math.max(2, height)}
        fill={payload.color}
        radius={[3, 3, 3, 3]}
        style={{ cursor: onPick ? 'pointer' : 'default' }}
        onClick={() => onPick?.(payload)}
      />
      <text
        x={isRight ? x - 8 : x + width + 8}
        y={y + height / 2 - 4}
        textAnchor={isRight ? 'end' : 'start'}
        className="fill-chip-900"
        style={{ fontSize: 12, fontWeight: 600 }}
      >
        {payload.name}
      </text>
      <text
        x={isRight ? x - 8 : x + width + 8}
        y={y + height / 2 + 11}
        textAnchor={isRight ? 'end' : 'start'}
        className="fill-chip-500"
        style={{ fontSize: 11 }}
      >
        {payload.label}
      </text>
    </Layer>
  )
}

export function CompanyBrain() {
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => presetRange('month'))
  const [flow, setFlow] = useState<FactoryFlow | null>(null)
  const [error, setError] = useState(false)
  const [picked, setPicked] = useState<FlowNode | null>(null)

  const load = useCallback(
    () =>
      api
        .get<FactoryFlow>(`/analytics/flow?from=${range.from}&to=${range.to}`)
        .then(setFlow)
        .catch(() => setError(true)),
    [range.from, range.to],
  )
  useEffect(() => {
    setFlow(null) // skeleton only when the range actually changes
    setError(false)
    void load()
  }, [load])
  useAutoRefresh(load)

  const graph = useMemo(() => (flow ? buildGraph(flow) : null), [flow])

  const choose = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p))
  }

  if (error) {
    return <EmptyState title="Could not load the factory flow" description="Please refresh to try again." />
  }

  const s = flow?.stages

  return (
    <div className="space-y-4">
      {/* ── Range picker ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-chip-100 p-0.5">
          {(['today', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => choose(p)}
              className={cn(
                'tactile rounded-md px-3 py-1.5 text-xs font-semibold [@media(pointer:coarse)]:min-h-11',
                preset === p ? 'bg-card text-chip-900 shadow-elev-1' : 'text-chip-500 hover:text-chip-700',
              )}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-chip-500">
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })) }}
            className="h-9 rounded-md border bg-card px-2 text-xs [@media(pointer:coarse)]:h-11"
          />
          <span>to</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })) }}
            className="h-9 rounded-md border bg-card px-2 text-xs [@media(pointer:coarse)]:h-11"
          />
        </div>
      </div>

      {/* ── Stage totals ─────────────────────────────────────────────── */}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StageStat label="Raw received" totals={s?.received.totals} icon={Boxes} tone="healthy" loading={!flow} />
        <StageStat label="Issued to production" totals={s?.issued.totals} icon={ArrowRight} tone="info" loading={!flow} />
        <StageStat label="Batches opened" value={s?.batches.opened} unit="" icon={FlaskConical} tone="violet" loading={!flow} />
        <StageStat
          label="Produced"
          value={s ? (s.produced.litres || s.produced.kg) : undefined}
          unit={s && s.produced.litres > 0 ? 'L' : 'kg'}
          sub={s ? `${s.produced.packages} packages` : undefined}
          icon={PackageCheck}
          tone="amber"
          loading={!flow}
        />
        <StageStat label="Dispatched" value={s?.dispatched.units} unit="units" icon={Truck} tone="healthy" loading={!flow} />
      </div>

      {/* ── The flow ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-title-3">
            Factory flow
            <span className="text-xs font-normal text-chip-500">
              raw material in → issued → produced → out
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!flow ? (
            <Skeleton className="h-[340px] w-full rounded-lg" />
          ) : graph && graph.links.length > 0 ? (
            <>
              <div className="min-w-[560px]">
                <ResponsiveContainer width="100%" height={360}>
                  <Sankey
                    data={graph}
                    nodePadding={26}
                    nodeWidth={12}
                    linkCurvature={0.5}
                    iterations={64}
                    margin={{ top: 10, right: 150, bottom: 10, left: 8 }}
                    node={(p: Record<string, unknown>) => (
                      <FlowNodeShape {...(p as unknown as Parameters<typeof FlowNodeShape>[0])} onPick={setPicked} />
                    )}
                    link={(p: Record<string, unknown>) => (
                      <FlowLinkShape {...(p as unknown as Parameters<typeof FlowLinkShape>[0])} />
                    )}
                  >
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                        fontSize: 12,
                        boxShadow: 'var(--elev-3)',
                      }}
                      formatter={(_v: number, _n: string, item: { payload?: { real?: string } }) =>
                        item?.payload?.real ?? ''
                      }
                    />
                  </Sankey>
                </ResponsiveContainer>
              </div>
              {/* Honesty note: the reader must not assume one continuous scale. */}
              <p className="mt-1 text-center text-[11px] leading-snug text-chip-400">
                Ribbon width is proportional within each half of the chain and is a shape
                only. Units change along the chain — raw material is measured in{' '}
                <strong>kg or litres</strong>, finished paint in <strong>litres/packages</strong>{' '}
                — so the halves are not on one scale. Every figure shown is a real measured
                value, broken out per unit; kilograms and litres are never added together.
              </p>
            </>
          ) : (
            <EmptyState
              title="No activity in this period"
              description="Nothing was received, issued, produced or dispatched in the selected range."
            />
          )}
        </CardContent>
      </Card>

      {/* ── Drill-down ───────────────────────────────────────────────── */}
      {picked && flow && <DrillDown node={picked} flow={flow} onClose={() => setPicked(null)} />}

      {/* ── Supporting stats ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-title-3">By department</CardTitle>
          </CardHeader>
          <CardContent>
            {!flow ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-label uppercase text-chip-500">
                      <th className="pb-2">Dept</th>
                      <th className="pb-2 text-right">Issued</th>
                      <th className="pb-2 text-right">Batches</th>
                      <th className="pb-2 text-right">Produced</th>
                      <th className="pb-2 text-right">Dispatched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.stages.issued.byDepartment.map((d) => {
                      const prod = flow.stages.produced.byDepartment.find((p) => p.department === d.department)
                      const disp = flow.stages.dispatched.byDepartment.find((p) => p.department === d.department)
                      return (
                        <tr key={d.department} className="border-b last:border-0">
                          <td className="py-2 font-medium">
                            <span
                              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                              style={{ background: STAGE_COLOR[d.department] }}
                            />
                            {d.department}
                          </td>
                          <td className="py-2 text-right tabular">{formatUnitTotals(d.totals)}</td>
                          <td className="py-2 text-right tabular">{prod?.batches ?? 0}</td>
                          <td className="py-2 text-right tabular">
                            {prod ? (prod.litres > 0 ? `${prod.litres} L` : `${prod.kg} kg`) : '—'}
                          </td>
                          <td className="py-2 text-right tabular">{disp?.units ?? 0}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-title-3">Conversion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!flow ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <Metric
                  label="Yield (finished kg ÷ raw kg issued)"
                  value={flow.derived.yieldPct === null ? null : `${flow.derived.yieldPct}%`}
                  hint={
                    flow.derived.yieldPct === null
                      ? 'Not comparable in this period — output was measured in litres, input in kilograms.'
                      : undefined
                  }
                />
                <Metric label="Still in process" value={`${flow.derived.inProcessKg} kg`} hint="Issued to production but not yet finished goods." />
                <Metric label="Awaiting dispatch" value={`${flow.derived.awaitingDispatchUnits} units`} hint="Produced and waiting to leave the factory." />
                <Metric
                  label="Discarded"
                  value={formatUnitTotals(flow.stages.discarded.totals)}
                  hint="Waste and damage recorded against raw stock."
                  tone={flow.stages.discarded.totals.length > 0 ? 'critical' : undefined}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StageStat({
  label, value, unit, totals, sub, icon: Icon, tone, loading,
}: {
  label: string
  /** Either a plain number + unit, OR a per-unit breakdown that must not be blended. */
  value?: number
  unit?: string
  totals?: UnitTotal[]
  sub?: string
  icon: typeof Boxes; tone: 'healthy' | 'info' | 'violet' | 'amber'; loading: boolean
}) {
  const TONE: Record<string, string> = {
    healthy: 'text-healthy [--chip-edge-color:hsl(var(--healthy))]',
    info: 'text-info [--chip-edge-color:hsl(var(--info))]',
    violet: 'text-brand-violet [--chip-edge-color:hsl(var(--brand-violet))]',
    amber: 'text-brand-amber [--chip-edge-color:hsl(var(--brand-amber))]',
  }
  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-4 shadow-elev-1">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-3 h-7 w-24" />
      </div>
    )
  }
  return (
    <div className={cn('chip-edge tactile-lift rounded-lg border bg-card p-4 pl-5 shadow-elev-1', TONE[tone])}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-label uppercase text-chip-500">{label}</span>
        <Icon className="h-4 w-4 shrink-0 opacity-40" aria-hidden="true" />
      </div>
      {/* A mixed-unit figure is shown broken out ("1,200 kg · 340 L"), never summed. */}
      <div className="mt-1.5 flex items-baseline gap-1">
        {totals && totals.length > 1 ? (
          <span className="text-lg font-bold text-chip-900">{formatUnitTotals(totals)}</span>
        ) : (
          <>
            <AnimatedNumber
              value={totals ? (totals[0]?.total ?? 0) : (value ?? 0)}
              className="text-metric text-chip-900"
            />
            {(totals ? (totals[0]?.unit ?? 'kg') : unit) && (
              <span className="text-sm font-medium text-chip-500">
                {totals ? (totals[0]?.unit ?? 'kg') : unit}
              </span>
            )}
          </>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-chip-500">{sub}</div>}
    </div>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string | null; hint?: string; tone?: 'critical' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2.5 last:border-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-chip-800">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-chip-500">{hint}</div>}
      </div>
      <div className={cn('shrink-0 text-title-3 tabular', tone === 'critical' ? 'text-critical' : 'text-chip-900')}>
        {value ?? <span className="text-sm font-normal text-chip-400">n/a</span>}
      </div>
    </div>
  )
}

/** What sits behind a clicked stage — the "show me the numbers" panel. */
function DrillDown({ node, flow, onClose }: { node: FlowNode; flow: FactoryFlow; onClose: () => void }) {
  const s = flow.stages
  const rows: { label: string; value: string }[] = []

  if (node.key === 'received') {
    rows.push({ label: 'Total received', value: formatUnitTotals(s.received.totals) })
    rows.push({ label: 'Stock movements', value: `${s.received.movements}` })
  } else if (['PU', 'ENAMEL', 'POWDER'].includes(node.key)) {
    const d = node.key as Department
    const iss = s.issued.byDepartment.find((x) => x.department === d)
    const prod = s.produced.byDepartment.find((x) => x.department === d)
    const disp = s.dispatched.byDepartment.find((x) => x.department === d)
    rows.push({ label: 'Issued to this department', value: formatUnitTotals(iss?.totals) })
    rows.push({ label: 'Issue movements', value: `${iss?.movements ?? 0}` })
    rows.push({ label: 'Batches opened', value: `${prod?.batches ?? 0}` })
    rows.push({ label: 'Produced', value: prod ? (prod.litres > 0 ? `${prod.litres} L` : `${prod.kg} kg`) : '—' })
    rows.push({ label: 'Packages made', value: `${prod?.packages ?? 0}` })
    rows.push({ label: 'Units dispatched', value: `${disp?.units ?? 0}` })
  } else if (node.key === 'produced') {
    rows.push({ label: 'Packages produced', value: `${s.produced.packages}` })
    if (s.produced.litres > 0) rows.push({ label: 'Volume', value: `${s.produced.litres} L` })
    if (s.produced.kg > 0) rows.push({ label: 'Weight', value: `${s.produced.kg} kg` })
    rows.push({ label: 'FG units created', value: `${s.produced.fgUnitsCreated}` })
  } else if (node.key === 'dispatched') {
    rows.push({ label: 'Units dispatched', value: `${s.dispatched.units}` })
    if (s.dispatched.litres > 0) rows.push({ label: 'Volume', value: `${s.dispatched.litres} L` })
  } else if (node.key === 'awaiting') {
    rows.push({ label: 'Units awaiting dispatch', value: `${flow.derived.awaitingDispatchUnits}` })
  } else if (node.key === 'discarded') {
    rows.push({ label: 'Discarded', value: formatUnitTotals(s.discarded.totals) })
  }

  return (
    <Card edge="primary" className="animate-fade-up">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-title-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.color }} />
          {node.name}
        </CardTitle>
        <button type="button" onClick={onClose} className="tactile text-xs font-medium text-chip-500 hover:text-chip-900">
          Close
        </button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between border-b pb-1.5 text-sm last:border-0">
              <span className="text-chip-600">{r.label}</span>
              <span className="font-semibold tabular text-chip-900">{r.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export { TrendingDown }
