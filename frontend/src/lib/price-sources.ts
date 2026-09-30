/** Price sources in legend order. Colors follow the source, never its rank (validated tokens in index.css). */
export const PRICE_SERIES = [
  { key: 'serpapi', label: 'Google Flights', short: 'Live', color: 'var(--viz-live)' },
  { key: 'travelpayouts', label: 'Aviasales', short: 'Cached', color: 'var(--viz-cached)' },
  { key: 'agent', label: 'Claude agents', short: 'Agent', color: 'var(--viz-agent)' },
  { key: 'google', label: "Google's price history", short: 'History', color: 'var(--viz-google)' },
] as const

export type PriceSeriesKey = (typeof PRICE_SERIES)[number]['key']

export const SOURCE_DESCRIPTIONS: Record<string, string> = {
  serpapi: 'Live price from a Google Flights search',
  travelpayouts: 'Cached fare another traveler found on Aviasales recently',
  agent: 'Found on the web by a Claude agent; check the source before booking',
  manual: 'A flight you booked, entered by hand',
}

/** How a booked flight is tagged. It isn't a price series, so it never appears in the charts. */
const BOOKED = { key: 'manual', label: 'Booked', short: 'Booked', color: 'var(--tp-brand)' } as const

export function seriesFor(source: string) {
  if (source === 'manual') return BOOKED
  return PRICE_SERIES.find((s) => s.key === source) ?? PRICE_SERIES[0]
}
