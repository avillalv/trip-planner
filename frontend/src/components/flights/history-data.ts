import type { RouteHistory } from '@/lib/api/flights'
import { toISODate } from '@/lib/dates'
import type { PriceSeriesKey } from '@/lib/price-sources'

export type HistoryRow = { day: string } & Partial<Record<PriceSeriesKey, number>>

/** One row per day, with the cheapest price from each source (Google's history folded to daily lows). */
export function historyRows(history: RouteHistory): HistoryRow[] {
  const rows = new Map<string, HistoryRow>()
  const put = (day: string, key: PriceSeriesKey, price: number) => {
    const row = rows.get(day) ?? { day }
    const current = row[key]
    row[key] = current === undefined ? price : Math.min(current, price)
    rows.set(day, row)
  }
  for (const point of history.points) put(point.day, point.source as PriceSeriesKey, Number(point.price))
  for (const point of history.google) put(toISODate(new Date(point.at)), 'google', Number(point.price))
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function seriesPresent(rows: HistoryRow[]): Set<PriceSeriesKey> {
  const present = new Set<PriceSeriesKey>()
  for (const row of rows) for (const key of Object.keys(row)) if (key !== 'day') present.add(key as PriceSeriesKey)
  return present
}
