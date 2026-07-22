import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useLocation, useNavigate, useNavigationType, type LinkProps } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import {
  advanceHistory,
  canGoForwardFrom,
  canPopWithinScreen,
  resolveBack,
  type BackTarget,
  type HistoryCursor,
} from '@/lib/nav'

/**
 * The runtime half of back/forward navigation. `nav.ts` decides WHERE back goes;
 * this decides how the control behaves on a real device:
 *
 *  - Forward is the browser's own forward, so going back never costs the user their
 *    place. Whether it is available is tracked here because the platform will not
 *    tell us (there is no `history.canGoForward`).
 *  - Scroll position is restored on a backward move only, so returning to a long
 *    list (Stock Levels, the ledger, the catalogue) lands where you left it.
 *  - A screen mid-flow can OWN the back gesture (`usePageBack`) — the scan screens
 *    use this so Back means "back to the camera", not "leave the run".
 *  - A screen with unsaved edits can require a confirmation (`useUnsavedChanges`).
 *
 * Nothing here performs a write, and back never calls a mutation: it is only ever a
 * `navigate()` to a path that `resolveBack` has already checked against the role.
 */

interface NavState {
  back: BackTarget | null
  goBack: () => void
  canGoForward: boolean
  goForward: () => void
  /** Set by a screen that owns the back gesture while mid-flow. */
  setPageBack: (handler: { run: () => void; label: string } | null) => void
  /** Set by a screen with unsaved work; returns the warning to show. */
  setUnsaved: (message: string | null) => void
  /** Close a tab/detail opened inside the current screen. */
  goBackWithinScreen: (fallback: string) => void
  pendingMessage: string | null
  confirmPending: () => void
  cancelPending: () => void
}

const NavigationContext = createContext<NavState | null>(null)

