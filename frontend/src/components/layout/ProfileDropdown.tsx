import { LogOut, Settings, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ProfileDropdownProps {
  name?: string
  role?: string
  className?: string
}

export function ProfileDropdown({
  name = 'Modern Colours',
  role = 'Signed in',
  className,
}: ProfileDropdownProps) {
  return (
    <div className={cn('relative group', className)}>
      <Button variant="ghost" className="gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {name.split(' ').map((n) => n[0]).join('')}
        </div>
        <div className="hidden text-left md:block">
          <div className="text-sm font-medium leading-none">{name}</div>
          <div className="text-xs text-muted-foreground">{role}</div>
        </div>
      </Button>
      <div className="invisible absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border bg-popover py-1 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
          <User className="h-4 w-4" />
          Profile
        </button>
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
          <Settings className="h-4 w-4" />
          Settings
        </button>
        <hr className="my-1 border-border" />
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted">
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
