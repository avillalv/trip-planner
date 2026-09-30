import { ArrowDown, ArrowUp, ArrowUpDown, Check, EyeOff, ExternalLink, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { flightKey, type Quote } from '@/lib/api/flights'
import { timeAgo } from '@/lib/format'
import { formatDuration, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { OptionFilters } from './options-filters'
import {
  currencyOf,
  DEFAULT_SORT,
  FIRST_DIR,
  filterOptions,
  nightsOf,
  NO_FILTERS,
  perNight,
  priceOf,
  sortOptions,
  type Filters,
  type Sort,
  type SortKey,
} from './options-view'
import { flightNumbersText, layoverText, quoteDateRange, quoteDates, stopsText } from './route-text'
import { SourceTag } from './source-tag'

type Props = {
  quotes: Quote[]
  currency: string
  onHide: (quote: Quote) => void
  /** Flights chosen for the trip (see flightKey), marked instead of offering Choose. */
  chosen?: Set<string>
  onChoose?: (quote: Quote) => void
  dimmed?: boolean
}

/** Columns in table (and phone select) order. Shared so both stay in sync. */
const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'price', label: 'Price' },
  { key: 'perNight', label: 'Per night' },
  { key: 'flight', label: 'Flight' },
  { key: 'dates', label: 'Dates' },
  { key: 'nights', label: 'Nights' },
  { key: 'airline', label: 'Airline' },
  { key: 'stops', label: 'Stops' },
  { key: 'duration', label: 'Duration' },
  { key: 'source', label: 'Source' },
  { key: 'seen', label: 'Seen' },
]

function captionFor(sort: Sort): string {
  const label = COLUMNS.find((c) => c.key === sort.key)?.label ?? sort.key
  return `Flight prices, sorted by ${label.toLowerCase()}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}`
}

function Price({ quote, currency }: { quote: Quote; currency: string }) {
  const total = priceOf(quote)
  const shown = currencyOf(quote, currency)
  return (
    <>
      <span className="type-data text-base font-bold">{formatMoney(total, shown)}</span>
      <span className="type-data block text-xs text-ink-soft">{formatMoney(total / quote.passengers, shown)} each</span>
    </>
  )
}

/** Flight numbers and layovers, so connections that share a first flight can be told apart. */
function Connection({ quote }: { quote: Quote }) {
  const numbers = flightNumbersText(quote)
  const layover = layoverText(quote.layovers)
  return (
    <>
      {numbers && <span className="type-data block max-w-44 text-xs whitespace-normal text-ink-soft">{numbers}</span>}
      {layover && <span className="block max-w-44 text-xs whitespace-normal text-ink-soft">{layover}</span>}
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

function YourFlight() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-brand">
      <Check className="size-3" aria-hidden="true" />
      Your flight
    </span>
  )
}

function ChooseButton({ quote, onChoose }: { quote: Quote; onChoose: (quote: Quote) => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      title="Use this flight's dates for the trip"
      aria-label={`Choose the ${quoteDates(quote)} flight`}
      onClick={() => onChoose(quote)}
    >
      Choose
    </Button>
  )
}

function SortHeader({
  column,
  sort,
  onSort,
  className,
  title,
}: {
  column: { key: SortKey; label: string }
  sort: Sort
  onSort: (key: SortKey) => void
  className?: string
  title?: string
}) {
  const active = sort.key === column.key
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th
      scope="col"
      className={cn('py-2.5 font-semibold whitespace-nowrap', className)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" title={title} onClick={() => onSort(column.key)} className="inline-flex items-center gap-1 hover:text-foreground">
        {column.label}
        <Icon aria-hidden="true" className={cn('size-3.5', !active && 'opacity-40')} />
      </button>
    </th>
  )
}

