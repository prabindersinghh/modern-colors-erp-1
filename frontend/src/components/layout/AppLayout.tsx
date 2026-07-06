import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'

// Phase 1 page titles. Keep in sync with Sidebar nav + App routes.
const pageTitles: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Dashboard', subtitle: "Today's invoices, materials received, pending scans/weighing" },
  '/purchase-orders': { title: 'Invoice Upload', subtitle: 'Upload an invoice for AI extraction' },
  '/review': { title: 'Review & Confirm', subtitle: 'Verify and correct extracted materials before saving' },
  '/labels': { title: 'QR Labels', subtitle: 'Generate and print QR labels per physical unit' },
  '/receiving': { title: 'Scan & Weigh', subtitle: 'Scan units on arrival and confirm receiving weight' },
  '/catalogue': { title: 'Master Catalogue', subtitle: 'Factory raw-material SKU reference' },
  '/audit': { title: 'Audit Log', subtitle: 'Immutable record of every change' },
  '/settings': { title: 'Settings', subtitle: 'Claude API key and system configuration' },
}

export function AppLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pageInfo = pageTitles[location.pathname] ?? { title: 'Modern Colours' }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div className="lg:pl-60">
        <Navbar
          title={pageInfo.title}
          subtitle={pageInfo.subtitle}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
