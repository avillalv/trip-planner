import { Clock, ExternalLink, RefreshCw } from 'lucide-react'
import { TripFindings } from '@/components/agents/trip-findings'
import { CountryTag } from '@/components/common/country-tag'
import { PersonAvatar } from '@/components/people/person-avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemStatus } from '@/lib/api/system'
import { useRefreshTripInfo, type Destination, type Trip } from '@/lib/api/trips'
import { currencyOptions } from '@/lib/currencies'
import { formatDateRange, timingLabel, tripLengthDays, tripTiming } from '@/lib/dates'
import { useNow } from '@/lib/hooks'
import { localTime, offsetFromViewer } from '@/lib/timezones'
import { placeLine } from '@/lib/trip-display'
import { useTripContext } from './trip-context'

function CoverPhoto({ cover }: { cover: NonNullable<Trip['cover']> }) {
  const source = cover.image_file
    ? `https://en.wikipedia.org/wiki/File:${encodeURIComponent(cover.image_file)}`
    : cover.wiki_url
  return (
    <figure className="overflow-hidden rounded-xl border bg-card">
      <img src={cover.image_url} alt={cover.destination_name} className="max-h-[22rem] w-full object-cover" />
      <figcaption className="px-4 py-2 text-xs text-ink-soft">
        {cover.destination_name} · Photo from{' '}
        {source ? (
          <a href={source} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Wikipedia
          </a>
        ) : (
          'Wikipedia'
        )}
      </figcaption>
    </figure>
  )
}

function DestinationSummary({ destination }: { destination: Destination }) {
  switch (destination.info_status) {
    case 'pending':
      return (
        <div className="mt-3 space-y-2" aria-label={`Looking up ${destination.name} on Wikipedia`}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )
    case 'ready':
      return (
        <>
          {destination.summary && <p className="mt-3 leading-relaxed">{destination.summary}</p>}
          {destination.wiki_url && (
            <a
              href={destination.wiki_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand underline-offset-2 hover:underline"
            >
              Read more on Wikipedia
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </>
      )
    case 'not_found':
      return <p className="mt-3 text-sm text-ink-soft">Wikipedia has no article matching this place.</p>
    case 'failed':
      return <p className="mt-3 text-sm text-ink-soft">Couldn't reach Wikipedia for a summary.</p>
    case 'skipped':
      return (
        <p className="mt-3 text-sm text-ink-soft">
          Add <code className="type-data">WIKIMEDIA_CONTACT</code> to .env to show a summary and photo.
        </p>
      )
  }
}

function DestinationCard({ destination, now }: { destination: Destination; now: Date }) {
  const place = placeLine(destination)
  return (
    <li className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="type-heading flex items-center gap-2 text-lg">
          <CountryTag code={destination.country_code} />
          {destination.name}
        </h3>
        {destination.timezone && (
          <p className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Clock className="size-3.5" aria-hidden="true" />
            <span className="type-data">{localTime(destination.timezone, now)}</span>
            <span>· {offsetFromViewer(destination.timezone, now)}</span>
          </p>
        )}
      </div>
      {place && <p className="text-sm text-ink-soft">{place}</p>}
      <DestinationSummary destination={destination} />
    </li>
  )
}

function InfoRetry({ trip }: { trip: Trip }) {
  const refresh = useRefreshTripInfo(trip.id)
  const status = useSystemStatus()
  const retryable = trip.destinations.filter(
    (d) => d.info_status === 'failed' || (d.info_status === 'skipped' && status.data?.integrations.wikimedia),
  )
  if (retryable.length === 0) return null
  return (
    <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
      <RefreshCw aria-hidden="true" className={refresh.isPending ? 'animate-spin' : undefined} />
      Fetch summaries and photos
    </Button>
  )
}

function AtAGlance({ trip, now }: { trip: Trip; now: Date }) {
  const dated = trip.start_date && trip.end_date
  const days = dated ? tripLengthDays(trip.start_date!, trip.end_date!) : 0
  const currency = currencyOptions().find((c) => c.code === trip.home_currency)
  return (
    <section aria-labelledby="glance-heading" className="rounded-xl border bg-card p-5">
      <h2 id="glance-heading" className="type-heading">
        At a glance
      </h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="type-label text-ink-soft">Dates</dt>
          <dd className="type-data mt-0.5">
            {dated ? formatDateRange(trip.start_date!, trip.end_date!) : 'Not decided yet'}
          </dd>
          {trip.flight_dates && <dd className="mt-0.5 text-xs text-ink-soft">Set by your flight</dd>}
        </div>
        {dated && (
          <div>
            <dt className="type-label text-ink-soft">Length</dt>
            <dd className="mt-0.5">
              {days} {days === 1 ? 'day' : 'days'} · {days - 1} {days - 1 === 1 ? 'night' : 'nights'} ·{' '}
              {timingLabel(tripTiming(trip.start_date!, trip.end_date!, now))}
            </dd>
          </div>
        )}
        <div>
          <dt className="type-label text-ink-soft">Travelers</dt>
          <dd className="mt-1">
            {trip.travelers.length === 0 ? (
              'No one added yet'
            ) : (
              <ul className="space-y-1.5">
                {trip.travelers.map((person) => (
                  <li key={person.id} className="flex items-center gap-2">
                    <PersonAvatar person={person} size="sm" />
                    {person.name}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="type-label text-ink-soft">Currency</dt>
          <dd className="mt-0.5">
            {trip.home_currency}
            {currency && currency.name !== trip.home_currency && ` — ${currency.name}`}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export function TripOverview() {
  const { trip, editTrip } = useTripContext()
  const now = useNow(30_000)

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:px-10 md:py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {trip.cover && <CoverPhoto cover={trip.cover} />}
        <section aria-labelledby="destinations-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="destinations-heading" className="type-heading">
              Destinations
            </h2>
            <InfoRetry trip={trip} />
          </div>
          {trip.destinations.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-ink-soft">No destinations yet.</p>
              <Button variant="outline" className="mt-3" onClick={editTrip}>
                Add a destination
              </Button>
            </div>
          ) : (
            <ol className="space-y-4">
              {trip.destinations.map((destination) => (
                <DestinationCard key={destination.id} destination={destination} now={now} />
              ))}
            </ol>
          )}
        </section>
        <TripFindings tripId={trip.id} />
      </div>

      <aside className="space-y-6">
        <AtAGlance trip={trip} now={now} />
        {trip.notes && (
          <section aria-labelledby="notes-heading" className="rounded-xl border bg-card p-5">
            <h2 id="notes-heading" className="type-heading">
              Notes
            </h2>
            <p className="mt-3 text-sm whitespace-pre-wrap">{trip.notes}</p>
          </section>
        )}
      </aside>
    </div>
  )
}
