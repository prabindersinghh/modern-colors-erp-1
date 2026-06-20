import { useState } from 'react'
import { useInventory } from '@/hooks/useInventory'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { InventoryDetailPanel } from '@/components/inventory/InventoryDetailPanel'
import { SearchBar } from '@/components/common/SearchBar'
import { FilterPanel } from '@/components/common/FilterPanel'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BagStatus, InventoryBag } from '@/types'

const statusOptions: { label: string; value: BagStatus | 'all' }[] = [
  { label: 'All Statuses', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Issued', value: 'issued' },
  { label: 'Consumed', value: 'consumed' },
  { label: 'Reserved', value: 'reserved' },
]

export function InventoryPage() {
  const {
    bags,
    loading,
    error,
    refetch,
    filters,
    updateFilters,
    setPage,
    setSearch,
    setSort,
    page,
    totalPages,
  } = useInventory()

  const [selectedBag, setSelectedBag] = useState<InventoryBag | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')

  const handleView = (bag: InventoryBag) => {
    setSelectedBag(bag)
    setPanelOpen(true)
  }

  const handleSearch = (value: string) => {
    setSearchValue(value)
    setSearch(value)
  }

  const clearFilters = () => {
    setSearchValue('')
    updateFilters({
      material: '',
      supplier: '',
      status: '',
      warehouse: '',
      rack: '',
      search: '',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar
          value={searchValue}
          onChange={handleSearch}
          placeholder="Search QR, material, SKU, batch..."
          className="sm:max-w-sm"
        />
      </div>

      <FilterPanel
        onClear={clearFilters}
        fields={[
          {
            id: 'material',
            label: 'Material',
            element: (
              <Select
                value={filters.material ?? 'all'}
                onValueChange={(v) => updateFilters({ material: v === 'all' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All materials" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All materials</SelectItem>
                  <SelectItem value="mat-1">Titanium Dioxide</SelectItem>
                  <SelectItem value="mat-2">Calcium Carbonate</SelectItem>
                  <SelectItem value="mat-3">Acrylic Resin</SelectItem>
                </SelectContent>
              </Select>
            ),
          },
          {
            id: 'supplier',
            label: 'Supplier',
            element: (
              <Select
                value={filters.supplier ?? 'all'}
                onValueChange={(v) => updateFilters({ supplier: v === 'all' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  <SelectItem value="sup-1">ChemCorp Industries</SelectItem>
                  <SelectItem value="sup-2">Titan Pigments Ltd</SelectItem>
                </SelectContent>
              </Select>
            ),
          },
          {
            id: 'status',
            label: 'Status',
            element: (
              <Select
                value={filters.status ?? 'all'}
                onValueChange={(v) =>
                  updateFilters({ status: v === 'all' ? '' : (v as BagStatus) })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ),
          },
          {
            id: 'warehouse',
            label: 'Warehouse',
            element: (
              <Select
                value={filters.warehouse ?? 'all'}
                onValueChange={(v) => updateFilters({ warehouse: v === 'all' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All warehouses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All warehouses</SelectItem>
                  <SelectItem value="wh-1">Raw Material Store</SelectItem>
                  <SelectItem value="wh-2">Pigment Store</SelectItem>
                </SelectContent>
              </Select>
            ),
          },
          {
            id: 'rack',
            label: 'Rack',
            element: (
              <Select
                value={filters.rack ?? 'all'}
                onValueChange={(v) => updateFilters({ rack: v === 'all' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All racks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All racks</SelectItem>
                  {['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ),
          },
        ]}
      />

      {loading && <LoadingSkeleton variant="table" count={8} />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && bags.length === 0 && (
        <EmptyState
          title="No inventory bags found"
          description="Try adjusting filters or receive new material."
        />
      )}
      {!loading && !error && bags.length > 0 && (
        <InventoryTable
          bags={bags}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onView={handleView}
          onSort={setSort}
          sortBy={filters.sortBy}
          sortDirection={filters.sortDirection}
        />
      )}

      <InventoryDetailPanel
        bag={selectedBag}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  )
}
