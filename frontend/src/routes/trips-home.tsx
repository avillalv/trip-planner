import { Guilloche } from '@/components/brand/guilloche'
import { SetupChecklist } from './setup-checklist'

export function TripsHome() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-10 md:py-12">
      <header>
        <h1 className="type-title">Trips</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Each trip gets its own flight tracker, day-by-day plan, and shortlist of places to stay.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-labelledby="no-trips-heading"
          className="flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-10 text-center md:px-10"
        >
          <Guilloche seed="first-trip" animate className="size-56 md:size-64" />
          <h2 id="no-trips-heading" className="type-heading mt-6 text-2xl">
            No trips yet
          </h2>
          <p className="mt-2 max-w-sm text-ink-soft">
            Trips you create will appear here. Each one gets its own pattern, like a page in a passport.
          </p>
        </section>

        <section aria-labelledby="setup-heading" className="rounded-xl border bg-card p-6">
          <h2 id="setup-heading" className="type-heading mb-4">
            Setup
          </h2>
          <SetupChecklist />
        </section>
      </div>
    </div>
  )
}
