import { ExternalLink, MoreHorizontal, Plane } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FlightRoute, RouteSummary } from '@/lib/api/flights'
import { timeAgo } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { quoteDates, routeDescription, stopsText } from './route-text'
import { SourceTag } from './source-tag'

type Props = {
  route: FlightRoute
  summary?: RouteSummary
  currency: string
  onEdit: () => void
  onCheck: () => void
  onToggleActive: () => void
  onDelete: () => void
}

export function RouteCard({ route, summary, currency, onEdit, onCheck, onToggleActive, onDelete }: Props) {
  const cheapest = summary?.cheapest ?? null
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
            <DropdownMenuItem onSelect={onToggleActive}>{route.active ? 'Pause checks' : 'Resume checks'}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete route
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        {cheapest ? (
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
        {cheapest?.booking_url && (
          <Button asChild variant="outline" size="sm">
            <a href={cheapest.booking_url} target="_blank" rel="noreferrer">
              View flights
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        )}
      </div>
      {!route.active && (
        <p className="mt-4 rounded-md bg-muted px-3 py-1.5 text-xs text-ink-soft">Paused: scheduled checks skip this route.</p>
      )}
    </article>
  )
}
