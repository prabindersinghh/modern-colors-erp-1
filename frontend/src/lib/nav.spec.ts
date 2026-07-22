import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ROUTE_ROLES,
  ROUTE_PARENTS,
  advanceHistory,
  canAccess,
  canGoForwardFrom,
  canPopWithinScreen,
  homeFor,
  resolveBack,
  toPattern,
  type HistoryCursor,
} from './nav'
import type { Role } from '@/types/api'

/**
 * Back navigation decides where a factory user is sent when they tap the one control
 * they will use most. Pinned here:
 *  - it never offers a screen the role cannot open (an operator must not be bounced
 *    through a dashboard they are not allowed to see);
 *  - a recorded origin wins over the static map, because only it knows the real path;
 *  - the home screen renders no Back at all, rather than a control that does nothing;
 *  - the role map cannot silently drift away from the actual route guards in App.tsx.
 */

const ROLES: Role[] = ['ADMIN', 'OVERSIGHT', 'OPERATOR', 'SUPERVISOR', 'PRODUCTION_HEAD', 'DISPATCH']

describe('the role map mirrors the real routes', () => {
  // Parsed from App.tsx rather than restated, so adding a route with different roles
  // and forgetting nav.ts fails HERE instead of stranding a user at runtime.
  const source = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

  const declared = new Map<string, Role[] | null>()
  // Split on the tag itself — several routes are written multi-line, so a literal
  // '<Route ' with a trailing space silently skips them (it did, and hid /audit).
  for (const chunk of source.split(/<Route\s/).slice(1)) {
    const raw = /^path="([^"]+)"/.exec(chunk.trim())?.[1]
    if (!raw || raw === '*') continue
    // Normalise BEFORE filtering: the dev-only route is written with a leading slash,
    // so a bare 'design-system' comparison let it through as a phantom 18th route.
    const path = `/${raw}`.replace('//', '/')
    if (path === '/design-system') continue
    // Only look at this route's own element, not the ones that follow it.
    const nextRoute = chunk.search(/<Route\s/)
    const element = nextRoute === -1 ? chunk : chunk.slice(0, nextRoute)
    const rolesExpr = /roles=\{(\[[^\]]*\]|PHASE1_ROLES)\}/.exec(element)?.[1]
    const roles = !rolesExpr
      ? null
      : rolesExpr === 'PHASE1_ROLES'
        ? (['ADMIN', 'OPERATOR', 'SUPERVISOR'] as Role[])
        : (rolesExpr.match(/'([A-Z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '') as Role)
    declared.set(path, roles)
  }

  it('found the routes (a parser that silently matches nothing would prove nothing)', () => {
    expect(declared.size).toBe(Object.keys(ROUTE_ROLES).length - 1) // -1: the index route '/'
  })

  it('every route in App.tsx is in ROUTE_ROLES with the same roles', () => {
    for (const [path, roles] of declared) {
      expect({ path, roles: ROUTE_ROLES[path] ?? null }).toEqual({ path, roles })
    }
  })

  it('ROUTE_ROLES invents no route that App.tsx does not serve', () => {
    // '/' is the index route and '/review/:poId' is written as 'review/:poId'.
    const known = new Set([...declared.keys(), '/'])
    for (const path of Object.keys(ROUTE_ROLES)) expect({ path, known: known.has(path) }).toEqual({ path, known: true })
  })
})

describe('canAccess', () => {
  it('refuses a path that is not a route at all', () => {
    expect(canAccess('/not-a-screen', 'ADMIN')).toBe(false)
    expect(canAccess('/../etc', 'ADMIN')).toBe(false)
  })

  it('matches the dynamic review route through its pattern', () => {
    expect(toPattern('/review/abc-123')).toBe('/review/:poId')
    expect(canAccess('/review/abc-123', 'OPERATOR')).toBe(true)
    expect(canAccess('/review/abc-123', 'DISPATCH')).toBe(false)
  })

  it('keeps each role inside its own phase', () => {
    expect(canAccess('/settings', 'ADMIN')).toBe(true)
    expect(canAccess('/settings', 'OPERATOR')).toBe(false)
    expect(canAccess('/oversight', 'OVERSIGHT')).toBe(true)
    expect(canAccess('/oversight', 'ADMIN')).toBe(false)
    expect(canAccess('/dispatch', 'DISPATCH')).toBe(true)
    expect(canAccess('/dispatch', 'PRODUCTION_HEAD')).toBe(false)
  })
})

