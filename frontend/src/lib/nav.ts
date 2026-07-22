import type { Role } from '@/types/api'

/**
 * Where "Back" goes, for every screen and every role.
 *
 * This app's routes are almost entirely FLAT — a set of sidebar destinations, not a
 * hierarchy. So "back" cannot come from the URL shape alone. Three sources are used,
 * in order of how much they actually know about the user's path:
 *
 *   1. the origin recorded when the link was followed (contextual — knows that you
 *      reached Scan & Issue *from a request*, which no static map can know);
 *   2. a static parent, for the few genuine parent/child screens;
 *   3. the role's own home screen, so Back always does something sensible.
 *
 * Every candidate is filtered through {@link canAccess} before it is offered, so a
 * back navigation can never land someone on a screen their role cannot open.
 */

/** Titles for every route — shared by the Navbar heading and the Back label. */
export const ROUTE_TITLES: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Dashboard', subtitle: "Today's invoices, materials received, pending scans/weighing" },
  '/oversight': { title: 'Factory oversight', subtitle: 'Every department, read-only' },
  '/store': { title: 'Store dashboard', subtitle: 'Requests to action, stock health and today’s movement' },
  '/my': { title: 'My department', subtitle: 'Your requests, batches and consumption' },
  '/requests': { title: 'Requests', subtitle: 'Raise and track per-material production requests' },
  '/stock': { title: 'Scan & Issue', subtitle: 'Scan a unit to add, deduct or discard stock' },
  '/stock-levels': { title: 'Stock Levels', subtitle: 'Live balances, ageing and the movement ledger' },
  '/batches': { title: 'Batches', subtitle: 'Thread raw materials through to finished goods' },
  '/production-output': { title: 'Production Output', subtitle: 'Record what a batch produced, then confirm it' },
  '/dispatch': { title: 'Dispatch', subtitle: 'Scan finished goods out of the factory' },
  '/purchase-orders': { title: 'Invoice Upload', subtitle: 'Upload an invoice for AI extraction' },
  '/review': { title: 'Review & Confirm', subtitle: 'Verify and correct extracted materials before saving' },
  '/review/:poId': { title: 'Review & Confirm', subtitle: 'Verify and correct extracted materials before saving' },
  '/labels': { title: 'QR Labels', subtitle: 'Generate and print QR labels per physical unit' },
  '/receiving': { title: 'Receive Stock', subtitle: 'Scan each sack on arrival — no weighing' },
  '/catalogue': { title: 'Master Catalogue', subtitle: 'Factory raw-material SKU reference' },
  '/audit': { title: 'Audit Log', subtitle: 'Immutable record of every change' },
  '/settings': { title: 'Settings', subtitle: 'Claude API key and system configuration' },
}

const PHASE1_ROLES: Role[] = ['ADMIN', 'OPERATOR', 'SUPERVISOR']

/**
 * Which roles may open which route. This MIRRORS the <RequireRole> wrappers in App.tsx
 * and is asserted against them in nav.spec.ts, so the two cannot drift apart. It is a
 * navigation aid, NOT an access control: the server is the only real enforcement.
 * `null` means every authenticated role.
 */
export const ROUTE_ROLES: Record<string, Role[] | null> = {
  '/': null,
  '/requests': ['PRODUCTION_HEAD', 'OVERSIGHT', 'ADMIN'],
  '/stock': ['ADMIN'],
  '/stock-levels': ['ADMIN', 'OVERSIGHT'],
  '/oversight': ['OVERSIGHT'],
  '/store': ['ADMIN'],
  '/my': ['PRODUCTION_HEAD'],
  '/batches': ['PRODUCTION_HEAD', 'ADMIN', 'OVERSIGHT'],
  '/production-output': ['PRODUCTION_HEAD'],
  '/dispatch': ['DISPATCH'],
  '/purchase-orders': PHASE1_ROLES,
  '/review': PHASE1_ROLES,
  '/review/:poId': PHASE1_ROLES,
  '/labels': PHASE1_ROLES,
  '/receiving': PHASE1_ROLES,
  '/catalogue': PHASE1_ROLES,
  '/audit': ['ADMIN', 'SUPERVISOR'],
  '/settings': ['ADMIN'],
}

/**
 * The few real parent/child pairs. Everything else is a sidebar sibling whose only
 * sensible parent is the role's home — see {@link resolveBack}.
 */
export const ROUTE_PARENTS: Record<string, string> = {
  '/review/:poId': '/review',
}

/** The landing screen per role. Mirrors HomeRoute in App.tsx. */
export function homeFor(role: Role | undefined): string {
  switch (role) {
    case 'OVERSIGHT':
      return '/oversight'
    case 'PRODUCTION_HEAD':
      return '/my'
    case 'DISPATCH':
      return '/dispatch'
    case 'ADMIN':
      return '/store'
    default:
      return '/'
  }
}

/**
 * Reduce a real pathname to the route pattern it matched (`/review/abc` → `/review/:poId`).
 * Only the one dynamic route exists today; the loop keeps it honest if more are added.
 */
