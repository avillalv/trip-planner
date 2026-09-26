import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

/** Called when any request comes back 401 (another device whose session ended). */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

const appMiddleware: Middleware = {
  onRequest({ request }) {
    // The server rejects writes without this header, which other websites can't send.
    request.headers.set('X-Trip-Planner', '1')
    return request
  },
  onResponse({ response }) {
    if (response.status === 401) unauthorizedListeners.forEach((listener) => listener())
    return response
  },
}

/**
 * Typed API client generated from the backend's OpenAPI schema (`npm run gen:api`).
 * The frontend is always served from the same origin as the API (or proxied by Vite in dev).
 */
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Resolve fetch per call so tests can stub it after import.
  fetch: (request) => globalThis.fetch(request),
})
api.use(appMiddleware)

type ValidationIssue = { msg?: string; loc?: Array<string | number> }

/** Turn a FastAPI error body into one readable sentence. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const issue = detail[0] as ValidationIssue
      return (issue.msg ?? fallback).replace(/^Value error, /, '')
    }
  }
  return fallback
}

/** Unwrap an openapi-fetch result, throwing a readable Error on failure. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) throw new Error(errorMessage(result.error))
  return result.data as T
}
