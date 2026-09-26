import { EyeOff, ExternalLink, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Quote } from '@/lib/api/flights'
import { timeAgo } from '@/lib/format'
import { formatDuration, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { quoteDates, stopsText } from './route-text'
import { SourceTag } from './source-tag'

type Props = { quotes: Quote[]; currency: string; onHide: (quote: Quote) => void; dimmed?: boolean }

function Price({ quote, currency }: { quote: Quote; currency: string }) {
  const total = quote.price_home ?? quote.price_total
  const shown = quote.price_home ? quote.home_currency : quote.currency
  return (
    <>
      <span className="type-data text-base font-bold">{formatMoney(total, shown || currency)}</span>
      <span className="type-data block text-xs text-ink-soft">
        {formatMoney(Number(total) / quote.passengers, shown || currency)} each
      </span>
    </>
  )
}

function SuspectNote() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-warning" title="Much cheaper or pricier than recent prices for this route. Check the source before trusting it.">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      Unusual price
    </span>
  )
}

/** Latest price per itinerary, cheapest first. Doubles as the table view for the charts. */
export function BestOptions({ quotes, currency, onHide, dimmed }: Props) {
  if (quotes.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-ink-soft">No prices in the last 7 days yet.</p>
  }
  return (
    <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
      {/* Phones: a list. */}
      <ul className="divide-y rounded-xl border bg-card md:hidden">
        {quotes.map((q) => (
          <li key={q.id} className="flex items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-0.5">
              <p className="type-code text-sm">
                {q.origin} → {q.destination}
              </p>
              <p className="text-sm">{quoteDates(q)}</p>
              <p className="text-xs text-ink-soft">
                {q.airlines.join(', ') || 'Airline unknown'} · {stopsText(q.stops_out)} · {timeAgo(q.observed_at)}
              </p>
              <SourceTag source={q.source} />
              {q.suspect && <SuspectNote />}
            </div>
            <div className="shrink-0 text-right">
              <Price quote={q} currency={currency} />
              {q.booking_url && (
                <a href={q.booking_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand">
                  View <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Wider screens: a table. */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Cheapest flight prices, lowest first</caption>
          <thead>
            <tr className="border-b text-left text-xs text-ink-soft">
              <th scope="col" className="px-4 py-2.5 font-semibold">Price</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Flight</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Dates</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Airline</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Stops</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Duration</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Source</th>
              <th scope="col" className="px-3 py-2.5 font-semibold">Seen</th>
              <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {quotes.map((q) => (
              <tr key={q.id} className="align-top hover:bg-accent/40">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Price quote={q} currency={currency} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="type-code">{q.origin} → {q.destination}</span>
                  {q.depart_at_local && <span className="type-data block text-xs text-ink-soft">{q.depart_at_local.slice(11)}</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{quoteDates(q)}</td>
                <td className="px-3 py-3">
                  {q.airlines.join(', ') || '—'}
                  {q.suspect && <span className="block"><SuspectNote /></span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{stopsText(q.stops_out)}</td>
                <td className="type-data px-3 py-3 whitespace-nowrap">{formatDuration(q.duration_out_min)}</td>
                <td className="px-3 py-3 whitespace-nowrap"><SourceTag source={q.source} /></td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-soft">{timeAgo(q.observed_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  {q.booking_url && (
                    <Button asChild variant="ghost" size="icon-sm" aria-label="View these flights">
                      <a href={q.booking_url} target="_blank" rel="noreferrer">
                        <ExternalLink aria-hidden="true" />
                      </a>
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" aria-label="Hide this price" onClick={() => onHide(q)}>
                    <EyeOff aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
