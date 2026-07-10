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
  ClipboardList,
  PackageSearch,
  Boxes,
  Gauge,
  Paintbrush,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import type { Role } from '@/types/api'

// Phase 1 navigation. `roles` omitted = visible to every authenticated user.
// Phase 1 screens are scoped to the Phase 1 roles (Store=ADMIN, Operator, Supervisor).
// The new Phase 2 roles (OVERSIGHT / PRODUCTION_HEAD) get their own nav in later steps.
const PHASE1_ROLES: Role[] = ['ADMIN', 'OPERATOR', 'SUPERVISOR']

// Phase 1 screens that Operators / Supervisors use. Store (ADMIN) also reaches these,
// but lands on its own analytics dashboard first.
const PHASE1_OPS: Role[] = ['OPERATOR', 'SUPERVISOR']

const navItems: { to: string; label: string; icon: typeof LayoutDashboard; roles?: Role[]; end?: boolean }[] = [
  // Phase 2 — role-specific analytics dashboards (the landing screen per role).
  { to: '/oversight', label: 'Oversight', icon: Gauge, roles: ['OVERSIGHT'] },
  { to: '/store', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
  { to: '/my', label: 'My Department', icon: Gauge, roles: ['PRODUCTION_HEAD'] },
  // Phase 1 material-inward overview for ops roles (Store reaches it via its own screens).
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: PHASE1_OPS, end: true },
  // Phase 2 — production heads raise/track requests; the view-only Admin sees them all.
  { to: '/requests', label: 'Requests', icon: ClipboardList, roles: ['PRODUCTION_HEAD', 'OVERSIGHT', 'ADMIN'] },
  { to: '/stock', label: 'Scan & Issue', icon: PackageSearch, roles: ['ADMIN'] },
  { to: '/stock-levels', label: 'Stock Levels', icon: Boxes, roles: ['ADMIN', 'OVERSIGHT'] },
  { to: '/purchase-orders', label: 'Invoice Upload', icon: FileUp, roles: PHASE1_ROLES },
  { to: '/review', label: 'Review & Confirm', icon: ClipboardCheck, roles: PHASE1_ROLES },
  { to: '/labels', label: 'QR Labels', icon: QrCode, roles: PHASE1_ROLES },
  { to: '/receiving', label: 'Scan & Weigh', icon: ScanLine, roles: PHASE1_ROLES },
  { to: '/catalogue', label: 'Master Catalogue', icon: BookMarked, roles: PHASE1_ROLES },
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
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? to === '/'}
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
