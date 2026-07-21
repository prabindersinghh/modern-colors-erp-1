import { useEffect, useRef } from 'react'

/**
 * Central data-freshness layer.
 *
 * Every screen used to fetch once on mount and never again unless ITS OWN mutation
 * refetched — so a number changed by another role (or another tab) stayed stale until
 * a manual reload. Verified live: the server answers the very next GET with the new
 * value; the client simply never asked.
 *
 * The fix is one bus + one hook, so future screens inherit correct behaviour:
 *  - window focus / tab visible again  → refetch (throttled — a returning tab must
 *    never show hour-old numbers, but tab-flipping must not spam the backend)
 *  - network reconnect                 → refetch
 *  - any successful mutation (api.post/put/patch/del/postForm notifies the bus)
 *    → mounted screens refetch immediately, so the acting user's other panels are
 *    current without every page hand-wiring "refetch after save"
 *  - OPTIONAL polling, visibility-gated, ONLY for screens that must move while the
 *    user is passively watching (dispatch progress mid-run, the Store inbox)
 *
 * Battery/payload discipline (factory phones on mobile data): no global intervals;
 * polls run only while the document is visible and the screen opts in; focus refetches
 * are throttled; the backend's ETags turn unchanged responses into cheap 304s.
 *
 * Role isolation is untouched by construction: a refresh re-runs the SAME fetch with
 * the SAME token — scope lives server-side in the JWT, so no refresh can widen it.
 */

export type RefreshReason = 'focus' | 'online' | 'mutation' | 'interval'

type Listener = (reason: RefreshReason, detail?: string) => void
const listeners = new Set<Listener>()

/** Subscribe to refresh events. Returns an unsubscribe. (useAutoRefresh uses this;
 *  exported so the refresh path is testable without React.) */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Notify mounted screens that a mutation succeeded (called by the api client). */
export function notifyMutation(path: string): void {
  for (const fn of [...listeners]) fn('mutation', path)
}

function emit(reason: RefreshReason): void {
  for (const fn of [...listeners]) fn(reason)
}

// One set of window listeners for the whole app (module scope, attached once).
let wired = false
function wireWindow(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  window.addEventListener('focus', () => emit('focus'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') emit('focus')
  })
  window.addEventListener('online', () => emit('online'))
}

/** Throttle window for focus/online refetches. Mutations are never throttled. */
export const FOCUS_THROTTLE_MS = 15_000

/**
 * Pure decision: should this event trigger a refetch now?
 * Kept pure so the refresh path is unit-testable — this is the logic that could
 * plausibly break and silently reintroduce stale screens.
 */
export function shouldRefetch(
  reason: RefreshReason,
  now: number,
  lastFetchAt: number,
  throttleMs: number = FOCUS_THROTTLE_MS,
): boolean {
  if (reason === 'mutation' || reason === 'interval') return true
  return now - lastFetchAt >= throttleMs
}

export interface AutoRefreshOptions {
  /**
   * Poll while the tab is visible. Reserve for screens someone passively WATCHES
   * (dispatch progress mid-scan, the Store inbox). Everything else stays event-driven.
   */
  intervalMs?: number
  /** Gate the hook (e.g. only while the relevant tab of a page is active). */
  enabled?: boolean
  /** Override the focus throttle (tests only). */
  throttleMs?: number
}

/**
 * Keep a screen's data current. Pass the screen's existing `load` function —
 * the hook adds the triggers, never changes what is fetched.
 */
export function useAutoRefresh(load: () => void | Promise<unknown>, opts: AutoRefreshOptions = {}): void {
  const { intervalMs, enabled = true, throttleMs = FOCUS_THROTTLE_MS } = opts
  const loadRef = useRef(load)
  loadRef.current = load
  const lastRun = useRef(Date.now()) // mount fetch counts as the first run

  useEffect(() => {
    if (!enabled) return
    wireWindow()

    const run = () => {
      lastRun.current = Date.now()
      void loadRef.current()
    }
    const listener: Listener = (reason) => {
      if (shouldRefetch(reason, Date.now(), lastRun.current, throttleMs)) run()
    }
    const unsubscribe = subscribe(listener)

    let timer: number | undefined
    if (intervalMs) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') listener('interval')
      }, intervalMs)
    }
    return () => {
      unsubscribe()
      if (timer) window.clearInterval(timer)
    }
  }, [enabled, intervalMs, throttleMs])
}
