import { ArrowRight, Heart, Star } from 'lucide-react'
import { Guilloche } from '@/components/brand/guilloche'
import { SOURCE_DESCRIPTIONS, seriesFor } from '@/lib/price-sources'
import { routeDescription, quoteDates, stopsText } from '@/components/flights/route-text'
import { perPerson } from '@/components/lodging/lodging-meta'
import { PersonAvatar } from '@/components/people/person-avatar'
import { CATEGORY } from '@/lib/activity-meta'
import type { Lodging } from '@/lib/api/lodging'
import type { DeckRoute, Presentation } from '@/lib/api/presentation'
import { formatDateRange, timingLabel, tripLengthDays, tripTiming } from '@/lib/dates'
import { timeAgo } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { formatTimeRange } from '@/lib/itinerary-time'
import { formatMoney } from '@/lib/money'
import { localTime, offsetFromViewer } from '@/lib/timezones'
import { placeLine, tripSeed } from '@/lib/trip-display'
import { STATUS_LABELS } from '@/lib/trip-status'
import { cn } from '@/lib/utils'
import { DeckMap, Fact, SlidePage, Sparkline, Stamp } from './deck-parts'
import { closingFacts, exchangeText, farePrice, formatDayLong, type Slide } from './deck-model'
import { useSlide } from './slide-context'

type Of<K extends Slide['kind']> = Extract<Slide, { kind: K }>
type PageProps<K extends Slide['kind']> = { deck: Presentation; slide: Of<K>; index: number; total: number }

const listFormat = new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' })
const currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' })
const COVER = 'on-cover relative isolate flex h-full overflow-hidden bg-[var(--tp-cover)] text-cover-ink'

function tripDates(trip: Presentation['trip']): string | null {
  if (!trip.start_date || !trip.end_date) return null
  const days = tripLengthDays(trip.start_date, trip.end_date)
  return `${formatDateRange(trip.start_date, trip.end_date)} · ${days} ${days === 1 ? 'day' : 'days'}`
}

function TitleSlide({ deck }: { deck: Presentation }) {
  const { trip } = deck
  const { live } = useSlide()
  const dates = tripDates(trip)
  const timing = trip.start_date && trip.end_date ? timingLabel(tripTiming(trip.start_date, trip.end_date)) : null
  return (
    <div className={COVER}>
      {trip.cover && (
        <img
          src={trip.cover.image_url}
          alt=""
          className="absolute inset-y-0 right-0 -z-20 h-full w-[60%] object-cover slide-tall:inset-x-0 slide-tall:top-0 slide-tall:bottom-auto slide-tall:h-[46%] slide-tall:w-full"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--tp-cover)_40%,transparent_78%)] slide-tall:bg-[linear-gradient(0deg,var(--tp-cover)_52%,transparent_72%)]" />
      <Guilloche
        seed={tripSeed(trip)}
        animate={live}
        className="absolute top-1/2 left-[-62cqmin] -z-10 size-[124cqmin] -translate-y-1/2 opacity-45 slide-tall:top-auto slide-tall:bottom-[-40cqmin] slide-tall:translate-y-0"
      />
      <div className="flex max-w-[64%] flex-col justify-center gap-[2.2cqmin] px-[7cqmin] py-[6cqmin] slide-tall:max-w-none slide-tall:justify-end slide-tall:pb-20">
        <p className="deck-label text-cover-mark">{[STATUS_LABELS[trip.status], timing].filter(Boolean).join(' · ')}</p>
        <h1 className="deck-display text-balance break-words">{trip.name}</h1>
        {dates && <p className="type-data deck-body text-cover-soft">{dates}</p>}
        {trip.destinations.length > 0 && (
          <p className="deck-heading">{trip.destinations.map((d) => d.name).join(' → ')}</p>
        )}
        {trip.travelers.length > 0 && (
          <div className="mt-[1.5cqmin] flex items-center gap-[1.6cqmin]">
            <span className="flex">
              {trip.travelers.map((person, i) => (
                <PersonAvatar
                  key={person.id}
                  person={person}
                  className={cn(
                    'size-[max(2rem,5.2cqmin)] text-[max(0.75rem,1.7cqmin)] ring-[max(2px,0.4cqmin)] ring-[var(--tp-cover)]',
                    i > 0 && '-ml-[1.2cqmin]',
                  )}
                />
              ))}
            </span>
            <span className="deck-body">{listFormat.format(trip.travelers.map((p) => p.name))}</span>
          </div>
        )}
      </div>
      {trip.cover && (
        <p className="deck-small absolute right-[2.2cqmin] bottom-[1.6cqmin] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/60%)]">
          {trip.cover.destination_name} · Photo: Wikipedia
        </p>
      )}
    </div>
  )
}

