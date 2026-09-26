import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { Guilloche } from '@/components/brand/guilloche'
import { CountryTag } from '@/components/common/country-tag'
import { tripSections } from '@/components/layout/nav-config'
import { AvatarStack } from '@/components/people/person-avatar'
import { TripEditor } from '@/components/trips/trip-editor'
import { TripStatusBadge } from '@/components/trips/trip-status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTrip, type Trip } from '@/lib/api/trips'
import { formatDateRange, timingLabel, tripLengthDays, tripTiming } from '@/lib/dates'
import { rememberTrip } from '@/lib/last-trip'
import { tripSeed } from '@/lib/trip-display'
import { cn } from '@/lib/utils'
import type { TripOutletContext } from './trip-context'

function TripHeader({ trip, onEdit }: { trip: Trip; onEdit: () => void }) {
  const dated = trip.start_date && trip.end_date
  return (
    <header className="relative isolate overflow-hidden border-b bg-card">
      <Guilloche
        variant="band"
        seed={tripSeed(trip)}
        className="absolute inset-y-0 right-0 -z-10 h-full w-1/2 opacity-35 [mask-image:linear-gradient(to_right,transparent,black_65%)] md:w-3/4 md:opacity-60"
      />
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-4 px-4 py-6 md:px-10 md:py-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TripStatusBadge status={trip.status} />
            {dated && (
              <span className="text-sm font-semibold text-ink-soft">
                {timingLabel(tripTiming(trip.start_date!, trip.end_date!))}
              </span>
            )}
          </div>
          <h1 className="type-title mt-2 break-words">{trip.name}</h1>
          <p className="type-data mt-1 text-sm text-ink-soft">
            {dated
              ? `${formatDateRange(trip.start_date!, trip.end_date!)} · ${tripLengthDays(trip.start_date!, trip.end_date!)} days`
              : 'Dates not set'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {trip.destinations.length > 0 && (
              <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-label="Destinations">
                {trip.destinations.map((d) => (
                  <li key={d.id} className="inline-flex items-center gap-1">
                    <CountryTag code={d.country_code} />
                    {d.name}
                  </li>
                ))}
              </ul>
            )}
            <AvatarStack people={trip.travelers} size="md" />
          </div>
        </div>
        <Button variant="outline" onClick={onEdit} className="bg-card">
          <Pencil aria-hidden="true" />
          Edit trip
        </Button>
      </div>
    </header>
  )
}

/** On phones the sections sit under the header instead of in the menu. */
function SectionTabs({ tripId }: { tripId: number }) {
  return (
    <nav aria-label="Trip sections" className="sticky top-[57px] z-20 border-b bg-background/95 backdrop-blur md:hidden">
      <ul className="flex overflow-x-auto px-2">
        {tripSections.map((section) => (
          <li key={section.label}>
            <NavLink
              to={`/trips/${tripId}${section.to ? `/${section.to}` : ''}`}
              end={section.to === ''}
              className={({ isActive }) =>
                cn(
                  'block border-b-2 px-3 py-3 text-sm whitespace-nowrap',
                  isActive ? 'border-brand font-semibold text-foreground' : 'border-transparent text-ink-soft',
                )
              }
            >
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function TripLayout() {
  const tripId = Number(useParams().tripId)
  const trip = useTrip(tripId)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (trip.data) rememberTrip(trip.data.id)
  }, [trip.data])

  if (trip.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 px-4 py-8 md:px-10">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
      </div>
    )
  }
  if (trip.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 md:px-10">
        <h1 className="type-title">This trip isn't available</h1>
        <p className="mt-3 text-ink-soft">{trip.error.message}</p>
        <Button asChild className="mt-6">
          <Link to="/">Go to trips</Link>
        </Button>
      </div>
    )
  }

  const context: TripOutletContext = { trip: trip.data, editTrip: () => setEditing(true) }
  return (
    <>
      <TripHeader trip={trip.data} onEdit={context.editTrip} />
      <SectionTabs tripId={trip.data.id} />
      <Outlet context={context} />
      <TripEditor open={editing} onOpenChange={setEditing} trip={trip.data} />
    </>
  )
}
