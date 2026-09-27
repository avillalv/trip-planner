import { useId } from 'react'
import { Button } from '@/components/ui/button'
import type { Quote } from '@/lib/api/flights'
import { parseDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  cheapestByNights,
  currencyOf,
  filterChoices,
  filterOptions,
  hasFilters,
  NO_FILTERS,
  priceOf,
  type Filters,
} from './options-view'

const selectClass = 'h-8 rounded-lg border border-input bg-card px-2 text-sm'
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

function formatDay(iso: string): string {
  return dayFormat.format(parseDate(iso))
}

/** Keeps a value the caller picked earlier in a select's list, even once it drops out of `choices`. */
function withSelected<T>(choices: T[], selected: T | null): T[] {
  return selected !== null && !choices.includes(selected) ? [...choices, selected] : choices
}

type Props = {
  quotes: Quote[]
  filters: Filters
  onChange: (filters: Filters) => void
  matching: number
  currency: string
}

/** The filter row above the flights table, plus the "cheapest by trip length" strip below it. */
export function OptionFilters({ quotes, filters, onChange, matching, currency }: Props) {
  const stripLabelId = useId()
  const choices = filterChoices(quotes)
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value })

  const minChoices = withSelected(
    choices.nights.filter((n) => filters.maxNights === null || n <= filters.maxNights),
    filters.minNights,
  )
  const maxChoices = withSelected(
    choices.nights.filter((n) => filters.minNights === null || n >= filters.minNights),
    filters.maxNights,
  )
  const departChoices = withSelected(choices.departs, filters.leaveFrom)
  const returnChoices = withSelected(choices.returns, filters.backBy)
  const airlineChoices = withSelected(choices.airlines, filters.airline)

  const noun = quotes.length === 1 ? 'flight' : 'flights'
  const countLabel = hasFilters(filters) ? `${matching} of ${quotes.length} ${noun}` : `${quotes.length} ${noun}`

  const cheapest = cheapestByNights(filterOptions(quotes, { ...filters, minNights: null, maxNights: null }))

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filter flights" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {choices.nights.length >= 2 && (
          <span className="flex items-center gap-2">
            <span className="text-ink-soft">Nights</span>
            <select
              aria-label="Fewest nights"
              value={filters.minNights ?? ''}
              onChange={(e) => set('minNights', e.target.value ? Number(e.target.value) : null)}
              className={selectClass}
            >
              <option value="">Any</option>
              {minChoices.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-ink-soft">to</span>
            <select
              aria-label="Most nights"
              value={filters.maxNights ?? ''}
              onChange={(e) => set('maxNights', e.target.value ? Number(e.target.value) : null)}
              className={selectClass}
            >
              <option value="">Any</option>
              {maxChoices.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
        )}

        {choices.departs.length >= 2 && (
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Leave from</span>
            <select
              value={filters.leaveFrom ?? ''}
              onChange={(e) => set('leaveFrom', e.target.value || null)}
              className={selectClass}
            >
              <option value="">Any day</option>
              {departChoices.map((d) => (
                <option key={d} value={d}>
                  {formatDay(d)}
                </option>
              ))}
            </select>
          </label>
        )}

        {choices.returns.length >= 2 && (
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Back by</span>
            <select value={filters.backBy ?? ''} onChange={(e) => set('backBy', e.target.value || null)} className={selectClass}>
              <option value="">Any day</option>
              {returnChoices.map((d) => (
                <option key={d} value={d}>
                  {formatDay(d)}
                </option>
              ))}
            </select>
          </label>
        )}

        {choices.stops.length >= 2 && (
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Stops</span>
            <select
              value={filters.maxStops ?? ''}
              onChange={(e) => set('maxStops', e.target.value === '' ? null : Number(e.target.value))}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="0">Nonstop only</option>
              <option value="1">1 stop at most</option>
            </select>
          </label>
        )}

        {choices.airlines.length >= 2 && (
          <label className="flex items-center gap-2">
            <span className="text-ink-soft">Airline</span>
            <select value={filters.airline ?? ''} onChange={(e) => set('airline', e.target.value || null)} className={selectClass}>
              <option value="">Any</option>
              {airlineChoices.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}

        <span className="flex items-center gap-2">
          <span aria-live="polite" className="text-ink-soft">
            {countLabel}
          </span>
          {hasFilters(filters) && (
            <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </span>
      </div>

      {cheapest.length >= 2 && (
        <div>
          <p id={stripLabelId} className="text-xs font-semibold text-ink-soft">
            Cheapest by trip length
          </p>
          <div role="group" aria-labelledby={stripLabelId} className="flex gap-2 overflow-x-auto pb-1">
            {cheapest.map(({ nights, quote }) => {
              const active = filters.minNights === nights && filters.maxNights === nights
              return (
                <button
                  key={nights}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChange(active ? { ...filters, minNights: null, maxNights: null } : { ...filters, minNights: nights, maxNights: nights })
                  }
                  className={cn(
                    'shrink-0 rounded-lg border px-3 py-1.5 text-left',
                    active ? 'border-brand bg-brand-soft text-brand' : 'hover:bg-accent',
                  )}
                >
                  <span className="block text-sm">
                    {nights} night{nights === 1 ? '' : 's'}
                  </span>
                  <span className="type-data block font-semibold">{formatMoney(priceOf(quote), currencyOf(quote, currency))}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
