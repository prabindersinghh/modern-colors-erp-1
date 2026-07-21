import { notifyMutation } from '@/lib/refresh'

// Typed REST client for the Modern Colours backend.
// JWT is stored in localStorage; a 401 clears it and notifies listeners so the
// auth layer can redirect to the login screen.

// Same-origin by default — the Vite dev server proxies /api to the backend
// (so the phone camera works over HTTPS with no CORS / mixed-content issues).
// Override with VITE_API_URL for a separately-hosted API.
// Normalize common misconfigurations: a bare hostname (no scheme) would otherwise
// be fetched as a RELATIVE path against the frontend origin (→ 404/405), and a
// missing /api suffix would miss the backend's global prefix.
function normalizeApiBase(raw: string | undefined): string {
  let base = (raw ?? '/api').trim().replace(/\/+$/, '')
  if (!base) return '/api'
  if (!base.startsWith('/') && !/^https?:\/\//i.test(base)) base = `https://${base}`
  if (!/\/api$/i.test(base)) base = `${base}/api`
  return base
}
const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_URL)
const TOKEN_KEY = 'mc_token'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn)
  return () => {
    unauthorizedListeners.delete(fn)
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = tokenStore.get()
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    tokenStore.clear()
    unauthorizedListeners.forEach((fn) => fn())
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const message =
      (data && (data.message || (Array.isArray(data.message) && data.message.join(', ')))) ||
      `Request failed (${res.status})`
    throw new ApiError(
      Array.isArray(message) ? message.join(', ') : String(message),
      res.status,
      data?.code,
    )
  }
  return data as T
}

export interface RequestOptions {
  timeoutMs?: number
  // Auto-retry ONLY on connection-level failures (network error / timeout) where NO
  // HTTP response was received — safe for idempotent calls. Never retries on a 4xx/5xx
  // response. Defaults: GET=2, login opts in to 3, other mutations=0 (no double-submit).
  retries?: number
}

const DEFAULT_TIMEOUT = 20_000

// fetch with an abort-based timeout + bounded retries and backoff. This is the key
// resilience layer for high-latency mobile connections (factory floor on 4G/5G in
// India → a US-hosted backend) and for waking a cold-started container.
async function doFetch(path: string, init: RequestInit, opts: RequestOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  const retries = opts.retries ?? 0
  let aborted = false
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal })
    } catch (err) {
      // Only reached when no response arrived (network drop / timeout) — safe to retry.
      aborted = err instanceof DOMException && err.name === 'AbortError'
      if (attempt >= retries) break
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new ApiError(
    aborted
      ? 'The server took too long to respond. Please check your connection and try again.'
      : 'Cannot reach the server. Please check your connection and try again.',
    0,
    aborted ? 'TIMEOUT' : 'NETWORK',
  )
}

/** A successful mutation notifies the refresh bus, so every mounted screen of THIS
 *  user refetches immediately — no page has to hand-wire "refetch after save". */
function afterMutation<T>(path: string, p: Promise<T>): Promise<T> {
  return p.then((data) => {
    try {
      notifyMutation(path)
    } catch {
      /* refresh is best-effort — a listener error must never fail the mutation */
    }
    return data
  })
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    doFetch(path, { headers: authHeaders() }, { retries: 2, ...opts }).then((r) => parse<T>(r)),

  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    afterMutation(
      path,
      doFetch(
        path,
        {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        opts,
      ).then((r) => parse<T>(r)),
    ),

  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    afterMutation(
      path,
      doFetch(
        path,
        {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        opts,
      ).then((r) => parse<T>(r)),
    ),

  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    afterMutation(
      path,
      doFetch(
        path,
        {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
        opts,
      ).then((r) => parse<T>(r)),
    ),

  del: <T>(path: string, opts?: RequestOptions) =>
    afterMutation(path, doFetch(path, { method: 'DELETE', headers: authHeaders() }, opts).then((r) => parse<T>(r))),

  // Uploads: no auto-retry (would risk a duplicate PO) but a longer timeout for large
  // phone photos over slow mobile links.
  postForm: <T>(path: string, form: FormData, opts?: RequestOptions) =>
    afterMutation(
      path,
      doFetch(
        path,
        { method: 'POST', headers: authHeaders(), body: form }, // browser sets multipart boundary
        { timeoutMs: 60_000, ...opts },
      ).then((r) => parse<T>(r)),
    ),

  // Wake a possibly-cold backend before the user acts (fire-and-forget).
  warmUp: () =>
    doFetch('/health', { headers: {} }, { timeoutMs: 25_000, retries: 1 })
      .then(() => undefined)
      .catch(() => undefined),

  // Open a binary endpoint (PDF) in a new tab with the bearer token.
  openBlob: async (path: string) => {
    const res = await doFetch(path, { headers: authHeaders() }, { timeoutMs: 60_000, retries: 1 })
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },

  // Download a binary endpoint to a file (bearer token; blob URLs drop the server
  // filename, so we set it explicitly on the anchor).
  downloadBlob: async (path: string, filename: string) => {
    const res = await doFetch(path, { headers: authHeaders() }, { timeoutMs: 60_000, retries: 1 })
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },

  // Fetch a binary endpoint (with the bearer token) as an object URL + content type,
  // for embedding (e.g. the PO document preview). Caller must revoke the URL.
  fetchBlobUrl: async (path: string): Promise<{ url: string; contentType: string }> => {
    const res = await doFetch(path, { headers: authHeaders() }, { timeoutMs: 60_000, retries: 1 })
    if (!res.ok) throw new ApiError(`Load failed (${res.status})`, res.status)
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), contentType: res.headers.get('content-type') || blob.type }
  },
}
