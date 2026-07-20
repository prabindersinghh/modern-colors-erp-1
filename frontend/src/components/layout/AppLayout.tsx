import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'

// Page titles + subtitles for every screen across all three phases.
// Keep in sync with Sidebar nav + App routes.
const pageTitles: Record<string, { title: string; subtitle?: string }> = {
  // Role dashboards
  '/': { title: 'Dashboard', subtitle: "Today's invoices, materials received, pending scans/weighing" },
  '/oversight': { title: 'Factory oversight', subtitle: 'Every department, read-only' },
  '/store': { title: 'Store dashboard', subtitle: 'Requests to action, stock health and today’s movement' },
  '/my': { title: 'My department', subtitle: 'Your requests, batches and consumption' },
  // Phase 2 — requests & stock
  '/requests': { title: 'Requests', subtitle: 'Raise and track per-material production requests' },
  '/stock': { title: 'Scan & Issue', subtitle: 'Scan a unit to add, deduct or discard stock' },
  '/stock-levels': { title: 'Stock Levels', subtitle: 'Live balances, ageing and the movement ledger' },
  // Phase 3 — finished goods
  '/batches': { title: 'Batches', subtitle: 'Thread raw materials through to finished goods' },
  '/production-output': { title: 'Production Output', subtitle: 'Record what a batch produced, then confirm it' },
  '/dispatch': { title: 'Dispatch', subtitle: 'Scan finished goods out of the factory' },
  // Phase 1 — inward
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
      {/* min-w-0 + overflow-x-clip: a wide child (a data table, a tab strip) scrolls
          inside its own container instead of stretching the page and creating a
          horizontal scrollbar on phones. Desktop layout is unchanged. */}
      <div className="min-w-0 lg:pl-60">
        <Navbar
          title={pageInfo.title}
          subtitle={pageInfo.subtitle}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        {/* `key` on the route path remounts this wrapper on every navigation, so
            the entrance animation replays per route rather than only on first
            load. Transform+opacity only — no layout work during the transition. */}
        <main className="min-w-0 max-w-full overflow-x-clip p-4 lg:p-6">
          <div key={location.pathname} className="animate-route-in">
            <Outlet />
          </div>
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
