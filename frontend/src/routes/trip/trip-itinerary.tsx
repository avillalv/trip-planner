import { CalendarDays, Plus } from 'lucide-react'
import { useState } from 'react'
import { ActivityEditor } from '@/components/itinerary/activity-editor'
import { AddActivityDialog } from '@/components/itinerary/add-activity-dialog'
import { DayCard } from '@/components/itinerary/day-card'
import { IdeasPanel } from '@/components/itinerary/ideas-panel'
import { searchCenter } from '@/components/itinerary/search-center'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useActivities, useDays, type Activity } from '@/lib/api/itinerary'
import { formatDateRange } from '@/lib/dates'
import { useTripContext } from './trip-context'

export function TripItinerary() {
  const { trip, editTrip } = useTripContext()
  const days = useDays(trip.id)
  const activities = useActivities(trip.id)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Activity | null>(null)
  const ideas = (activities.data ?? []).filter((a) => a.day === null)
  const inTrip = (days.data ?? []).filter((d) => d.in_trip)
  const home = trip.destinations[0]

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:px-10 md:py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="days-heading" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="days-heading" className="type-heading">
              Day by day
            </h2>
            {trip.start_date && trip.end_date && (
              <p className="text-sm text-ink-soft">
                {formatDateRange(trip.start_date, trip.end_date)} · {inTrip.length} days
              </p>
            )}
          </div>
        </div>

        {days.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (days.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <CalendarDays className="mx-auto size-6 text-ink-soft" aria-hidden="true" />
            <p className="mt-2 font-semibold">Add the trip's dates to plan it day by day</p>
            <p className="mt-1 text-sm text-ink-soft">You can still save ideas while the dates are open.</p>
            <Button variant="outline" className="mt-4" onClick={editTrip}>
              Set dates
            </Button>
          </div>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2">
            {days.data!.map((day) => (
              <DayCard
                key={day.day}
                day={day}
                number={day.in_trip ? inTrip.findIndex((d) => d.day === day.day) + 1 : null}
                to={day.day}
              />
            ))}
          </ol>
        )}
      </section>

      <aside className="space-y-4">
        <IdeasPanel ideas={ideas} onOpen={setEditing} onAdd={() => setAdding(true)} />
        {ideas.length === 0 && (
          <Button className="w-full" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Find things to do
          </Button>
        )}
      </aside>

      <AddActivityDialog
        open={adding}
        onOpenChange={setAdding}
        tripId={trip.id}
        days={days.data ?? []}
        center={home ? searchCenter(home) : null}
        initial={{}}
      />
      <ActivityEditor tripId={trip.id} days={days.data ?? []} activity={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
