import { delay } from '@/lib/utils'

export class ApiServiceError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiServiceError'
    this.code = code
  }
}

export interface RequestOptions {
  simulateError?: boolean
  delayMs?: number
}

const DEFAULT_DELAY = 400

export async function mockRequest<T>(
  fn: () => T,
  options: RequestOptions = {}
): Promise<T> {
  const { simulateError = false, delayMs = DEFAULT_DELAY } = options
  await delay(delayMs)

  if (simulateError) {
    throw new ApiServiceError('Unable to connect to server. Please try again.', 'NETWORK_ERROR')
  }

  return fn()
}

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

export function buildQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value))
    }
  })
  const qs = searchParams.toString()
  return qs ? `?${qs}` : ''
}
