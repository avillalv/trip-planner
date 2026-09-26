import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-10">
      <p className="type-code text-5xl text-brand">404</p>
      <h1 className="type-title mt-4">Page not found</h1>
      <p className="mt-3 text-ink-soft">This address doesn't match any page in Trip Planner.</p>
      <Button asChild className="mt-6">
        <Link to="/">Go to trips</Link>
      </Button>
    </div>
  )
}

export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-10">
      <h1 className="type-title">This page failed to load</h1>
      <p className="type-data mt-3 rounded-md border bg-card p-3 text-sm">{message}</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </div>
  )
}
