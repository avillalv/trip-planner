import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isStaleBuild } from '@/lib/errors'
import { cn } from '@/lib/utils'

type Props = { fallback: (error: Error) => ReactNode; children: ReactNode }
type State = { error: Error | null }

/** Keeps one failing part of a page (a map, the calendar) from taking the whole page down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children
  }
}

/** What to show in place of a part that failed: what happened, and what to do about it. */
export function PartFailed({ what, error, className }: { what: string; error: Error; className?: string }) {
  let title = `The ${what} couldn’t be shown`
  let hint = `${error.message} The rest of the page still works.`
  if (isStaleBuild(error)) {
    title = 'Trip Planner was updated'
    hint = 'Reload the page to get the new version.'
  } else if (/webgl/i.test(error.message)) {
    hint = 'Maps need WebGL, which is turned off or unavailable in this browser. The rest of the page still works.'
  }
  return (
    <div
      role="alert"
      className={cn('grid h-full place-items-center rounded-xl border border-dashed p-4 text-center text-sm', className)}
    >
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-ink-soft">{hint}</p>
      </div>
    </div>
  )
}
