import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // max-w-full + horizontal scroll so a wide tab set can never force the PAGE to
      // scroll on narrow phones. Desktop is unchanged: inline-flex never reaches the cap.
      'inline-flex h-10 max-w-full items-center justify-center overflow-x-auto rounded-lg bg-chip-100 p-1 text-chip-500 [@media(pointer:coarse)]:h-[3.25rem]',
      'scrollbar-thin [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // shrink-0 keeps each tab legible; the list scrolls instead of squashing them.
      'tactile inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:text-chip-700 data-[state=active]:bg-card data-[state=active]:text-chip-900 data-[state=active]:shadow-elev-1 [@media(pointer:coarse)]:min-h-11',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
