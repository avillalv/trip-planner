import type { DateGridCell, FlightRoute } from '@/lib/api/flights'
import { daysBetween, parseDate, toISODate } from '@/lib/dates'
import { timeAgo } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { seriesFor } from '@/lib/price-sources'
import { cn } from '@/lib/utils'
import { priceStep } from './price-step'
import { formatShortDate } from './route-text'

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  const day = parseDate(from)
  const end = parseDate(to)
  while (day <= end && out.length < 62) {
    out.push(toISODate(day))
    day.setDate(day.getDate() + 1)
  }
  return out
}

type Column = { key: string; label: string; returnFor: (depart: string) => string | null }

function columnsFor(route: FlightRoute): Column[] {
  if (route.trip_type === 'one_way') return [{ key: 'one-way', label: 'One way', returnFor: () => null }]
  if (route.min_nights && route.max_nights) {
    return Array.from({ length: route.max_nights - route.min_nights + 1 }, (_, i) => {
      const nights = route.min_nights! + i
      return {
        key: `n${nights}`,
        label: `${nights} night${nights === 1 ? '' : 's'}`,
        returnFor: (depart: string) => {
          const d = parseDate(depart)
          d.setDate(d.getDate() + nights)
          return toISODate(d)
        },
      }
    })
  }
  return datesBetween(route.return_from!, route.return_to!).map((ret) => ({
    key: ret,
    label: `Back ${formatShortDate(ret)}`,
    returnFor: (depart: string) => (ret > depart ? ret : null),
  }))
}

type Props = {
  route: FlightRoute
  cells: DateGridCell[]
  currency: string
  /** The dates of the flight chosen for the trip, outlined. */
  chosen?: { depart_date: string; return_date: string | null } | null
  /** Choosing a cell makes its fare the trip's flight. */
  onChoose?: (cell: DateGridCell) => void
}

/**
 * Cheapest recent price for each departure × trip length. Every value is printed, so this is also a
 * table; each price is a button that makes its fare the trip's flight.
 */
export function DateGrid({ route, cells, currency, chosen = null, onChoose }: Props) {
  const today = toISODate(new Date())
  const departures = datesBetween(route.depart_from > today ? route.depart_from : today, route.depart_to)
  const columns = columnsFor(route)
  const byPair = new Map(cells.map((c) => [`${c.depart_date}|${c.return_date ?? ''}`, c]))
  const prices = cells.map((c) => Number(c.price)).sort((a, b) => a - b)
  const cheapest = prices[0]

  if (departures.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-soft">The departure window has passed.</p>
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">Cheapest price by departure date and trip length</caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-semibold text-ink-soft">Leave</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-1 text-center font-semibold whitespace-nowrap text-ink-soft">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {departures.map((depart) => (
              <tr key={depart}>
                <th scope="row" className="px-2 py-1 text-left font-normal whitespace-nowrap">
                  <span className="text-ink-soft">{weekday.format(parseDate(depart))}</span> {formatShortDate(depart)}
                </th>
                {columns.map((column) => {
                  const ret = column.returnFor(depart)
                  const cell = ret === null && route.trip_type !== 'one_way' ? undefined : byPair.get(`${depart}|${ret ?? ''}`)
                  if (!cell) {
                    return (
                      <td key={column.key} className="h-8 min-w-16 rounded-sm bg-muted text-center text-ink-soft/70">
                        <span aria-label="No price yet">·</span>
                      </td>
                    )
                  }
                  const price = Number(cell.price)
                  const step = priceStep(price, prices)
                  const isCheapest = price === cheapest
                  const isChosen = chosen !== null && chosen.depart_date === depart && (chosen.return_date ?? null) === ret
                  const nights = ret ? daysBetween(parseDate(depart), parseDate(ret)) : null
                  const description = `${formatShortDate(depart)}${ret ? ` to ${formatShortDate(ret)} (${nights} nights)` : ''}: ${formatMoney(price, currency)} from ${seriesFor(cell.source).label}, ${timeAgo(cell.observed_at)}`
                  const label = `${isChosen ? 'Your flight. ' : isCheapest ? 'Cheapest. ' : ''}${description}`
                  const look = cn(
                    'type-data h-8 w-full min-w-16 rounded-sm px-2 text-center font-semibold outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring',
                    isCheapest && 'ring-2 ring-foreground ring-inset',
                    isChosen && 'ring-3 ring-brand ring-inset',
                  )
                  const heat = { backgroundColor: `var(--heat-${step})`, color: `var(--heat-ink-${step})` }
                  const text = formatMoney(price, currency, price >= 10_000)
                  return onChoose ? (
                    <td key={column.key} className="p-0">
                      <button
                        type="button"
                        title={`${description}. Choose these dates for the trip.`}
                        aria-label={`${label}. Choose these dates for the trip.`}
                        onClick={() => onChoose(cell)}
                        className={cn(look, 'cursor-pointer hover:brightness-95')}
                        style={heat}
                      >
                        {text}
                      </button>
                    </td>
                  ) : (
                    <td key={column.key} tabIndex={0} title={description} aria-label={label} className={look} style={heat}>
                      {text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          Cheaper
          {[5, 4, 3, 2, 1].map((step) => (
            <span key={step} className="inline-block h-3 w-5 rounded-sm" style={{ backgroundColor: `var(--heat-${step})` }} aria-hidden="true" />
          ))}
          Pricier
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm ring-2 ring-foreground ring-inset" aria-hidden="true" />
          Cheapest
        </span>
        {chosen && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-sm ring-3 ring-brand ring-inset" aria-hidden="true" />
            Your flight
          </span>
        )}
        {onChoose && <span>Pick a price to use its dates for the trip.</span>}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-5 rounded-sm bg-muted" aria-hidden="true" />
          Not checked yet
        </span>
      </div>
    </div>
  )
}
