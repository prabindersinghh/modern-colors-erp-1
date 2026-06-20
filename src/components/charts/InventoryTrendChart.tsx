import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InventoryTrendPoint } from '@/types'
import { formatDate } from '@/lib/utils'

interface InventoryTrendChartProps {
  data: InventoryTrendPoint[]
}

export function InventoryTrendChart({ data }: InventoryTrendChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    label: formatDate(d.date),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="inward" name="Inward" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              <Bar dataKey="issued" name="Issued" fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
