import { lazy, Suspense, useId, type ReactNode } from 'react'
import { Guilloche } from '@/components/brand/guilloche'
import { ErrorBoundary } from '@/components/common/error-boundary'
import type { MapPin } from '@/components/itinerary/place-map'
import type { Trip } from '@/lib/api/trips'
import { parseDate, toISODate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { tripSeed } from '@/lib/trip-display'
import { cn } from '@/lib/utils'
import { projectPoints, scaleSeries } from './deck-geometry'
import { formatStampDay } from './deck-model'
import { useSlide } from './slide-context'

const PlaceMap = lazy(() => import('@/components/itinerary/place-map'))

const pad = (n: number) => String(n).padStart(2, '0')

/** A content page: faint linework along the top, a running header, and the page number. */
export function SlidePage({
  trip,
  section,
  index,
  total,
  children,
}: {
  trip: Pick<Trip, 'id' | 'name'>
  section: string
  index: number
  total: number
  children: ReactNode
}) {
  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-background text-foreground">
      <Guilloche
        variant="band"
        seed={tripSeed(trip)}
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[11cqmin] w-full opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <header className="deck-label flex shrink-0 items-baseline justify-between gap-[2cqmin] px-[6cqmin] pt-[3.6cqmin] text-ink-soft">
        <span className="min-w-0 truncate">
          {trip.name} · {section}
        </span>
        <span className="type-data shrink-0 tracking-normal">
          {pad(index + 1)} / {pad(total)}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[6cqmin] pt-[2.6cqmin] pb-[4.5cqmin] slide-tall:pb-20">
        {children}
      </div>
    </div>
  )
}

export function Fact({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="deck-label text-ink-soft">{label}</dt>
      <dd className="deck-heading mt-[0.6cqmin]">{value}</dd>
      {note && <dd className="deck-small mt-[0.3cqmin] text-ink-soft">{note}</dd>}
    </div>
  )
}

/** A passport entry stamp for the day: city, date, and day number. */
export function Stamp({ city, day, number }: { city: string | null; day: string; number: number | null }) {
  const { live } = useSlide()
  return (
    <div
      aria-hidden="true"
      className={cn(
        'shrink-0 -rotate-6 rounded-[1.1cqmin] px-[2.2cqmin] py-[1.1cqmin] text-center text-brand opacity-90',
        live && 'motion-safe:animate-[stamp-press_420ms_cubic-bezier(0.2,0.9,0.3,1.25)_both]',
      )}
      style={{ border: 'max(3px, 0.55cqmin) double currentColor' }}
    >
      {city && <p className="deck-label">{city}</p>}
      <p className="type-data font-bold uppercase" style={{ fontSize: 'max(1.25rem, 3.4cqmin)', lineHeight: 1.1 }}>
        {formatStampDay(day)}
      </p>
      {number !== null && <p className="deck-label">Day {number}</p>}
    </div>
  )
}

const PLOT = { width: 400, height: 260, margin: 34 }