/** Where the user currently is, in the form we record as an origin. */
function useHref() {
  const location = useLocation()
  return location.pathname + location.search
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const { user } = useAuth()

  const [canGoForward, setCanGoForward] = useState(false)
  const [pageBack, setPageBackState] = useState<{ run: () => void; label: string } | null>(null)
  const [unsaved, setUnsavedState] = useState<string | null>(null)
  // A back request held while the user answers "discard your changes?".
  const [pending, setPending] = useState<(() => void) | null>(null)

  // --- Forward availability -------------------------------------------------
  // The browser exposes no "can I go forward?", so the visited keys are tracked
  // here: PUSH truncates anything ahead, POP just moves the cursor.
  // The fold itself lives in nav.ts so it can be tested without a browser.
  const cursor = useRef<HistoryCursor>({ keys: [], hrefs: [], index: 0 })

  useEffect(() => {
    cursor.current = advanceHistory(
      cursor.current,
      location.key,
      navigationType,
      location.pathname + location.search,
    )
    setCanGoForward(canGoForwardFrom(cursor.current))
  }, [location.key, navigationType, location.pathname, location.search])

  // --- Scroll restoration ---------------------------------------------------
  // Positions are keyed by history entry, so two visits to the same list held at
  // different offsets each come back to their own place.
  const positions = useRef(new Map<string, number>())
  const currentKey = useRef(location.key)

  useEffect(() => {
    const onScroll = () => positions.current.set(currentKey.current, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    currentKey.current = location.key
    const saved = positions.current.get(location.key)
    // Only a backward/forward move restores. A fresh push should start at the top,
    // exactly as tapping a nav item always has.
    if (navigationType === 'POP' && saved) {
      let cancelled = false
      const abort = () => {
        cancelled = true
      }
      // The list may still be fetching, so the page can be too short to scroll on
      // the first frame. Try a few frames, and stop the moment the user scrolls.
      window.addEventListener('wheel', abort, { once: true, passive: true })
      window.addEventListener('touchmove', abort, { once: true, passive: true })
      let frames = 0
      const attempt = () => {
        if (cancelled || frames++ > 12) return
        if (Math.abs(window.scrollY - saved) > 2) window.scrollTo(0, saved)
        if (window.scrollY !== saved) requestAnimationFrame(attempt)
      }
      requestAnimationFrame(attempt)
      return () => {
        cancelled = true
        window.removeEventListener('wheel', abort)
        window.removeEventListener('touchmove', abort)
      }
    }
    window.scrollTo(0, 0)
  }, [location.key, navigationType])

  // --- Leaving with unsaved work -------------------------------------------
  // Covers a tab close or reload; the in-app control asks with a real dialog.
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])

  const back = useMemo(
    () =>
      resolveBack({
        pathname: location.pathname,
        role: user?.role,
        from: (location.state as { from?: unknown } | null)?.from,
      }),
    [location.pathname, location.state, user?.role],
  )

  /** Run an action, first asking about unsaved work if a screen declared any. */
  const guarded = useCallback(
    (action: () => void) => {
      if (unsaved) setPending(() => action)
      else action()
    },
    [unsaved],
  )

  const goBack = useCallback(() => {
    // A screen that owns the gesture handles it itself (and is responsible for its
    // own confirmation — a scan run has nothing unsaved to lose).
    if (pageBack) {
      pageBack.run()
      return
    }
    if (back) guarded(() => navigate(back.to))
  }, [pageBack, back, guarded, navigate])

  const goForward = useCallback(() => guarded(() => navigate(1)), [guarded, navigate])

  /**
   * Close something opened WITHIN this screen (a tab, a detail). Pops history when the
   * previous entry is this same screen, so the in-app control and the system back
   * gesture do the same thing. When it is not — a deep link, or arriving from another
   * screen — it navigates to `fallback` instead: popping there would leave the app.
   */
  const goBackWithinScreen = useCallback(
    (fallback: string) => {
      if (canPopWithinScreen(cursor.current, location.pathname)) navigate(-1)
      else navigate(fallback, { replace: true })
    },
    [location.pathname, navigate],
  )

  const setPageBack = useCallback((handler: { run: () => void; label: string } | null) => {
    setPageBackState(handler)
  }, [])

  const value = useMemo<NavState>(
    () => ({
      // A screen that owns the gesture supplies the label too, so the control still
      // names its destination ("Back to scan") instead of vanishing on screens where
      // resolveBack has nothing to offer — a role's own home with a view open.
      back: pageBack ? { to: '', label: pageBack.label } : back,
      goBack,
      canGoForward,
      goForward,
      setPageBack,
      setUnsaved: setUnsavedState,
      goBackWithinScreen,
      pendingMessage: pending ? unsaved : null,
      confirmPending: () => {
        const action = pending
        setPending(null)
        setUnsavedState(null) // the screen is being left; its guard goes with it
        action?.()
      },
      cancelPending: () => setPending(null),
    }),
    [back, goBack, canGoForward, goForward, setPageBack, goBackWithinScreen, pending, unsaved],
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavState {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation must be used inside <NavigationProvider>')
  return ctx
}

/**
 * Let a screen own the back gesture while it is mid-flow — the scan screens use this
 * so Back returns to the camera instead of abandoning the run. Pass null to release it.
 */
export function usePageBack(handler: (() => void) | null, label = 'Back') {
  const { setPageBack } = useNavigation()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!handler) {
      setPageBack(null)
      return
    }
    // Indirect through the ref so a re-created closure does not re-register on
    // every render; only presence and label changes matter here.
    setPageBack({ run: () => ref.current?.(), label })
    return () => setPageBack(null)
  }, [!handler, label, setPageBack]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Declare that this screen holds unsaved work, so leaving it asks first. */
export function useUnsavedChanges(active: boolean, message: string) {
  const { setUnsaved } = useNavigation()
  useEffect(() => {
    setUnsaved(active ? message : null)
    return () => setUnsaved(null)
  }, [active, message, setUnsaved])
}

/**
 * A link that records where it was followed from, so the destination's Back can
 * return there instead of falling back to the role's dashboard. Use for jumps
 * ACROSS screens (Requests → Scan & Issue); plain <Link> is right within a screen.
 */
export function AppLink({ children, ...props }: LinkProps) {
  const from = useHref()
  return (
    <Link {...props} state={{ ...(props.state as object | null), from }}>
      {children}
    </Link>
  )
}
