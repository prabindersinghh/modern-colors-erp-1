import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Toaster } from '@/components/common/Toaster'
import { DashboardPage } from '@/pages/DashboardPage'
import { MaterialInwardPage } from '@/pages/MaterialInwardPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { QRScannerPage } from '@/pages/QRScannerPage'
import { ProductionPage } from '@/pages/ProductionPage'
import { WarehousePage } from '@/pages/WarehousePage'
import { ReportsPage } from '@/pages/ReportsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="material-inward" element={<MaterialInwardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="qr-scanner" element={<QRScannerPage />} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="warehouse" element={<WarehousePage />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
