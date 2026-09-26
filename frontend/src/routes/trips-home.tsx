import { Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Guilloche } from '@/components/brand/guilloche'
import { TripCard } from '@/components/trips/trip-card'
import { TripEditor } from '@/components/trips/trip-editor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemStatus, type SystemStatus } from '@/lib/api/system'
import { useTrips } from '@/lib/api/trips'

function unfinishedSetup(status: SystemStatus): string[] {
  const missing: string[] = []
  if (status.database !== 'ok') missing.push('database')
  if (status.worker.status !== 'ok') missing.push('background worker')
  if (!status.claude.found) missing.push('Claude Code')
  if (!status.integrations.geoapify) missing.push('Geoapify')
  if (!status.integrations.serpapi) missing.push('SerpApi')
  if (!status.integrations.travelpayouts) missing.push('Travelpayouts')
  if (!status.integrations.wikimedia) missing.push('Wikipedia contact')
  return missing
}

function SetupNotice() {
  const status = useSystemStatus()
  if (!status.data) return null
  const missing = unfinishedSetup(status.data)
  if (missing.length === 0) return null
  return (
    <p className="mt-6 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Not set up yet: {missing.join(', ')}.{' '}
        <Link to="/settings" className="font-semibold underline underline-offset-2">
          Review in Settings
        </Link>
      </span>
    </p>
  )
}

export function TripsHome() {
  const trips = useTrips()
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const all = trips.data ?? []
  const active = all.filter((t) => t.status !== 'archived')
  const archived = all.filter((t) => t.status === 'archived')

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-10 md:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Trips</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Each trip gets its own flight tracker, day-by-day plan, and shortlist of places to stay.
          </p>
        </div>
        {all.length > 0 && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New trip
          </Button>
        )}
      </header>

      <SetupNotice />

      {trips.isPending ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : trips.isError ? (
        <p role="alert" className="mt-8 text-destructive">
          Couldn't load trips: {trips.error.message}
        </p>
      ) : all.length === 0 ? (
        <section className="mt-8 flex flex-col items-center rounded-xl border bg-card px-6 py-12 text-center">
          <Guilloche seed="first-trip" animate className="size-56" />
          <h2 className="type-heading mt-6 text-2xl">No trips yet</h2>
          <p className="mt-2 max-w-sm text-ink-soft">
            Start with where you want to go. Dates and travelers can come later.
          </p>
          <Button className="mt-6" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Plan a trip
          </Button>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
          {archived.length > 0 && (
            <section className="mt-10">
              <Button variant="ghost" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
                {showArchived ? 'Hide' : 'Show'} archived trips ({archived.length})
              </Button>
              {showArchived && (
                <div className="mt-4 grid gap-6 opacity-80 sm:grid-cols-2 xl:grid-cols-3">
                  {archived.map((trip) => (
                    <TripCard key={trip.id} trip={trip} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <TripEditor open={creating} onOpenChange={setCreating} />
    </div>
  )
}
