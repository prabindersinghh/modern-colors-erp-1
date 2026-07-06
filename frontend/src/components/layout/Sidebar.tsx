import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FileUp,
  ClipboardCheck,
  QrCode,
  ScanLine,
  BookMarked,
  Settings as SettingsIcon,
  ScrollText,
  Paintbrush,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import type { Role } from '@/types/api'

// Phase 1 navigation. `roles` omitted = visible to every authenticated user.
const navItems: { to: string; label: string; icon: typeof LayoutDashboard; roles?: Role[] }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/purchase-orders', label: 'Invoice Upload', icon: FileUp },
  { to: '/review', label: 'Review & Confirm', icon: ClipboardCheck },
  { to: '/labels', label: 'QR Labels', icon: QrCode },
  { to: '/receiving', label: 'Scan & Weigh', icon: ScanLine },
  { to: '/catalogue', label: 'Master Catalogue', icon: BookMarked },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['ADMIN'] },
]

export function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth()
  const items = navItems.filter((i) => !i.roles || (user && i.roles.includes(user.role)))
  return (
    <aside
      className={cn(
        // Off-canvas drawer on mobile; always-visible rail on lg+ (desktop unchanged).
        'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'transition-transform duration-200 ease-in-out lg:translate-x-0 lg:z-40',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <Paintbrush className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none">Modern Colours</div>
          <div className="text-[10px] text-sidebar-foreground/60">Material Inward</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="text-[10px] uppercase tracking-wide text-sidebar-foreground/50">
          Phase 1
        </div>
        <div className="mt-0.5 text-xs text-sidebar-foreground/70">Material Inward Digitization</div>
      </div>
    </aside>
  )
}
