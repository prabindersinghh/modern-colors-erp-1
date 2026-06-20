import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { cn } from '@/lib/utils'

const pageTitles: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Overview of inventory and operations' },
  '/material-inward': { title: 'Material Inward', subtitle: 'Receive and label incoming materials' },
  '/inventory': { title: 'Inventory', subtitle: 'Bag-level stock management' },
  '/qr-scanner': { title: 'QR Scanner', subtitle: 'Scan and process material bags' },
  '/production': { title: 'Production', subtitle: 'Production order management' },
  '/warehouse': { title: 'Warehouse', subtitle: 'Visual rack layout and bag movement' },
  '/reports': { title: 'Reports', subtitle: 'Inventory and production analytics' },
}

export function AppLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pageInfo = pageTitles[location.pathname] ?? { title: 'Modern Colours ERP' }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className={cn(
          'lg:pl-60',
          sidebarOpen && 'lg:pl-60'
        )}
      >
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
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
