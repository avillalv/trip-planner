import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { isStaleBuild } from '@/lib/errors'

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
  if (isStaleBuild(error)) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-10">
        <h1 className="type-title">Trip Planner was updated</h1>
        <p className="mt-3 text-ink-soft">This page changed since you opened it. Reload to get the new version.</p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    )
  }
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-10">
      <h1 className="type-title">This page failed to load</h1>
      <p className="mt-3 text-ink-soft">Reload to try again. If it keeps happening, the message below says what went wrong.</p>
      <p className="type-data mt-3 rounded-md border bg-card p-3 text-sm">{message}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => window.location.reload()}>Reload page</Button>
        <Button variant="outline" asChild>
          <Link to="/">Go to trips</Link>
        </Button>
      </div>
    </div>
  )
}
