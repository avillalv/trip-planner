const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    })
    formatters.set(key, f)
  }
  return f
}

/** "$1,859" — prices arrive from the API as decimal strings. */
export function formatMoney(amount: string | number | null | undefined, currency: string, compact = false): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value)) return '—'
  try {
    return formatter(currency, compact).format(value)
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`
  }
}

/** "12h 40m" from minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
