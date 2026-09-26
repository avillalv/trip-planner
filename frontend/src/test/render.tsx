import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { Providers } from '@/app/providers'

/** Render inside the app providers with a fresh, non-retrying query client. */
export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers queryClient={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </Providers>,
  )
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = unknown | ((request: Request) => Response | Promise<Response>)

/**
 * Stub fetch by "METHOD /path" (or just "/path" for GET). Plain values become JSON responses;
 * unmatched requests fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(String(input))
    const path = new URL(request.url).pathname
    const handler = routes[`${request.method} ${path}`] ?? (request.method === 'GET' ? routes[path] : undefined)
    if (handler === undefined) throw new Error(`Unmocked request: ${request.method} ${path}`)
    return typeof handler === 'function' ? handler(request) : jsonResponse(handler)
  })
}
