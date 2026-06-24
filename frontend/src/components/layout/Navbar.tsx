import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotificationBell } from './NotificationBell'
import { ProfileDropdown } from './ProfileDropdown'

interface NavbarProps {
  title: string
  subtitle?: string
  onMenuClick?: () => void
}

export function Navbar({ title, subtitle, onMenuClick }: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-base font-semibold leading-none">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  )
}
