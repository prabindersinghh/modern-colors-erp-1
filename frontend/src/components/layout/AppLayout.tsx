import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog'
import { ROUTE_TITLES, toPattern } from '@/lib/nav'
import { useNavigation } from '@/lib/navigation'

export function AppLayout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Titles live with the route map in nav.ts so the heading and the Back label can
  // never disagree about what a screen is called.
  const pageInfo = ROUTE_TITLES[toPattern(location.pathname)] ?? { title: 'Modern Colours' }
  const { pendingMessage, confirmPending, cancelPending } = useNavigation()

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

      {/* Leaving a screen that still holds unsaved work asks first — the navigation
          is held until answered, and nothing is written either way. */}
      <ConfirmationDialog
        open={!!pendingMessage}
        onOpenChange={(open) => !open && cancelPending()}
        title="Leave without saving?"
        description={pendingMessage ?? ''}
        confirmLabel="Discard and leave"
        variant="destructive"
        onConfirm={confirmPending}
      />

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