describe('resolveBack', () => {
  it('renders NO back control on each role’s own home screen', () => {
    for (const role of ROLES) {
      expect({ role, back: resolveBack({ pathname: homeFor(role), role }) }).toEqual({ role, back: null })
    }
  })

  it('falls back to the role home when a screen has no parent', () => {
    expect(resolveBack({ pathname: '/stock-levels', role: 'ADMIN' })).toEqual({ to: '/store', label: 'Store dashboard' })
    expect(resolveBack({ pathname: '/batches', role: 'PRODUCTION_HEAD' })).toEqual({ to: '/my', label: 'My department' })
    expect(resolveBack({ pathname: '/stock-levels', role: 'OVERSIGHT' })).toEqual({
      to: '/oversight',
      label: 'Factory oversight',
    })
  })

  it('uses the declared parent for a real child screen', () => {
    expect(resolveBack({ pathname: '/review/abc', role: 'OPERATOR' })).toEqual({ to: '/review', label: 'Review & Confirm' })
    expect(ROUTE_PARENTS['/review/:poId']).toBe('/review')
  })

  it('prefers where the user actually came from, and keeps its filters', () => {
    // Store reaches Scan & Issue from a request — back belongs to Requests, not the dashboard.
    expect(resolveBack({ pathname: '/stock', role: 'ADMIN', from: '/requests?dept=PU' })).toEqual({
      to: '/requests?dept=PU',
      label: 'Requests',
    })
  })

  it('DISCARDS an origin the role cannot open, rather than stranding them there', () => {
    // A head must never be handed a link back into the Store's screens.
    expect(resolveBack({ pathname: '/batches', role: 'PRODUCTION_HEAD', from: '/settings' })).toEqual({
      to: '/my',
      label: 'My department',
    })
  })

  it('ignores an origin that is not an in-app path', () => {
    for (const from of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '', 42, null]) {
      expect(resolveBack({ pathname: '/batches', role: 'ADMIN', from })).toEqual({ to: '/store', label: 'Store dashboard' })
    }
  })

  it('ignores an origin pointing at the screen we are already on', () => {
    expect(resolveBack({ pathname: '/batches', role: 'ADMIN', from: '/batches' })).toEqual({
      to: '/store',
      label: 'Store dashboard',
    })
  })

  it('never returns a target the current role cannot open — for every screen and role', () => {
    for (const role of ROLES) {
      for (const pattern of Object.keys(ROUTE_ROLES)) {
        const back = resolveBack({ pathname: pattern.replace(':poId', 'x'), role })
        if (back) expect({ role, pattern, ok: canAccess(back.to, role) }).toEqual({ role, pattern, ok: true })
      }
    }
  })
})

describe('advanceHistory — forward availability', () => {
  const start: HistoryCursor = { keys: [], hrefs: [], index: 0 }
  const walk = (steps: [string, 'PUSH' | 'POP' | 'REPLACE'][]) =>
    steps.reduce((c, [key, type]) => advanceHistory(c, key, type), start)

  it('has nothing ahead until you have gone back', () => {
    const c = walk([['a', 'PUSH'], ['b', 'PUSH']])
    expect(canGoForwardFrom(c)).toBe(false)
    expect(canGoForwardFrom(advanceHistory(c, 'a', 'POP'))).toBe(true)
  })

  it('going back then forward returns to the same entry, no path redone', () => {
    let c = walk([['a', 'PUSH'], ['b', 'PUSH'], ['c', 'PUSH']])
    c = advanceHistory(c, 'b', 'POP')
    expect(c.index).toBe(1)
    c = advanceHistory(c, 'c', 'POP') // the forward move is itself a POP
    expect(c.index).toBe(2)
    expect(canGoForwardFrom(c)).toBe(false)
  })

  it('a NEW navigation after going back drops the abandoned branch', () => {
    // Otherwise forward would still offer 'c' — a screen the user chose to leave.
    let c = walk([['a', 'PUSH'], ['b', 'PUSH'], ['c', 'PUSH']])
    c = advanceHistory(c, 'b', 'POP')
    c = advanceHistory(c, 'd', 'PUSH')
    expect(c.keys).toEqual(['a', 'b', 'd'])
    expect(canGoForwardFrom(c)).toBe(false)
  })

  it('REPLACE (a search box typing) never adds an entry', () => {
    // The whole reason searches replace: ten keystrokes must not bury the last screen.
    let c = walk([['a', 'PUSH'], ['b', 'PUSH']])
    for (const k of ['b1', 'b2', 'b3']) c = advanceHistory(c, k, 'REPLACE')
    expect(c.keys).toEqual(['a', 'b3'])
    expect(c.index).toBe(1)
  })

  it('an unknown POP target (a reload) resets rather than guessing', () => {
    const c = advanceHistory(walk([['a', 'PUSH'], ['b', 'PUSH']]), 'zz', 'POP')
    expect(c).toEqual({ keys: ['zz'], hrefs: [''], index: 0 })
    expect(canGoForwardFrom(c)).toBe(false)
  })
})

describe('canPopWithinScreen — closing a tab must not exit the app', () => {
  const start: HistoryCursor = { keys: [], hrefs: [], index: 0 }
  const go = (c: HistoryCursor, key: string, href: string) => advanceHistory(c, key, 'PUSH', href)

  it('pops when the previous entry is the same screen', () => {
    // /oversight → /oversight?view=users : back closes the view.
    let c = go(start, 'a', '/oversight')
    c = go(c, 'b', '/oversight?view=users')
    expect(canPopWithinScreen(c, '/oversight')).toBe(true)
  })

  it('REFUSES to pop when the previous entry is a different screen', () => {
    // Arriving from Requests, popping would leave oversight rather than close the view.
    let c = go(start, 'a', '/requests')
    c = go(c, 'b', '/oversight?view=users')
    expect(canPopWithinScreen(c, '/oversight')).toBe(false)
  })

  it('REFUSES to pop on a deep link with nothing behind it', () => {
    // The dangerous case: popping here exits the app entirely.
    const c = go(start, 'a', '/oversight?view=users')
    expect(canPopWithinScreen(c, '/oversight')).toBe(false)
  })
})
