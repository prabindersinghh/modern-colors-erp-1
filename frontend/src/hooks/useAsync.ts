import { useCallback, useEffect, useState } from 'react'
import { ApiServiceError } from '@/services/api'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useAsync<T>(
  asyncFn: () => Promise<T>,
  deps: unknown[] = [],
  immediate = true
) {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  })

  const execute = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await asyncFn()
      setState({ data, loading: false, error: null })
      return data
    } catch (err) {
      const message =
        err instanceof ApiServiceError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'An unexpected error occurred'
      setState({ data: null, loading: false, error: message })
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    if (immediate) {
      execute()
    }
  }, [execute, immediate])

  return { ...state, refetch: execute }
}
