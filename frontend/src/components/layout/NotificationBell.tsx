import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import type { AppNotification } from '@/types'

// Notifications will be sourced from the backend in a later slice. Empty for now —
// no mock Phase 2 data wired into the active app.
const notifications: AppNotification[] = []

export function NotificationBell() {
  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="relative group">
      <Button variant="ghost" size="icon" className="relative">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {unreadCount}
          </span>
        )}
      </Button>
      <div className="invisible absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border bg-popover p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
        <div className="mb-2 px-2 text-xs font-semibold uppercase text-muted-foreground">
          Notifications
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="rounded-md px-2 py-2 hover:bg-muted/50">
                <span className="text-sm font-medium">{n.title}</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(n.timestamp)}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
