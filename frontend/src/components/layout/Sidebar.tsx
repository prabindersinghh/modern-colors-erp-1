import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  PackagePlus,
  Boxes,
  ScanLine,
  Factory,
  Warehouse,
  FileBarChart,
  Paintbrush,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/material-inward', label: 'Material Inward', icon: PackagePlus },
  { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/qr-scanner', label: 'QR Scanner', icon: ScanLine },
  { to: '/production', label: 'Production', icon: Factory },
  { to: '/warehouse', label: 'Warehouse', icon: Warehouse },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
]

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <Paintbrush className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none">Modern Colours</div>
          <div className="text-[10px] text-sidebar-foreground/60">Inventory ERP</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
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
          Plant: Chennai Unit
        </div>
        <div className="mt-0.5 text-xs text-sidebar-foreground/70">Shift A · Day</div>
      </div>
    </aside>
  )
}
