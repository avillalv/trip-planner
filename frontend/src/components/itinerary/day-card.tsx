import { ChevronRight, MapPin } from 'lucide-react'
import { Link } from 'react-router'
import type { Day } from '@/lib/api/itinerary'
import type { DayWeather } from '@/lib/api/weather'
import { parseDate } from '@/lib/dates'
import { formatTime } from '@/lib/itinerary-time'
import { cn } from '@/lib/utils'
import { WeatherChip } from './weather-chip'

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const month = new Intl.DateTimeFormat(undefined, { month: 'short' })

function Brief({ label, item }: { label: string; item: NonNullable<Day['first']> }) {
  return (
    <p className="flex gap-2 text-sm">
      <span className="sr-only">{label}: </span>
      <span className="type-data w-[4.75rem] shrink-0 text-ink-soft">
        {item.start_time ? formatTime(item.start_time) : 'Any time'}
      </span>
      <span className="truncate">{item.title}</span>
    </p>
  )
}

/** One day of the trip: its date like a passport entry stamp, what it's called, and its first and last plans. */
type DayCardProps = { day: Day; number: number | null; to: string; weather?: DayWeather }

export function DayCard({ day, number, to, weather }: DayCardProps) {
  const date = parseDate(day.day)
  const empty = day.activity_count === 0
  const more = day.activity_count - (day.first ? 1 : 0) - (day.last ? 1 : 0)
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'group flex h-full gap-4 rounded-xl border bg-card p-4 outline-offset-2 transition-colors hover:border-ink-soft/40 focus-visible:outline-2 focus-visible:outline-ring',
          !day.in_trip && 'border-dashed',
        )}
      >
        <div className="flex w-14 shrink-0 flex-col items-center self-start rounded-lg border-2 border-double border-brand/60 py-1.5 text-brand">
          <span className="type-label text-[0.625rem]">{weekday.format(date)}</span>
          <span className="type-display text-3xl leading-none">{date.getDate()}</span>
          <span className="type-label text-[0.625rem]">{month.format(date)}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {day.title || (number ? `Day ${number}` : 'Outside the trip dates')}
              </p>
              {day.destination_name && (
                <p className="flex items-center gap-1 text-xs text-ink-soft">
                  <MapPin className="size-3" aria-hidden="true" />
                  {day.destination_name}
                </p>
              )}
            </div>
            <ChevronRight
              className="mt-0.5 size-4 shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </div>
          {weather && <WeatherChip weather={weather} />}
          {empty ? (
            <p className="text-sm text-ink-soft">Nothing planned yet</p>
          ) : (
            <div className="space-y-0.5">
              {day.first && <Brief label="First" item={day.first} />}
              {day.last && <Brief label="Last" item={day.last} />}
              {more > 0 && <p className="text-xs text-ink-soft">and {more} more</p>}
            </div>
          )}
        </div>
      </Link>
    </li>
  )
}
