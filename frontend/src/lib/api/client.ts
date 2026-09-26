import createClient from 'openapi-fetch'
import type { paths } from './schema'

/**
 * Typed API client generated from the backend's OpenAPI schema (`npm run gen:api`).
 * The frontend is always served from the same origin as the API (or proxied by Vite in dev).
 */
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Resolve fetch per call so tests can stub it after import.
  fetch: (request) => globalThis.fetch(request),
})