export function toPattern(pathname: string): string {
  const bare = pathname.split('?')[0].split('#')[0]
  const path = bare.length > 1 && bare.endsWith('/') ? bare.slice(0, -1) : bare
  if (ROUTE_TITLES[path] || ROUTE_ROLES[path] !== undefined) return path
  const segments = path.split('/')
  for (const pattern of Object.keys(ROUTE_ROLES)) {
    const parts = pattern.split('/')
    if (parts.length !== segments.length) continue
    if (parts.every((p, i) => p.startsWith(':') || p === segments[i])) return pattern
  }
  return path
}

/** May this role open this path? Unknown paths are refused rather than assumed safe. */
export function canAccess(pathname: string, role: Role | undefined): boolean {
  const roles = ROUTE_ROLES[toPattern(pathname)]
  if (roles === undefined) return false // not a route we know — never send anyone there
  if (roles === null) return true
  return !!role && roles.includes(role)
}

/**
 * A `from` value only ever arrives via router state we set ourselves, but it is still
 * treated as untrusted: an absolute URL or a protocol-relative one must never become a
 * navigation target, and a path this role cannot open is discarded rather than followed.
 */
function usableOrigin(from: unknown, role: Role | undefined, here: string): string | null {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return null
  const path = from.split('?')[0].split('#')[0]
  if (path === here) return null // a self-referential origin would be a dead button
  return canAccess(path, role) ? from : null
}

export interface BackTarget {
  /** Where to navigate — may carry the origin's own query string. */
  to: string
  /** Name of the destination, for the control's label and aria-label. */
  label: string
}

/**
 * Resolve the Back target for a screen, or null when there is nowhere sensible to go
 * (i.e. the user is already on their home screen — no dead control is rendered).
 */
export function resolveBack(args: {
  pathname: string
  role: Role | undefined
  /** `location.state.from`, recorded when the user followed a link here. */
  from?: unknown
}): BackTarget | null {
  const { pathname, role, from } = args
  const here = toPattern(pathname)
  const home = homeFor(role)

  const label = (to: string) => ROUTE_TITLES[toPattern(to)]?.title ?? 'Back'

  // 1. Where the user actually came from, when we recorded it.
  const origin = usableOrigin(from, role, here)
  if (origin) return { to: origin, label: label(origin) }

  // 2. A declared parent screen.
  const parent = ROUTE_PARENTS[here]
  if (parent && canAccess(parent, role)) return { to: parent, label: label(parent) }

  // 3. The role's home — unless that is already where we are.
  if (here !== toPattern(home) && canAccess(home, role)) return { to: home, label: label(home) }

  return null
}

/** A visited-history cursor: which entries exist, where we are, and their URLs. */
export interface HistoryCursor {
  keys: string[]
  /** Parallel to `keys` — needed to know whether a back step stays in this screen. */
  hrefs: string[]
  index: number
}

/**
 * Fold one navigation into the visited-history cursor.
 *
 * The platform exposes no `history.canGoForward`, so forward availability is derived
 * from this. The rule that matters is the PUSH branch: navigating somewhere new must
 * DROP everything ahead of the cursor, exactly as the browser does — otherwise the
 * forward arrow survives into a branch the user abandoned and sends them somewhere
 * they never went.
 */
export function advanceHistory(
  current: HistoryCursor,
  key: string,
  type: 'PUSH' | 'POP' | 'REPLACE',
  href = '',
): HistoryCursor {
  if (current.keys.length === 0) return { keys: [key], hrefs: [href], index: 0 }
  if (type === 'POP') {
    const at = current.keys.indexOf(key)
    // An entry we have never seen (a reload, or an entry from before this load):
    // the old cursor describes a history we can no longer reason about.
    return at === -1 ? { keys: [key], hrefs: [href], index: 0 } : { ...current, index: at }
  }
  if (type === 'REPLACE') {
    const keys = [...current.keys]
    const hrefs = [...current.hrefs]
    keys[current.index] = key
    hrefs[current.index] = href
    return { keys, hrefs, index: current.index }
  }
  const keys = [...current.keys.slice(0, current.index + 1), key]
  const hrefs = [...current.hrefs.slice(0, current.index + 1), href]
  return { keys, hrefs, index: keys.length - 1 }
}

/** Whether a forward move is possible from this cursor. */
export const canGoForwardFrom = (c: HistoryCursor) => c.index < c.keys.length - 1

/**
 * The entry one step back, if we have seen it. Used to decide whether an in-screen
 * back (closing a tab or a detail) can safely POP — popping when the previous entry
 * belongs to another screen, or to no page of ours at all, would throw the user out
 * of the app instead of closing what they opened.
 */
export function canPopWithinScreen(c: HistoryCursor, pathname: string): boolean {
  if (c.index <= 0) return false
  const prev = c.hrefs[c.index - 1]
  return typeof prev === 'string' && prev.split('?')[0] === pathname
}
