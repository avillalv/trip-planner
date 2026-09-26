import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isStaleBuild } from '@/lib/errors'
import { RouteError } from '@/routes/errors'
import { ErrorBoundary, PartFailed } from './error-boundary'

const STALE = 'Failed to fetch dynamically imported module: http://localhost:8000/assets/trip-flights-DZNzPC.js'

function Broken({ message }: { message: string }): never {
  throw new Error(message)
}

describe('isStaleBuild', () => {
  it('spots code that went missing in a rebuild, in each browser’s wording', () => {
    expect(isStaleBuild(new Error(STALE))).toBe(true)
    expect(isStaleBuild(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleBuild(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleBuild(new Error('Network error'))).toBe(false)
    expect(isStaleBuild('Failed to fetch dynamically imported module')).toBe(false)
  })
})

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React reports caught render errors to the console; keep test output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows what failed in place of the broken part, leaving the rest', () => {
    render(
      <div>
        <p>Plans for the day</p>
        <ErrorBoundary fallback={(error) => <PartFailed what="map" error={error} />}>
          <Broken message="Failed to initialize WebGL." />
        </ErrorBoundary>
      </div>,
    )

    expect(screen.getByText('Plans for the day')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The map couldn’t be shown')
    expect(screen.getByRole('alert')).toHaveTextContent('Maps need WebGL')
  })

  it('asks for a reload when the app was updated underneath the page', () => {
    render(
      <ErrorBoundary fallback={(error) => <PartFailed what="calendar" error={error} />}>
        <Broken message={STALE} />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Trip Planner was updated')
  })
})

describe('RouteError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderFailing(message: string) {
    const router = createMemoryRouter([
      {
        path: '/',
        errorElement: <RouteError />,
        loader: () => {
          throw new Error(message)
        },
        element: <p>Never shown</p>,
      },
    ])
    render(<RouterProvider router={router} />)
  }

  it('explains a page that went missing in an update', async () => {
    renderFailing(STALE)

    expect(await screen.findByRole('heading', { name: 'Trip Planner was updated' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
  })

  it('shows other failures with a way back', async () => {
    renderFailing('Unexpected token < in JSON')

    expect(await screen.findByRole('heading', { name: 'This page failed to load' })).toBeInTheDocument()
    expect(screen.getByText('Unexpected token < in JSON')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to trips' })).toHaveAttribute('href', '/')
  })
})
