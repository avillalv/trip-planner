import { Link } from 'react-router'
import { Guilloche } from '@/components/brand/guilloche'
import { CountryTag } from '@/components/common/country-tag'
import { AvatarStack } from '@/components/people/person-avatar'
import type { Trip } from '@/lib/api/trips'
import { formatDateRange, timingLabel, tripLengthDays, tripTiming } from '@/lib/dates'
import { tripSeed } from '@/lib/trip-display'
import { TripStatusBadge } from './trip-status'

export function TripCard({ trip }: { trip: Trip }) {
  const dated = trip.start_date && trip.end_date
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card outline-offset-2 transition-shadow hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
        {trip.cover ? (
          <img
            src={trip.cover.image_url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <Guilloche
            seed={tripSeed(trip)}
            className="absolute top-1/2 left-1/2 size-[80%] -translate-x-1/2 -translate-y-1/2"
          />
        )}
        <TripStatusBadge status={trip.status} className="absolute top-3 left-3 shadow-sm" />
      </div>

      <div className="relative isolate flex flex-1 flex-col gap-1.5 overflow-hidden p-4">
        {/* Each trip's own pattern, as a watermark under the details. */}
        <Guilloche
          seed={tripSeed(trip)}
          className="pointer-events-none absolute -right-12 -bottom-14 -z-10 size-40 opacity-20"
        />
        <h2 className="type-heading text-lg leading-tight">{trip.name}</h2>
        {trip.destinations.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            {trip.destinations.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1">
                <CountryTag code={d.country_code} />
                {d.name}
              </span>
            ))}
          </p>
        )}
        <p className="type-data text-sm text-ink-soft">
          {dated ? (
            <>
              {formatDateRange(trip.start_date!, trip.end_date!)} · {tripLengthDays(trip.start_date!, trip.end_date!)} days
            </>
          ) : (
            'Dates not set'
          )}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <AvatarStack people={trip.travelers} />
          {dated && (
            <span className="text-sm font-semibold">{timingLabel(tripTiming(trip.start_date!, trip.end_date!))}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
