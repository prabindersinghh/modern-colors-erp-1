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

export const api = {
  get: <T>(path: string) =>
    fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() }).then((r) => parse<T>(r)),

  post: <T>(path: string, body?: unknown) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => parse<T>(r)),

  put: <T>(path: string, body?: unknown) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => parse<T>(r)),

  patch: <T>(path: string, body?: unknown) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => parse<T>(r)),

  del: <T>(path: string) =>
    fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers: authHeaders() }).then((r) =>
      parse<T>(r),
    ),

  postForm: <T>(path: string, form: FormData) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: authHeaders(), // browser sets multipart boundary
      body: form,
    }).then((r) => parse<T>(r)),

  // Open a binary endpoint (PDF) in a new tab with the bearer token.
  openBlob: async (path: string) => {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() })
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },
}