function DestinationSlide({ deck, slide, index, total }: PageProps<'destination'>) {
  const { destination: place, position } = slide
  const now = useNow(30_000)
  const home = deck.trip.home_currency
  const where = placeLine(place)
  const pins = deck.destinations.map((d, i) => ({
    id: `destination-${d.id}`,
    lat: d.lat,
    lon: d.lon,
    label: deck.destinations.length > 1 ? String(i + 1) : '',
    title: d.name,
    color: d.id === place.id ? 'var(--tp-brand)' : 'var(--tp-ink-soft)',
  }))
  let money: string | null = null
  if (place.currency === home) money = 'Same as at home'
  else if (place.currency) money = place.rate !== null ? exchangeText(home, place.currency, Number(place.rate)) : 'No exchange rate yet'

  return (
    <SlidePage trip={deck.trip} section="Destination" index={index} total={total}>
      <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_1fr] gap-[5cqmin] slide-tall:flex-none slide-tall:grid-cols-1">
        <div className="flex min-h-0 flex-col justify-center gap-[2.4cqmin]">
          <p className="deck-label text-brand">
            {[where, deck.destinations.length > 1 ? `Stop ${position} of ${deck.destinations.length}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h2 className="deck-display break-words">{place.name}</h2>
          {place.summary && <p className="deck-body line-clamp-6 max-w-[64ch]">{place.summary}</p>}
          <dl className="grid grid-cols-2 gap-[3cqmin] border-t pt-[2.4cqmin]">
            {place.timezone && (
              <Fact label="Local time" value={<span className="type-data">{localTime(place.timezone, now)}</span>} note={offsetFromViewer(place.timezone, now)} />
            )}
            {place.currency && <Fact label="Money" value={currencyNames.of(place.currency) ?? place.currency} note={money} />}
          </dl>
        </div>
        <div className={cn('grid min-h-0 gap-[2.4cqmin]', place.image_url ? 'grid-rows-[3fr_2fr]' : 'grid-rows-1', 'slide-tall:grid-rows-none')}>
          {place.image_url && (
            <figure className="relative min-h-0 overflow-hidden rounded-[1.2cqmin] slide-tall:aspect-[3/2]">
              <img src={place.image_url} alt={place.name} className="absolute inset-0 h-full w-full object-cover" />
              <figcaption className="deck-small absolute right-[1.4cqmin] bottom-[1cqmin] text-white/85 [text-shadow:0_1px_2px_rgb(0_0_0/60%)]">
                Photo: Wikipedia
              </figcaption>
            </figure>
          )}
          <DeckMap pins={pins} route names maxZoom={5} className="slide-tall:aspect-[3/2]" />
        </div>
      </div>
    </SlidePage>
  )
}

function stops(quote: DeckRoute['options'][number]): string {
  const out = stopsText(quote.stops_out)
  if (quote.stops_back === null || quote.stops_back === quote.stops_out) return out
  return `${out} out, ${stopsText(quote.stops_back).toLowerCase()} back`
}

function FlightsSlide({ deck, slide, index, total }: PageProps<'flights'>) {
  const { route, options, trend, typical_low, typical_high, price_level } = slide.route
  const [best, ...others] = options
  const fare = farePrice(best)
  const home = deck.trip.home_currency
  const typical = typical_low !== null && typical_high !== null ? { low: Number(typical_low), high: Number(typical_high) } : null
  const series = trend.map((p) => ({ day: p.day, price: Number(p.price) }))

  return (
    <SlidePage trip={deck.trip} section="Flights" index={index} total={total}>
      <div className="flex flex-wrap items-end justify-between gap-x-[4cqmin] gap-y-[1cqmin]">
        <div>
          {route.label && <p className="deck-label text-brand">{route.label}</p>}
          <h2 className="deck-code flex flex-wrap items-center gap-x-[1.6cqmin]">
            {route.origin_codes.join(' · ')}
            <ArrowRight className="size-[max(1.5rem,4.5cqmin)] text-brand" aria-label="to" />
            {route.destination_codes.join(' · ')}
          </h2>
        </div>
        <p className="deck-small max-w-[60ch] text-ink-soft">{routeDescription(route)}</p>
      </div>

      <div className="mt-[4cqmin] grid min-h-0 flex-1 grid-cols-[1fr_1.15fr] items-center gap-[5cqmin] slide-tall:flex-none slide-tall:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-[1.4cqmin]">
          <p className="deck-label text-ink-soft">Best fare right now</p>
          <p className="deck-figure">{formatMoney(fare.amount, fare.currency)}</p>
          <p className="deck-body">
            <span className="type-data">{formatMoney(fare.amount / Math.max(1, best.passengers), fare.currency)}</span> per
            person · {best.passengers} {best.passengers === 1 ? 'traveler' : 'travelers'}
          </p>
          <p className="deck-body">
            {[quoteDates(best), best.airlines.join(', ') || null, stops(best)].filter(Boolean).join(' · ')}
          </p>
          <p className="deck-small flex items-center gap-[1cqmin] text-ink-soft" title={SOURCE_DESCRIPTIONS[best.source]}>
            <span className="inline-block h-[max(2px,0.35cqmin)] w-[3cqmin] rounded-full" style={{ backgroundColor: seriesFor(best.source).color }} aria-hidden="true" />
            {seriesFor(best.source).label} · checked {timeAgo(best.observed_at)}
          </p>
          {others.length > 0 && (
            <ul className="mt-[2cqmin] space-y-[1.2cqmin] border-t pt-[2cqmin]">
              {others.map((quote) => {
                const price = farePrice(quote)
                return (
                  <li key={quote.id} className="deck-small flex flex-wrap items-baseline gap-x-[1.6cqmin]">
                    <span className="type-data deck-body font-bold">{formatMoney(price.amount, price.currency)}</span>
                    <span className="text-ink-soft">
                      {[quoteDates(quote), quote.airlines.join(', ') || null, stops(quote)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <figure className="flex min-w-0 flex-col gap-[1.6cqmin]">
          <figcaption className="deck-label text-ink-soft">Lowest price each day</figcaption>
          {series.length >= 2 ? (
            <Sparkline points={series} currency={home} typical={typical} />
          ) : (
            <p className="deck-body text-ink-soft">The price history fills in as prices are checked.</p>
          )}
          {price_level && (
            <p className="deck-small text-ink-soft">Google Flights rates today’s prices as {price_level} for these dates.</p>
          )}
        </figure>
      </div>
    </SlidePage>
  )
}

const LODGING_COLUMNS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3']
const MAX_LODGING = 6
type Travelers = Presentation['trip']['travelers']

function lodgingBadge(option: Lodging): string | null {
  if (option.status === 'booked') return 'Booked'
  if (option.status === 'shortlisted') return 'Shortlisted'
  return option.favorite ? 'Favorite' : null
}

/** The total in the trip's currency when converted, else as listed. */
function lodgingTotal(option: Lodging): { amount: string; currency: string } | null {
  if (option.price_home_total !== null) return { amount: option.price_home_total, currency: option.home_currency }
  return option.price_total !== null && option.currency ? { amount: option.price_total, currency: option.currency } : null
}

function Hearts({ option, travelers, withNames = false }: { option: Lodging; travelers: Travelers; withNames?: boolean }) {
  const hearts = travelers.filter((t) => option.hearts.includes(t.id))
  if (hearts.length === 0) return null
  const names = listFormat.format(hearts.map((h) => h.name))
  return (
    <span className="flex items-center gap-[0.8cqmin]" aria-label={`Hearts from ${names}`}>
      <span className="flex">
        {hearts.map((h) => (
          <Heart key={h.id} className="size-[max(0.8rem,1.8cqmin)]" style={{ color: h.color, fill: h.color }} aria-hidden="true" />
        ))}
      </span>
      {withNames && <span aria-hidden="true">{names}</span>}
    </span>
  )
}

function Rating({ option }: { option: Lodging }) {
  if (option.rating === null) return null
  return (
    <span className="flex items-center gap-[0.5cqmin]">
      <Star className="size-[max(0.8rem,1.7cqmin)] fill-current text-amber-500" aria-hidden="true" />
      <span className="type-data">{Number(option.rating).toFixed(2)}</span>
      {option.review_count !== null && <span className="text-ink-soft">({option.review_count})</span>}
    </span>
  )
}

function LodgingTile({ option, travelers }: { option: Lodging; travelers: Travelers }) {
  const badge = lodgingBadge(option)
  const total = lodgingTotal(option)
  return (
    <li className="flex min-h-0 flex-col overflow-hidden rounded-[1.2cqmin] border bg-card">
      <div className="relative min-h-[12cqmin] flex-1 bg-muted slide-tall:aspect-[16/9] slide-tall:flex-none">
        {option.photos[0] && (
          <img src={option.photos[0]} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {badge && (
          <span className="deck-label absolute top-[1.2cqmin] left-[1.2cqmin] flex items-center gap-[0.6cqmin] rounded-full bg-black/60 px-[1.3cqmin] py-[0.5cqmin] tracking-[0.08em] text-white">
            {badge === 'Favorite' && <Star className="size-[max(0.75rem,1.5cqmin)] fill-amber-300 text-amber-300" aria-hidden="true" />}
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-[0.5cqmin] p-[1.8cqmin]">
        <p className="deck-heading line-clamp-1">{option.title}</p>
        <p className="deck-small min-h-[1.4em] text-ink-soft">
          {[option.site, option.nights ? `${option.nights} ${option.nights === 1 ? 'night' : 'nights'}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="deck-small flex flex-wrap items-center justify-between gap-x-[1.6cqmin]">
          <span>
            {total ? (
              <>
                <span className="type-data deck-body font-bold">{formatMoney(total.amount, total.currency)}</span> total
              </>
            ) : (
              <span className="text-ink-soft">No price yet</span>
            )}
          </span>
          <span className="flex items-center gap-[1.2cqmin]">
            <Rating option={option} />
            <Hearts option={option} travelers={travelers} />
          </span>
        </div>
      </div>
    </li>
  )
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

/** One place on its own: a big photo beside everything worth saying about it. */
function LodgingFeature({ option, travelers }: { option: Lodging; travelers: Travelers }) {
  const badge = lodgingBadge(option)
  const total = lodgingTotal(option)
  const each = perPerson(option, travelers.length)
  const space = [
    option.bedrooms !== null && `${option.bedrooms} ${option.bedrooms === 1 ? 'bedroom' : 'bedrooms'}`,
    option.beds !== null && `${option.beds} ${option.beds === 1 ? 'bed' : 'beds'}`,
  ].filter(Boolean)
  const pros = lines(option.pros)
  const cons = lines(option.cons)
  const stay = option.check_in && option.check_out ? formatDateRange(option.check_in, option.check_out) : null
  return (
    <div className="mt-[3cqmin] grid min-h-0 flex-1 grid-cols-[1.3fr_1fr] gap-[4.5cqmin] slide-tall:flex-none slide-tall:grid-cols-1">
      <div className="relative min-h-0 overflow-hidden rounded-[1.2cqmin] bg-muted slide-tall:aspect-[3/2]">
        {option.photos[0] && (
          <img src={option.photos[0]} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-[1.4cqmin]">
        {badge && <p className="deck-label text-brand">{badge}</p>}
        <h3 className="deck-title break-words">{option.title}</h3>
        <p className="deck-small text-ink-soft">{[option.site, option.location_name, stay].filter(Boolean).join(' · ')}</p>
        {total && (
          <div className="mt-[1cqmin]">
            <p className="deck-figure">{formatMoney(total.amount, total.currency)}</p>
            <p className="deck-body mt-[0.6cqmin] text-ink-soft">
              {[
                option.nights ? `total for ${option.nights} ${option.nights === 1 ? 'night' : 'nights'}` : 'total',
                each !== null ? `${formatMoney(each, option.home_currency)} per person` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}
        <div className="deck-body flex flex-wrap items-center gap-x-[2.4cqmin] gap-y-[0.8cqmin]">
          <Rating option={option} />
          {space.length > 0 && <span>{space.join(' · ')}</span>}
          <Hearts option={option} travelers={travelers} withNames />
        </div>
        {(pros.length > 0 || cons.length > 0) && (
          <ul className="deck-small mt-[1cqmin] space-y-[0.5cqmin] border-t pt-[1.6cqmin]">
            {pros.map((line) => (
              <li key={`pro-${line}`}>
                <span className="font-bold text-success" aria-label="Pro:">+</span> {line}
              </li>
            ))}
            {cons.map((line) => (
              <li key={`con-${line}`}>
                <span className="font-bold text-ink-soft" aria-label="Con:">–</span> {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function LodgingSlide({ deck, slide, index, total }: PageProps<'lodging'>) {
  const shown = deck.lodging.slice(0, MAX_LODGING)
  const more = deck.lodging.length - shown.length
  return (
    <SlidePage trip={deck.trip} section="Lodging" index={index} total={total}>
      <h2 className="deck-title">{slide.label}</h2>
      {shown.length === 1 ? (
        <LodgingFeature option={shown[0]} travelers={deck.trip.travelers} />
      ) : (
        <ul
          className={cn(
            'mt-[3cqmin] grid min-h-0 flex-1 gap-[2.4cqmin] slide-tall:flex-none slide-tall:grid-cols-1 slide-tall:grid-rows-none',
            LODGING_COLUMNS[Math.min(3, shown.length)],
            shown.length > 3 && 'grid-rows-2',
          )}
        >
          {shown.map((option) => (
            <LodgingTile key={option.id} option={option} travelers={deck.trip.travelers} />
          ))}
        </ul>
      )}
      {more > 0 && <p className="deck-small mt-[1.6cqmin] text-ink-soft">And {more} more on the Lodging page.</p>}
    </SlidePage>
  )
}

function DaySlide({ deck, slide, index, total }: PageProps<'day'>) {
  const { day, number } = slide
  const numbered = day.activities.map((activity, i) => ({ activity, n: i + 1 }))
  const pins = numbered
    .filter(({ activity }) => activity.lat !== null && activity.lon !== null)
    .map(({ activity, n }) => ({
      id: `activity-${activity.id}`,
      lat: activity.lat!,
      lon: activity.lon!,
      label: String(n),
      title: activity.title,
      color: CATEGORY[activity.category].color,
    }))
  const compact = day.activities.length > 6

  return (
    <SlidePage trip={deck.trip} section={number !== null ? `Day ${number}` : 'Outside the trip dates'} index={index} total={total}>
      <div className="flex items-start justify-between gap-[3cqmin]">
        <div className="min-w-0">
          <p className="deck-label text-brand">{day.title ? formatDayLong(day.day) : (day.destination_name ?? '')}</p>
          <h2 className="deck-title mt-[0.6cqmin] break-words">{day.title || formatDayLong(day.day)}</h2>
          {day.notes && <p className="deck-small mt-[1cqmin] line-clamp-2 max-w-[70ch] text-ink-soft">{day.notes}</p>}
        </div>
        <Stamp city={day.destination_name} day={day.day} number={number} />
      </div>

      <div
        className={cn(
          'mt-[3cqmin] grid min-h-0 flex-1 gap-[4cqmin] slide-tall:flex-none',
          pins.length > 0 ? 'grid-cols-[1fr_1.05fr] slide-tall:grid-cols-1' : 'grid-cols-1 content-center',
        )}
      >
        {day.activities.length === 0 ? (
          <p className="deck-body text-ink-soft">No plans on the calendar yet.</p>
        ) : (
          <ol
            className={cn(
              'min-h-0',
              compact ? 'space-y-[1cqmin]' : 'space-y-[1.8cqmin]',
              pins.length === 0 && compact && 'columns-2 gap-[4cqmin] slide-tall:columns-1',
            )}
          >
            {numbered.map(({ activity, n }) => (
              <li key={activity.id} className="flex break-inside-avoid gap-[1.6cqmin]">
                <span
                  className="type-data grid size-[max(1.5rem,3.6cqmin)] shrink-0 place-items-center rounded-full text-[max(0.75rem,1.6cqmin)] font-bold text-white"
                  style={{ backgroundColor: CATEGORY[activity.category].color }}
                  aria-hidden="true"
                >
                  {n}
                </span>
                <div className="min-w-0">
                  <p className="type-data deck-small text-ink-soft">{formatTimeRange(activity.start_time, activity.end_time)}</p>
                  <p className={cn(compact ? 'deck-body font-semibold' : 'deck-heading', 'break-words')}>{activity.title}</p>
                  {!compact && activity.location_name && activity.location_name !== activity.title && (
                    <p className="deck-small truncate text-ink-soft">{activity.location_name}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {pins.length > 0 && <DeckMap pins={pins} route className="slide-tall:aspect-[4/3]" />}
      </div>
    </SlidePage>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="min-w-0 border-t border-cover-soft/40 pt-[1.6cqmin]">
      <dt className="deck-label text-cover-soft">{label}</dt>
      <dd className="deck-heading mt-[0.8cqmin] break-words">{value}</dd>
      {note && <dd className="deck-small mt-[0.4cqmin] text-cover-soft">{note}</dd>}
    </div>
  )
}

function ClosingSlide({ deck }: { deck: Presentation }) {
  const { trip } = deck
  const { live } = useSlide()
  const facts = closingFacts(deck)
  const dated = trip.start_date && trip.end_date
  const timing = dated ? tripTiming(trip.start_date!, trip.end_date!) : null
  const lead =
    timing?.kind === 'upcoming'
      ? `${timing.days} ${timing.days === 1 ? 'day' : 'days'} to go`
      : timing
        ? timingLabel(timing)
        : 'Dates to be decided'
  const stats = [
    dated && { label: 'Dates', value: tripDates(trip)!, note: trip.destinations.map((d) => d.name).join(' → ') || null },
    facts.plans > 0 && {
      label: 'Plans',
      value: `${facts.plans} ${facts.plans === 1 ? 'plan' : 'plans'}`,
      note: facts.ideas ? `and ${facts.ideas} ${facts.ideas === 1 ? 'idea' : 'ideas'} for later` : null,
    },
    facts.cheapestFare && {
      label: 'Flights from',
      value: formatMoney(facts.cheapestFare.perPerson, facts.cheapestFare.currency),
      note: `per person, ${facts.cheapestFare.route}`,
    },
    facts.booked
      ? { label: 'Staying at', value: facts.booked.title, note: 'Booked' }
      : facts.shortlisted > 0 && {
          label: 'Places to stay',
          value: `${facts.shortlisted} ${facts.shortlisted === 1 ? 'option' : 'options'}`,
          note: facts.shortlisted === 0 ? null : facts.onShortlist ? 'On the shortlist' : 'Still deciding',
        },
  ].filter((s): s is { label: string; value: string; note: string | null } => Boolean(s))

  return (
    <div className={cn(COVER, 'flex-col justify-center px-[7cqmin] py-[6cqmin] slide-tall:pb-20')}>
      <Guilloche
        seed={tripSeed(trip)}
        animate={live}
        className="absolute top-1/2 right-[-30cqmin] -z-10 size-[110cqmin] -translate-y-1/2 opacity-45 slide-tall:top-auto slide-tall:bottom-[-45cqmin] slide-tall:translate-y-0"
      />
      <p className="deck-label text-cover-mark">{lead}</p>
      <h2 className="deck-display mt-[1.6cqmin] max-w-[80%] text-balance break-words">{trip.name}</h2>
      {stats.length > 0 && (
        <dl className="mt-[5cqmin] grid max-w-[62%] grid-cols-2 gap-x-[5cqmin] gap-y-[3.5cqmin] slide-tall:max-w-none slide-tall:grid-cols-1">
          {stats.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </dl>
      )}
      <p className="deck-small mt-[6cqmin] text-cover-soft">
        Planned in Trip Planner · Updated {new Date(deck.generated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
    </div>
  )
}

/** One slide, whichever kind it is. */
export function SlideView({ deck, slide, index, total }: { deck: Presentation; slide: Slide; index: number; total: number }) {
  switch (slide.kind) {
    case 'title':
      return <TitleSlide deck={deck} />
    case 'destination':
      return <DestinationSlide deck={deck} slide={slide} index={index} total={total} />
    case 'flights':
      return <FlightsSlide deck={deck} slide={slide} index={index} total={total} />
    case 'lodging':
      return <LodgingSlide deck={deck} slide={slide} index={index} total={total} />
    case 'day':
      return <DaySlide deck={deck} slide={slide} index={index} total={total} />
    case 'closing':
      return <ClosingSlide deck={deck} />
  }
}
