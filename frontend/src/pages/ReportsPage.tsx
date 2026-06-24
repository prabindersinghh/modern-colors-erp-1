import { FileSpreadsheet, FileText } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { useAsync } from '@/hooks/useAsync'
import {
  fetchInventoryReport,
  fetchProductionReport,
  fetchLowStockReport,
  fetchSupplierReport,
  exportToCsv,
  exportToPdfPlaceholder,
} from '@/services/reportService'
import { toast } from '@/hooks/useToast'
import { formatDate } from '@/lib/utils'

export function ReportsPage() {
  const inventory = useAsync(() => fetchInventoryReport())
  const production = useAsync(() => fetchProductionReport())
  const lowStock = useAsync(() => fetchLowStockReport())
  const supplier = useAsync(() => fetchSupplierReport())

  const handleExportExcel = <T extends Record<string, unknown>>(
    name: string,
    data: T[]
  ) => {
    exportToCsv(name, data)
  
    toast({
      title: 'Export Complete',
      description: `${name}.csv downloaded.`,
    })
  }
  const handleExportPdf = (name: string) => {
    exportToPdfPlaceholder(name)
    toast({ title: 'PDF Export', description: 'Print dialog opened for PDF save.' })
  }

  return (
    <Tabs defaultValue="inventory" className="space-y-4">
      <TabsList>
        <TabsTrigger value="inventory">Inventory Report</TabsTrigger>
        <TabsTrigger value="production">Production Report</TabsTrigger>
        <TabsTrigger value="lowstock">Low Stock</TabsTrigger>
        <TabsTrigger value="supplier">Supplier Report</TabsTrigger>
      </TabsList>

      <TabsContent value="inventory">
        <ReportCard
          title="Inventory Report"
          loading={inventory.loading}
          data={inventory.data ?? []}
          onExportExcel={() =>
            handleExportExcel(
              'inventory-report',
              (inventory.data ?? []) as unknown as Record<string, unknown>[]
            )
          }
          onExportPdf={() => handleExportPdf('Inventory Report')}
          columns={['materialName', 'sku', 'totalBags', 'totalWeight', 'availableWeight', 'warehouse']}
          headers={['Material', 'SKU', 'Bags', 'Total Wt (kg)', 'Available (kg)', 'Warehouse']}
        />
      </TabsContent>

      <TabsContent value="production">
        <ReportCard
          title="Production Report"
          loading={production.loading}
          data={production.data ?? []}
          onExportExcel={() => handleExportExcel(
            'production-report',
            (production.data ?? []) as unknown as Record<string, unknown>[]
          )}
          onExportPdf={() => handleExportPdf('Production Report')}
          columns={['batchNumber', 'paintType', 'supervisor', 'targetQuantity', 'status', 'date']}
          headers={['Batch', 'Paint Type', 'Supervisor', 'Target (L)', 'Status', 'Date']}
          formatRow={(row, col) => {
            if (col === 'date') return formatDate(String(row[col]))
            return String(row[col] ?? '')
          }}
        />
      </TabsContent>

      <TabsContent value="lowstock">
        <ReportCard
          title="Low Stock Report"
          loading={lowStock.loading}
          data={lowStock.data ?? []}
          onExportExcel={() => handleExportExcel(
            'low-stock-report',
            (lowStock.data ?? []) as unknown as Record<string, unknown>[]
          )}
          onExportPdf={() => handleExportPdf('Low Stock Report')}
          columns={['materialName', 'sku', 'currentStock', 'minStock', 'deficit', 'unit']}
          headers={['Material', 'SKU', 'Current', 'Min Stock', 'Deficit', 'Unit']}
        />
      </TabsContent>

      <TabsContent value="supplier">
        <ReportCard
          title="Supplier Report"
          loading={supplier.loading}
          data={supplier.data ?? []}
          onExportExcel={() => handleExportExcel(
            'supplier-report',
            (supplier.data ?? []) as unknown as Record<string, unknown>[]
          )}
          onExportPdf={() => handleExportPdf('Supplier Report')}
          columns={['supplierName', 'totalDeliveries', 'totalWeight', 'materials']}
          headers={['Supplier', 'Deliveries', 'Total Wt (kg)', 'Materials']}
          formatRow={(row, col) => {
            if (col === 'materials') return (row[col] as string[]).join(', ')
            return String(row[col] ?? '')
          }}
        />
      </TabsContent>
    </Tabs>
  )
}

interface ReportCardProps<T> {
  title: string
  loading: boolean
  data: T[]
  columns: (keyof T & string)[]
  headers: string[]
  onExportExcel: () => void
  onExportPdf: () => void
  formatRow?: (row: T, col: keyof T & string) => string
}

function ReportCard<T>({
  title,
  loading,
  data,
  columns,
  headers,
  onExportExcel,
  onExportPdf,
  formatRow = (row, col) => String(row[col] ?? ''),
}: ReportCardProps<T>) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={onExportPdf}>
            <FileText className="h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={onExportExcel}>
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingSkeleton variant="table" count={5} />
        ) : data.length === 0 ? (
          <EmptyState title="No data" description="No records for this report." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col}>{formatRow(row, col)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
