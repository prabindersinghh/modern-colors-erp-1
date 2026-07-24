import { NavLink } from 'react-router-dom'
import {
  Camera,
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
  Layers,
  FlaskConical,
  Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useStoreInwardAccess } from '@/lib/useSystemFlag'
import { LogoLockup } from '@/components/brand/Logo'
import type { Role } from '@/types/api'

// How each role is described under the wordmark. These are the CLIENT-FACING
// names, which deliberately differ from the enum: ADMIN is the store desk, and
// OVERSIGHT is what the factory owner calls "Admin".
const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Store',
  OVERSIGHT: 'Admin',
  OPERATOR: 'Gate',
  SUPERVISOR: 'Supervisor',
  PRODUCTION_HEAD: 'Production',
  DISPATCH: 'Dispatch',
  REVIEWER: 'Reviewer',
}

// Phase 1 navigation. `roles` omitted = visible to every authenticated user.
// Phase 1 screens are scoped to the Phase 1 roles (Store=ADMIN, Operator, Supervisor).
// The new Phase 2 roles (OVERSIGHT / PRODUCTION_HEAD) get their own nav in later steps.
const PHASE1_ROLES: Role[] = ['ADMIN', 'SUPERVISOR']

// Phase 1 screens that Operators / Supervisors use. Store (ADMIN) also reaches these,
// but lands on its own analytics dashboard first.
// Gate no longer belongs to the Phase-1 operations group: it has one screen of its own.
const PHASE1_OPS: Role[] = ['SUPERVISOR']

const navItems: { to: string; label: string; icon: typeof LayoutDashboard; roles?: Role[]; end?: boolean }[] = [
  // Phase 2 — role-specific analytics dashboards (the landing screen per role).
  { to: '/oversight', label: 'Oversight', icon: Gauge, roles: ['OVERSIGHT'] },
  { to: '/store', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
  { to: '/my', label: 'My Department', icon: Gauge, roles: ['PRODUCTION_HEAD'] },
  // Phase 3 — dispatch has ONE screen and nothing else.
  { to: '/dispatch', label: 'Dispatch', icon: Truck, roles: ['DISPATCH'] },
  // The Reviewer's only screen.
  // The Reviewer's screen, ALSO surfaced for Oversight (its "sees everything" inward
  // view): the real invoice document beside its slip, every status, historically — the
  // same renderer, reused, no new endpoint.
  { to: '/review-inwards', label: 'Inward', icon: ClipboardCheck, roles: ['REVIEWER', 'OVERSIGHT'] },
  // The Gate's only screen — scan-and-go, nothing downstream.
  { to: '/gate', label: 'Invoice Upload', icon: Camera, roles: ['OPERATOR'] },
  // Phase 1 material-inward overview for ops roles (Store reaches it via its own screens).
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: PHASE1_OPS, end: true },
  // Phase 2 — production heads raise/track requests; the view-only Admin sees them all.
  { to: '/requests', label: 'Requests', icon: ClipboardList, roles: ['PRODUCTION_HEAD', 'OVERSIGHT', 'ADMIN'] },
  { to: '/stock', label: 'Scan & Issue', icon: PackageSearch, roles: ['ADMIN'] },
  { to: '/stock-levels', label: 'Stock Levels', icon: Boxes, roles: ['ADMIN', 'OVERSIGHT'] },
  // Phase 3 — batches thread raw materials to finished goods.
  // Cross-department batch visibility is the factory Admin's (OVERSIGHT), not Store's.
  { to: '/batches', label: 'Batches', icon: Layers, roles: ['PRODUCTION_HEAD', 'OVERSIGHT'] },
  { to: '/production-output', label: 'Production Output', icon: FlaskConical, roles: ['PRODUCTION_HEAD'] },
  { to: '/purchase-orders', label: 'Invoice Upload', icon: FileUp, roles: PHASE1_ROLES },
  { to: '/review', label: 'Review & Confirm', icon: ClipboardCheck, roles: PHASE1_ROLES },
  { to: '/labels', label: 'QR Labels', icon: QrCode, roles: PHASE1_ROLES },
  { to: '/receiving', label: 'Receive Stock', icon: ScanLine, roles: PHASE1_ROLES },
  { to: '/catalogue', label: 'Master Catalogue', icon: BookMarked, roles: PHASE1_ROLES },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, roles: ['ADMIN', 'SUPERVISOR'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, roles: ['ADMIN'] },
]

export function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth()
  const inwardAccess = useStoreInwardAccess()
  const items = navItems.filter((i) => {
    if (i.roles && !(user && i.roles.includes(user.role))) return false
    // Flag-aware: when Store's inward access is switched off, Invoice Upload — the
    // upload entry point — disappears from Store's nav. It returns automatically if the
    // flag is ever flipped back. Review & Confirm, labels and receiving stay: Store
    // still works, from the slip. The server enforces the block regardless of this.
    if (i.to === '/purchase-orders' && user?.role === 'ADMIN' && inwardAccess === 'off') return false
    return true
  })
  // A production head's department is more useful here than the generic role.
  const roleLabel = user
    ? user.role === 'PRODUCTION_HEAD' && user.department
      ? `${user.department} Head`
      : ROLE_LABEL[user.role]
    : undefined
  return (
    <aside
      className={cn(
        // Off-canvas drawer on mobile; always-visible rail on lg+ (desktop unchanged).
        'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        'transition-transform duration-200 ease-in-out lg:translate-x-0 lg:z-40',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <LogoLockup tone="light" size="sm" subtitle={roleLabel} />
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
                // `group` + the ::before rail below give the active item a brand-red
                // paint-chip edge rather than a flat highlight.
                // 44px minimum on touch devices (gloved hands on the factory floor);
                // pointer devices keep the compact 40px rhythm.
                'group relative flex items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-sm font-medium',
                '[@media(pointer:coarse)]:min-h-11',
                'transition-colors duration-fast ease-out',
                'before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-r-full before:bg-accent-brand',
                'before:origin-left before:scale-x-0 before:transition-transform before:duration-base before:ease-spring',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground before:scale-x-100'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors duration-fast',
                    isActive ? 'text-accent-brand' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'
                  )}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="text-[10px] text-sidebar-foreground/45">
          Modern Colours Pvt. Ltd.
        </div>
        <div className="mt-0.5 text-[10px] text-sidebar-foreground/35">
          Material inward · Production · Dispatch
        </div>
      </div>
    </aside>
  )
}