/** A drawn stand-in for the map (printing, thumbnails, and while tiles load): the stops in order. */
function RoutePlot({ pins, route, names, className }: { pins: MapPin[]; route: boolean; names: boolean; className?: string }) {
  const at = projectPoints(pins, PLOT.width, PLOT.height, PLOT.margin)
  // Unique per plot: most slides sit hidden, and a shared id could resolve to a hidden copy.
  const dots = `deck-dots-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn('deck-plot', className)}
    >
      <defs>
        <pattern id={dots} width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.9" className="fill-ink-soft" opacity="0.35" />
        </pattern>
      </defs>
      <rect width={PLOT.width} height={PLOT.height} fill={`url(#${dots})`} />
      {route && at.length > 1 && (
        <polyline
          points={at.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          fill="none"
          className="stroke-ink-soft"
          strokeWidth="1.6"
          strokeDasharray="5 5"
          strokeLinejoin="round"
        />
      )}
      {pins.map((pin, i) => (
        <g key={pin.id} transform={`translate(${at[i].x.toFixed(1)} ${at[i].y.toFixed(1)})`}>
          <circle r="11" fill={pin.color} className="stroke-background" strokeWidth="2.5" />
          {pin.label && (
            <text textAnchor="middle" dy="4" fill="#fff" fontSize="11" fontWeight="700" fontFamily="var(--font-mono)">
              {pin.label}
            </text>
          )}
          {names && (
            <text x="17" dy="4" fontSize="13" fontWeight="600" className="fill-foreground" fontFamily="var(--font-sans)">
              {pin.title}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

/**
 * The slide on screen shows a real map (a picture of it: no panning); underneath, and in print or
 * thumbnails, the drawn plot of the same pins.
 */
export function DeckMap({
  pins,
  route = false,
  names = false,
  maxZoom,
  className,
}: {
  pins: MapPin[]
  route?: boolean
  names?: boolean
  maxZoom?: number
  className?: string
}) {
  const { live } = useSlide()
  if (pins.length === 0) return null
  return (
    <div className={cn('relative min-h-0 overflow-hidden rounded-[1.2cqmin] border bg-muted', className)}>
      <RoutePlot pins={pins} route={route} names={names} className="absolute inset-0 h-full w-full" />
      {live && (
        <div className="deck-live-map absolute inset-0">
          {/* If the live map fails, the drawn plot underneath stays. */}
          <ErrorBoundary fallback={() => null}>
            <Suspense fallback={null}>
              <PlaceMap
                center={pins[0]}
                pins={pins}
                interactive={false}
                maxZoom={maxZoom}
                padding={80}
                className="h-full min-h-0 rounded-none border-0"
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}

const CHART = { width: 640, height: 280, left: 6, right: 120, top: 34, bottom: 44 }
const shortDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** The lowest price each day as one line, with Google's typical range behind it when known. */
export function Sparkline({
  points,
  currency,
  typical,
}: {
  points: Array<{ day: string; price: number }>
  currency: string
  typical: { low: number; high: number } | null
}) {
  const { coords, y } = scaleSeries(points, CHART, typical ? [typical.low, typical.high] : [])
  const path = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const first = points[0]
  const latest = points[points.length - 1]
  const end = coords[coords.length - 1]
  const plotRight = CHART.width - CHART.right
  const baseline = CHART.height - CHART.bottom + 12
  const lowest = Math.min(...points.map((p) => p.price))
  const today = toISODate(new Date())
  const summary = `From ${formatMoney(first.price, currency)} on ${shortDay.format(parseDate(first.day))} to ${formatMoney(latest.price, currency)}; lowest ${formatMoney(lowest, currency)}`
  return (
    <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} className="h-auto w-full overflow-visible" role="img" aria-label={summary}>
      {typical && (
        <g>
          <rect
            x={CHART.left}
            width={plotRight - CHART.left}
            y={y(typical.high)}
            height={Math.max(0, y(typical.low) - y(typical.high))}
            fill="var(--viz-band)"
          />
          <text x={plotRight} y={y(typical.high) - 9} textAnchor="end" fontSize="17" className="fill-ink-soft">
            Typical {formatMoney(typical.low, currency)}–{formatMoney(typical.high, currency)}
          </text>
        </g>
      )}
      <line x1={CHART.left} x2={plotRight} y1={baseline} y2={baseline} className="stroke-rule" strokeWidth="1.5" />
      <path d={path} fill="none" stroke="var(--tp-teal)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end.x} cy={end.y} r="8" fill="var(--tp-teal)" className="stroke-background" strokeWidth="3.5" />
      {/* The latest price, labeled at the end of the line rather than on it. */}
      <text x={end.x + 16} y={end.y + 8} fontSize="23" fontWeight="700" fontFamily="var(--font-mono)" className="fill-foreground">
        {formatMoney(latest.price, currency)}
      </text>
      <g fontSize="16" className="fill-ink-soft">
        <text x={CHART.left} y={CHART.height - 6}>
          {shortDay.format(parseDate(first.day))}
        </text>
        <text x={plotRight} y={CHART.height - 6} textAnchor="end">
          {latest.day === today ? 'Today' : shortDay.format(parseDate(latest.day))}
        </text>
      </g>
    </svg>
  )
}
