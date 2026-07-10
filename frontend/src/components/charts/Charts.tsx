import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART } from './chartTheme'

const AXIS = { stroke: CHART.axis, fontSize: 11, tickLine: false, axisLine: false } as const

function box(): React.CSSProperties {
  return {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    padding: '6px 10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  }
}

const KG = (v: number | string) => `${v} kg`
const shortDay = (d: string) => d.slice(5) // MM-DD

/** Stacked area trend of stock movements over time (add / deduct / discard). */
export function MovementTrend({
  data,
  keys = ['ADD', 'DEDUCT', 'DISCARD'],
  height = 220,
}: {
  data: { date: string; ADD: number; DEDUCT: number; DISCARD: number }[]
  keys?: ('ADD' | 'DEDUCT' | 'DISCARD')[]
  height?: number
}) {
  const color = { ADD: CHART.add, DEDUCT: CHART.deduct, DISCARD: CHART.discard }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {keys.map((k) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color[k]} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color[k]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS} minTickGap={24} />
        <YAxis {...AXIS} width={40} />
        <Tooltip contentStyle={box()} formatter={(v: number) => KG(v)} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            name={k[0] + k.slice(1).toLowerCase()}
            stroke={color[k]}
            strokeWidth={2}
            fill={`url(#g-${k})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Simple horizontal-friendly vertical bar chart with per-bar colors. */
export function CategoryBars({
  data,
  height = 200,
  colorFor,
}: {
  data: { label: string; value: number }[]
  height?: number
  colorFor?: (label: string, i: number) => string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis {...AXIS} width={40} />
        <Tooltip contentStyle={box()} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} formatter={(v: number) => KG(v)} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colorFor ? colorFor(d.label, i) : CHART.categorical[i % CHART.categorical.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Donut for a categorical breakdown (e.g. requests by status). */
export function Donut({
  data,
  height = 200,
  colorFor,
}: {
  data: { label: string; value: number }[]
  height?: number
  colorFor?: (label: string, i: number) => string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) {
    return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">No data yet</div>
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colorFor ? colorFor(d.label, i) : CHART.categorical[i % CHART.categorical.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={box()} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

/** Grouped requested-vs-issued bars per department (fulfilment). */
export function FulfilmentBars({
  data,
  height = 200,
}: {
  data: { label: string; requested: number; issued: number }[]
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
        <XAxis dataKey="label" {...AXIS} interval={0} />
        <YAxis {...AXIS} width={40} />
        <Tooltip contentStyle={box()} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} formatter={(v: number) => KG(v)} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="requested" name="Requested" fill={CHART.categorical[0]} radius={[4, 4, 0, 0]} />
        <Bar dataKey="issued" name="Issued" fill={CHART.add} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Thin wrapper to lazy-render charts only when they scroll into view isn't needed here;
 * charts are light. Exported for a consistent empty state. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{children}</div>
}
