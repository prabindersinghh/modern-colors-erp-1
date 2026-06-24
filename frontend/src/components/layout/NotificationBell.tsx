import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import type { Notification } from '@/types'

const mockNotifications: Notification[] = [
  {
    id: '1',
    title: 'Low Stock Alert',
    message: 'Iron Oxide Red is below minimum stock level',
    type: 'warning',
    read: false,
    timestamp: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Material Received',
    message: '12 bags of Titanium Dioxide received at RMS',
    type: 'success',
    read: false,
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: '3',
    title: 'Production Started',
    message: 'Batch PB-2026-042 is now in progress',
    type: 'info',
    read: true,
    timestamp: new Date(Date.now() - 7200000).toISOString(),
  },
]

export function NotificationBell() {
  const unreadCount = mockNotifications.filter((n) => !n.read).length

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
          {mockNotifications.map((n) => (
            <div
              key={n.id}
              className="rounded-md px-2 py-2 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{n.title}</span>
                {!n.read && <Badge variant="default" className="h-5 px-1.5 text-[10px]">New</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(n.timestamp)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
