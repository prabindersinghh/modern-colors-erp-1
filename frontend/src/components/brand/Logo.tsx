import { cn } from '@/lib/utils'

/**
 * The Modern Colours mark — three overlapping paint petals.
 *
 * Rendered as inline SVG rather than an <img> so it inherits sizing, can be
 * animated per-petal, and costs no extra network request. Geometry matches
 * /public/brand/mark.svg; see that file for why the mark is drawn geometrically
 * instead of traced from the raster logo (the trace turns to mush below ~32px).
 */
export function LogoMark({
  className,
  animate = false,
}: {
  className?: string
  /** Petals stagger in on mount — used on login and loading states. */
  animate?: boolean
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Modern Colours"
    >
      <g fill="none" strokeWidth={11} strokeLinecap="round">
        <ellipse
          stroke="#8802C9"
          cx="50"
          cy="38"
          rx="13"
          ry="23"
          transform="rotate(-38 50 72)"
          className={animate ? 'animate-fade-in [animation-delay:0ms]' : undefined}
        />
        <ellipse
          stroke="#FEEF03"
          cx="50"
          cy="38"
          rx="13"
          ry="23"
          className={animate ? 'animate-fade-in [animation-delay:90ms]' : undefined}
        />
        <ellipse
          stroke="#EB0102"
          cx="50"
          cy="38"
          rx="13"
          ry="23"
          transform="rotate(38 50 72)"
          className={animate ? 'animate-fade-in [animation-delay:180ms]' : undefined}
        />
      </g>
    </svg>
  )
}

/**
 * Mark + wordmark lockup.
 *
 * `tone` picks the wordmark colour: on the ink sidebar the company name must be
 * light, on paper it is ink. The petals never change colour — they are the brand.
 */
export function LogoLockup({
  className,
  tone = 'ink',
  size = 'md',
  subtitle,
}: {
  className?: string
  tone?: 'ink' | 'light'
  size?: 'sm' | 'md' | 'lg'
  /** Small caps line under the name, e.g. the current role. */
  subtitle?: string
}) {
  const mark = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-11 w-11' }[size]
  const name = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' }[size]

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className={mark} />
      <div className="min-w-0 leading-none">
        <div
          className={cn(
            'truncate font-bold tracking-tight',
            name,
            tone === 'light' ? 'text-white' : 'text-chip-900'
          )}
        >
          Modern Colours
        </div>
        {subtitle && (
          <div
            className={cn(
              'mt-1 truncate text-label uppercase',
              tone === 'light' ? 'text-white/55' : 'text-chip-500'
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  )
}

/** The company tagline. Single source of truth — used by the strip, the login
 *  screen and the browser title. */
export const TAGLINE = 'Colours that lasts forever'

/**
 * The tagline strip — a slow, continuous scroll of the company tagline.
 *
 * Chosen in the design doc as the product's signature motion: it runs on the
 * login screen and along a slim bar in the app. One phrase, repeated — not a
 * rotation of several. A cycling strip reads as a marketing banner and pulls
 * attention from the work; a single line repeating becomes texture, which is
 * the intent.
 *
 * The repeated copies plus a translateX loop give a seamless marquee with no JS
 * and no layout thrash. Frozen entirely under prefers-reduced-motion
 * (see styles/motion.css).
 */
export function TaglineStrip({
  className,
  tone = 'ink',
}: {
  className?: string
  tone?: 'ink' | 'light'
}) {
  // Four copies with a wide gap: enough to span an ultrawide viewport without
  // the phrase repeating so densely it reads as a wall of text, and an even
  // count so translating by exactly -50% lands copy 3 where copy 1 began.
  const run = Array.from({ length: 4 })

  return (
    <div className={cn('relative overflow-hidden', className)} aria-hidden="true">
      <div className="flex w-max animate-[mc-marquee_60s_linear_infinite] items-center gap-[22vw] whitespace-nowrap will-change-transform">
        {run.map((_, i) => (
          <span
            key={i}
            className={cn(
              'flex items-center gap-3 text-xs font-medium tracking-wide',
              tone === 'light' ? 'text-white/60' : 'text-chip-500'
            )}
          >
            <LogoMark className="h-3 w-3 opacity-70" />
            {TAGLINE}
          </span>
        ))}
      </div>
    </div>
  )
}
