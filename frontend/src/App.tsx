import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Toaster } from '@/components/common/Toaster'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

// Phase 1 routes. Each placeholder is replaced with the real screen as that
// module's backend lands (see docs/PROGRESS.md). No Phase 2 routes are wired in.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<PlaceholderPage title="Dashboard" description="Live metrics for today's POs, materials received, pending scans/weighing, and ready-for-production counts." />} />
          <Route path="purchase-orders" element={<PlaceholderPage title="PO Upload" description="Upload a purchase order (PDF/image/scan) for AI extraction via Claude." />} />
          <Route path="review" element={<PlaceholderPage title="Review & Confirm" description="Review and correct AI-extracted materials. Nothing is saved until you confirm." />} />
          <Route path="labels" element={<PlaceholderPage title="QR Labels" description="Generate and print one QR label per physical unit." />} />
          <Route path="receiving" element={<PlaceholderPage title="Scan & Weigh" description="Scan each unit on arrival and enter its confirmed receiving weight." />} />
          <Route path="catalogue" element={<PlaceholderPage title="Master Catalogue" description="Manage the factory's raw-material SKU reference list." />} />
          <Route path="audit" element={<PlaceholderPage title="Audit Log" description="Immutable, append-only record of every status change, PO entry, and weight entry." />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" description="Admin-only: manage the Claude API key and system configuration." />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
