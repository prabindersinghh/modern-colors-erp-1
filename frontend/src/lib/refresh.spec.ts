import { describe, expect, it, vi } from 'vitest'
import { FOCUS_THROTTLE_MS, notifyMutation, shouldRefetch, subscribe } from './refresh'

/**
 * The refresh path is what keeps every dashboard honest — if this logic breaks,
 * screens silently go stale again with no error anywhere. Pinned here:
 *  - mutations and polls are NEVER throttled (an acted-on number must update now);
 *  - focus/online ARE throttled (tab-flipping must not spam a mobile connection);
 *  - the bus delivers to every subscriber and unsubscribe really detaches.
 */
describe('shouldRefetch', () => {
  const t0 = 1_000_000

  it('always refetches on a mutation — even immediately after a fetch', () => {
    expect(shouldRefetch('mutation', t0, t0)).toBe(true)
    expect(shouldRefetch('mutation', t0 + 1, t0)).toBe(true)
  })

  it('always refetches on an interval tick (the poll IS the cadence)', () => {
    expect(shouldRefetch('interval', t0 + 1, t0)).toBe(true)
  })

  it('throttles focus: a quick tab-flip does not refetch, a real return does', () => {
    expect(shouldRefetch('focus', t0 + 2_000, t0)).toBe(false) // flipped back after 2s
    expect(shouldRefetch('focus', t0 + FOCUS_THROTTLE_MS, t0)).toBe(true) // returned later
  })

  it('throttles reconnect the same way (flapping networks must not storm)', () => {
    expect(shouldRefetch('online', t0 + 1_000, t0)).toBe(false)
    expect(shouldRefetch('online', t0 + FOCUS_THROTTLE_MS + 1, t0)).toBe(true)
  })

  it('honours a custom throttle window', () => {
    expect(shouldRefetch('focus', t0 + 400, t0, 300)).toBe(true)
    expect(shouldRefetch('focus', t0 + 200, t0, 300)).toBe(false)
  })
})

describe('refresh bus', () => {
  it('delivers a mutation to every subscriber with the path', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribe(a)
    const offB = subscribe(b)
    notifyMutation('/stock/transactions')
    expect(a).toHaveBeenCalledWith('mutation', '/stock/transactions')
    expect(b).toHaveBeenCalledWith('mutation', '/stock/transactions')
    offA()
    offB()
  })

  it('unsubscribe really detaches — no refetches from unmounted screens', () => {
    const fn = vi.fn()
    const off = subscribe(fn)
    off()
    notifyMutation('/x')
    expect(fn).not.toHaveBeenCalled()
  })
})
