import type { Day } from '@/lib/api/itinerary'
import { parseDate } from '@/lib/dates'
import { formatMiles } from '@/lib/geo'

const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

/** "Tue, Nov 5 · Temples" (or the day's city when it has no title). */
export function dayOptionLabel(day: Day): string {
  return [shortDay.format(parseDate(day.day)), day.title || day.destination_name].filter(Boolean).join(' · ')
}

export function longDate(iso: string): string {
  return longDay.format(parseDate(iso))
}

export function shortDate(iso: string): string {
  return shortDay.format(parseDate(iso))
}

const DAY_NAMES: Record<string, string> = {
  Mo: 'Mon',
  Tu: 'Tue',
  We: 'Wed',
  Th: 'Thu',
  Fr: 'Fri',
  Sa: 'Sat',
  Su: 'Sun',
  PH: 'Holidays',
}

/**
 * OpenStreetMap opening hours ("Mo-Fr 09:00-17:00; Sa 10:00-16:00; PH off") as readable lines.
 * The syntax can be much richer; anything unusual is shown as written.
 */
export function formatOpeningHours(value: string): string[] {
  if (value.trim() === '24/7') return ['Open 24 hours']
  return value
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) =>
      rule
        .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (code) => DAY_NAMES[code])
        // Hyphens in this syntax always mark ranges (days, times, dates).
        .replace(/-/g, '–')
        .replace(/\boff\b/g, 'closed'),
    )
}

export function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null
  return formatMiles(meters)
}
