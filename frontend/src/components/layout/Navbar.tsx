import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { NotificationBell } from './NotificationBell'
import { ProfileDropdown } from './ProfileDropdown'
import { LogoMark, TaglineStrip } from '@/components/brand/Logo'
import { NavControls } from './NavControls'
import { useNavigation } from '@/lib/navigation'

interface NavbarProps {
  title: string
  subtitle?: string
  onMenuClick?: () => void
}

export function Navbar({ title, subtitle, onMenuClick }: NavbarProps) {
  const { back, canGoForward } = useNavigation()
  // On a phone the width is spoken for. The brand mark is decorative and the sidebar
  // already carries the lockup, so navigation wins the space when both want it.
  const hideMark = !!back || canGoForward
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="flex h-14 items-center justify-between px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 lg:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          {/* The brand mark shows on mobile only — on desktop the sidebar
              already carries the lockup and a second one is just noise. */}
          <NavControls />
          <LogoMark className={cn('h-6 w-6 shrink-0 lg:hidden', hideMark && 'hidden')} />
          <div className="min-w-0">
            <h1 className="truncate text-title-3 leading-none text-chip-900">{title}</h1>
            {subtitle && (
              <p className="mt-1 hidden truncate text-xs text-chip-500 sm:block">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <NotificationBell />
          <ProfileDropdown />
        </div>
      </div>

      {/* The in-app tagline strip from the design doc. Desktop only: on a phone
          the vertical space is worth more than the flourish. */}
      <TaglineStrip className="hidden border-t border-chip-200/60 bg-chip-50/50 py-1.5 lg:block" />
    </header>
  )
}