/** Latest price per itinerary, sortable and filterable. Doubles as the table view for the charts. */
export function BestOptions({ quotes, currency, onHide, chosen, onChoose, dimmed }: Props) {
  const isChosen = (q: Quote) => chosen?.has(flightKey(q)) ?? false
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [visible, setVisible] = useState(25)

  const matching = useMemo(() => filterOptions(quotes, filters), [quotes, filters])
  const sorted = useMemo(() => sortOptions(matching, sort), [matching, sort])
  const shown = sorted.slice(0, visible)

  const handleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: FIRST_DIR[key] }))

  if (quotes.length === 0) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-ink-soft">No prices in the last 7 days yet.</p>
  }

  return (
    <div className={cn('transition-opacity', dimmed && 'opacity-60')}>
      <OptionFilters quotes={quotes} filters={filters} onChange={setFilters} matching={matching.length} currency={currency} />

      {/* Phones: sort controls (the table's headers do this on wider screens). */}
      <div className="mt-3 flex items-center gap-2 md:hidden">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">Sort by</span>
          <select
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as SortKey
              setSort({ key, dir: FIRST_DIR[key] })
            }}
            className="h-8 rounded-lg border border-input bg-card px-2 text-sm"
          >
            {COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Reverse the order"
          onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
        >
          {sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
        </Button>
      </div>

      {matching.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed p-6 text-center">
          <p className="text-ink-soft">No flights match these filters.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* Phones: a list. */}
          <ul className="mt-3 divide-y rounded-xl border bg-card md:hidden">
            {shown.map((q) => (
              <li key={q.id} className={cn('flex items-start justify-between gap-3 p-4', isChosen(q) && 'bg-brand-soft/40')}>
                <div className="min-w-0 space-y-0.5">
                  <p className="type-code text-sm">
                    {q.origin} → {q.destination}
                  </p>
                  <p className="text-sm">{quoteDates(q)}</p>
                  <p className="text-xs text-ink-soft">
                    {q.airlines.join(', ') || 'Airline unknown'} · {stopsText(q.stops_out)} · {timeAgo(q.observed_at)}
                  </p>
                  <Connection quote={q} />
                  <SourceTag source={q.source} />
                  {q.suspect && <SuspectNote />}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  <Price quote={q} currency={currency} />
                  {perNight(q) !== null && (
                    <span className="type-data text-xs text-ink-soft">{formatMoney(perNight(q), currencyOf(q, currency))} a night</span>
                  )}
                  {isChosen(q) ? <YourFlight /> : onChoose && <ChooseButton quote={q} onChoose={onChoose} />}
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
          {/* relative: keeps the sr-only header text inside this scroll box, not past the page's edge. */}
          <div className="relative mt-3 hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{captionFor(sort)}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-ink-soft">
                  {COLUMNS.map((c) => (
                    <SortHeader
                      key={c.key}
                      column={c}
                      sort={sort}
                      onSort={handleSort}
                      className={c.key === 'price' ? 'px-4' : 'px-3'}
                      title={c.key === 'perNight' ? "The price divided by the nights you'd stay" : undefined}
                    />
                  ))}
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((q) => (
                  <tr key={q.id} className={cn('align-top hover:bg-accent/40', isChosen(q) && 'bg-brand-soft/40')}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Price quote={q} currency={currency} />
                    </td>
                    <td className="type-data px-3 py-3 whitespace-nowrap">{formatMoney(perNight(q), currencyOf(q, currency))}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="type-code">
                        {q.origin} → {q.destination}
                      </span>
                      {q.depart_at_local && <span className="type-data block text-xs text-ink-soft">{q.depart_at_local.slice(11)}</span>}
                      <Connection quote={q} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{quoteDateRange(q)}</td>
                    <td className="type-data px-3 py-3 whitespace-nowrap">{nightsOf(q) ?? '—'}</td>
                    <td className="px-3 py-3">
                      {q.airlines.join(', ') || '—'}
                      {q.suspect && (
                        <span className="block">
                          <SuspectNote />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{stopsText(q.stops_out)}</td>
                    <td className="type-data px-3 py-3 whitespace-nowrap">{formatDuration(q.duration_out_min)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <SourceTag source={q.source} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-soft">{timeAgo(q.observed_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {isChosen(q) ? (
                        <span className="mr-1 align-middle">
                          <YourFlight />
                        </span>
                      ) : (
                        onChoose && (
                          <span className="mr-1">
                            <ChooseButton quote={q} onChoose={onChoose} />
                          </span>
                        )
                      )}
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
        </>
      )}

      {sorted.length > visible && (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + 25)}>
            Show {Math.min(25, sorted.length - visible)} more
          </Button>
        </div>
      )}
    </div>
  )
}
