import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A piece of screen state that lives in the URL instead of in `useState`.
 *
 * This is what makes back work INSIDE a screen. The app's routes are flat, so a tab,
 * a chosen batch or an open detail used to be invisible to history: pressing back (or
 * swiping from the edge on Android) left the screen entirely instead of closing what
 * was open. Kept in the query string, each of those becomes a real history entry, and
 * returning to a list also returns its filters.
 *
 * `push` is the choice that matters:
 *  - a tab or an opened detail is a place the user went → push, so back closes it;
 *  - a search box is not → replace, or a ten-character query buries the previous
 *    screen under ten history entries and back appears broken.
 *
 * Values equal to the default are removed from the URL, so the common case stays a
 * clean link worth sharing.
 */
export function useUrlParam<T extends string>(
  key: string,
  defaultValue: T,
  { push = true, allowed }: { push?: boolean; allowed?: readonly T[] } = {},
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key) as T | null
  // The URL is user-editable. A tab whose value came from the address bar must still
  // be one the screen can render, so anything unrecognised falls back to the default
  // rather than blanking the view.
  const value = raw !== null && (!allowed || allowed.includes(raw)) ? raw : defaultValue

  const set = useCallback(
    (next: T) => {
      // Bail when nothing would change. Radix activates a tab on BOTH pointer-down
      // and the focus that follows, so the same value arrives TWICE IN ONE TICK —
      // before React re-renders, which is why this reads the live URL rather than the
      // `params` snapshot (both closures would still hold the pre-click value and
      // both would push). Left unguarded, one tab tap costs two identical history
      // entries and the user's next Back visibly does nothing.
      const currentValue = new URLSearchParams(window.location.search).get(key) ?? ''
      const wanted = !next || next === defaultValue ? '' : next
      if (currentValue === wanted) return

      // Functional form: two params changed in one tick must not clobber each other.
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (!next || next === defaultValue) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        { replace: !push },
      )
    },
    [key, defaultValue, push, setParams],
  )

  return [value, set]
}

/**
 * Free text in the URL — a search box or filter field. Separate from useUrlParam
 * because inferring the type from an empty-string default pins it to the literal
 * type `''`, which makes the setter refuse every real value.
 */
export function useUrlText(key: string, { push = false }: { push?: boolean } = {}) {
  return useUrlParam<string>(key, '', { push })
}

/** The same, for a value that is either present or absent (an open detail, a toggle). */
export function useUrlFlag(
  key: string,
  { push = true }: { push?: boolean } = {},
): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useUrlText(key, { push })
  return [raw === '1', useCallback((v: boolean) => setRaw(v ? '1' : ''), [setRaw])]
}

/** A nullable id in the URL — an open detail view, a selected row. */
export function useUrlId(
  key: string,
  { push = true }: { push?: boolean } = {},
): [string | null, (value: string | null) => void] {
  const [raw, setRaw] = useUrlText(key, { push })
  return [raw || null, useCallback((v: string | null) => setRaw(v ?? ''), [setRaw])]
}
