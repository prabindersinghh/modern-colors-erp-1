import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
                    // Touch devices get a 44px field (gloved hands); pointer devices keep
          // the compact 36px. Focus lifts the border to brand red and adds a soft
          // glow rather than only an outline.
          'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-elev-1',
          'transition-[border-color,box-shadow,background-color] duration-fast ease-out',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-chip-400',
          'hover:border-chip-400',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
          'disabled:cursor-not-allowed disabled:bg-chip-100 disabled:opacity-60',
          '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-base',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
