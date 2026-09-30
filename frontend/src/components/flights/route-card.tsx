import { ExternalLink, MoreHorizontal, Plane } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { flightKey, type FlightRoute, type Quote, type QuoteSegment, type RouteSummary } from '@/lib/api/flights'
import { timeAgo } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { quoteDates, routeDescription, segmentTimes, stopsText } from './route-text'
import { SourceTag } from './source-tag'

type Props = {
  route: FlightRoute
  summary?: RouteSummary
  currency: string
  onEdit: () => void
  onCheck: () => void
  onToggleActive: () => void
  onDelete: () => void
  onClearChoice: () => void
  onAddBooked: () => void
}

const total = (q: Quote) => Number(q.price_home ?? q.price_total)

/** A booked flight's legs, as printed on the ticket: flight, airports, and local times. */
function Legs({ segments }: { segments: QuoteSegment[] }) {
  return (
    <div className="mt-2 space-y-2 text-sm">
      {(['out', 'back'] as const).map((direction) => {
        const legs = segments.filter((s) => s.direction === direction)
        return (
          legs.length > 0 && (
            <div key={direction}>
              <p className="type-label text-ink-soft">{direction === 'out' ? 'Outbound' : 'Return'}</p>
              <ul className="mt-1 space-y-0.5">
                {legs.map((s) => (
                  <li key={`${s.flight_number}-${s.depart_at}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="type-data font-semibold">{s.flight_number}</span>
                    <span className="type-code text-xs">
                      {s.origin} → {s.destination}
                    </span>
                    <span className="text-ink-soft">{segmentTimes(s)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        )
      })}
    </div>
  )
}

/** The flight picked for the trip, at its latest price, and how that moved since it was chosen. */
function ChosenFlight({
  latest,
  then,
  cheapest,
  currency,
  onClear,
}: {
  latest: Quote
  then: Quote
  cheapest: Quote | null
  currency: string
  onClear: () => void
}) {
  // A booked flight is a fact, not a price to watch: no change since choosing it, and no "seen" time.
  const booked = latest.source === 'manual'
  const change = total(latest) - total(then)
  return (
    <div>
      <p className="flex items-center gap-2">
        <span className="type-label text-brand">Your flight</span>
        <Button variant="link" size="xs" className="h-auto px-0 text-ink-soft" onClick={onClear}>
          Clear
        </Button>
      </p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{formatMoney(total(latest), latest.home_currency || currency)}</p>
      {!booked && Math.abs(change) >= 1 && (
        <p className={cn('text-sm font-semibold', change < 0 ? 'text-success' : 'text-warning')}>
          {change < 0 ? 'Down' : 'Up'} {formatMoney(Math.abs(change), currency)} since you chose it
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">
        {formatMoney(total(latest) / latest.passengers, currency)} per person · {quoteDates(latest)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
        <span>{latest.airlines.join(', ') || 'Airline unknown'}</span>·<span>{stopsText(latest.stops_out)}</span>·
        <SourceTag source={latest.source} />
        {!booked && <span>· {timeAgo(latest.observed_at)}</span>}
      </p>
      {latest.segments && <Legs segments={latest.segments} />}
      {!booked && cheapest && flightKey(cheapest) !== flightKey(latest) && total(cheapest) < total(latest) && (
        <p className="mt-2 text-sm text-ink-soft">
          Cheapest on any dates:{' '}
          <span className="type-data font-semibold text-foreground">
            {formatMoney(total(cheapest), cheapest.home_currency || currency)}
          </span>{' '}
          · {quoteDates(cheapest)}
        </p>
      )}
    </div>
  )
}

export function RouteCard({ route, summary, currency, onEdit, onCheck, onToggleActive, onDelete, onClearChoice, onAddBooked }: Props) {
  const cheapest = summary?.cheapest ?? null
  const chosen = summary?.chosen ?? null
  const latest = summary?.chosen_latest ?? chosen
  const booking = (latest ?? cheapest)?.booking_url
  const perPerson = cheapest ? Number(cheapest.price_home ?? cheapest.price_total) / cheapest.passengers : null
  return (
    <article className="flex flex-col rounded-xl border bg-card p-5" aria-label={`Route ${route.origin_codes.join(', ')} to ${route.destination_codes.join(', ')}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {route.label && <p className="text-sm font-semibold text-ink-soft">{route.label}</p>}
          <p className="type-code flex flex-wrap items-center gap-2 text-xl">
            {route.origin_codes.join(' · ')}
            <Plane className="size-4 text-ink-soft" aria-label="to" />
            {route.destination_codes.join(' · ')}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{routeDescription(route)}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Route actions">
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCheck} disabled={!route.active}>
              Check prices now
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>Edit route</DropdownMenuItem>
            <DropdownMenuItem onSelect={onAddBooked}>Add booked flight</DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleActive}>{route.active ? 'Pause checks' : 'Resume checks'}</DropdownMenuItem>
            {chosen && <DropdownMenuItem onSelect={onClearChoice}>Clear your flight</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete route
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        {chosen && latest ? (
          <ChosenFlight latest={latest} then={chosen} cheapest={cheapest} currency={currency} onClear={onClearChoice} />
        ) : cheapest ? (
          <div>
            <p className="type-label text-ink-soft">Cheapest now</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">
              {formatMoney(cheapest.price_home ?? cheapest.price_total, cheapest.home_currency || currency)}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {formatMoney(perPerson, currency)} per person · {quoteDates(cheapest)}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
              <span>{cheapest.airlines.join(', ') || 'Airline unknown'}</span>·<span>{stopsText(cheapest.stops_out)}</span>·
              <SourceTag source={cheapest.source} />
              <span>· {timeAgo(cheapest.observed_at)}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            {route.active ? 'No prices yet. The first check runs right after you add a route.' : 'Checks are paused.'}
          </p>
        )}
        {booking && (
          <Button asChild variant="outline" size="sm">
            <a href={booking} target="_blank" rel="noreferrer">
              View flights
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
      {!route.active && (
        <p className="mt-4 rounded-md bg-muted px-3 py-1.5 text-xs text-ink-soft">
          {latest?.source === 'manual' ? 'Booked: price checks for this route are off.' : 'Paused: scheduled checks skip this route.'}
        </p>
      )}
    </article>
  )
}
