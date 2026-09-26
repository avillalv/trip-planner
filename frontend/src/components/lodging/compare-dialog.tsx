import { Star } from 'lucide-react'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { ErrorBoundary, PartFailed } from '@/components/common/error-boundary'
import type { MapPin } from '@/components/itinerary/place-map'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { CATEGORY } from '@/lib/activity-meta'
import type { Activity } from '@/lib/api/itinerary'
import type { Lodging } from '@/lib/api/lodging'
import { distanceKm, distanceSummary } from '@/lib/geo'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { perPerson } from './lodging-meta'

const PlaceMap = lazy(() => import('@/components/itinerary/place-map'))
const LETTERS = ['A', 'B', 'C', 'D']
// Without stay dates, plans this close count as being in the same area.
const NEARBY_KM = 50

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: Lodging[]
  activities: Activity[]
  travelers: number
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-[0.6875rem] font-bold tracking-wide text-brand uppercase">
      {children}
    </span>
  )
}

const km = (value: number) => (value < 10 ? value.toFixed(1) : value.toFixed(0))
const count = (n: number | string, one: string, many: string) => `${Number(n)} ${Number(n) === 1 ? one : many}`

type Located = Activity & { lat: number; lon: number }

/** The plans a place should be near: those during the stay, or (without dates) those in the same area. */
function plansFor(option: Lodging, located: Located[]): Located[] {
  if (option.check_in && option.check_out) {
    const during = located.filter((a) => a.day !== null && a.day >= option.check_in! && a.day <= option.check_out!)
    if (during.length) return during
  }
  return located.filter((a) => distanceKm({ lat: option.lat!, lon: option.lon! }, a) <= NEARBY_KM)
}

/** Two to four options side by side, with the best price, rating, and location marked. */
export function CompareDialog({ open, onOpenChange, options, activities, travelers }: Props) {
  const located = useMemo(
    () => activities.filter((a) => a.lat !== null && a.lon !== null).map((a) => ({ ...a, lat: a.lat!, lon: a.lon! })),
    [activities],
  )
  const rows = options.map((option, i) => {
    const plans = option.lat !== null && option.lon !== null ? plansFor(option, located) : []
    return {
      option,
      letter: LETTERS[i],
      plans,
      price: option.price_home_total !== null ? Number(option.price_home_total) : null,
      rating: option.rating !== null ? Number(option.rating) : null,
      distance: plans.length ? distanceSummary({ lat: option.lat!, lon: option.lon! }, plans) : null,
    }
  })
  const planned = [...new Map(rows.flatMap((r) => r.plans).map((a) => [a.id, a])).values()]
  const best = <T,>(values: (T | null)[], pick: (a: T, b: T) => boolean) =>
    values.reduce<T | null>((acc, v) => (v !== null && (acc === null || pick(v, acc)) ? v : acc), null)
  const lowest = best(rows.map((r) => r.price), (a, b) => a < b)
  const topRated = best(rows.map((r) => r.rating), (a, b) => a > b)
  const closest = best(rows.map((r) => r.distance?.average ?? null), (a, b) => a < b)

  const pins: MapPin[] = [
    ...rows
      .filter((r) => r.option.lat !== null && r.option.lon !== null)
      .map((r) => ({
        id: `lodging-${r.option.id}`,
        lat: r.option.lat!,
        lon: r.option.lon!,
        label: r.letter,
        title: r.option.title,
        color: 'var(--tp-brand)',
      })),
    ...planned.map((a) => ({
      id: `activity-${a.id}`,
      lat: a.lat,
      lon: a.lon,
      label: '',
      title: a.title,
      color: CATEGORY[a.category].color,
    })),
  ]
  const center = pins[0] ?? null
  const home = options[0]?.home_currency ?? 'USD'

  const line = (label: string, render: (row: (typeof rows)[number]) => ReactNode) => (
    <tr className="border-t align-top">
      {/* Labels stay put while the places scroll sideways on a phone. */}
      <th
        scope="row"
        className="sticky left-0 z-10 bg-popover py-2.5 pr-3 pl-4 text-left text-xs font-semibold tracking-wide text-ink-soft uppercase"
      >
        {label}
      </th>
      {rows.map((row) => (
        <td key={row.option.id} className="py-2.5 pr-4 text-sm">
          {render(row)}
        </td>
      ))}
    </tr>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[96dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="type-heading text-xl">Compare places to stay</DialogTitle>
          <DialogDescription>
            Prices in {home}. Distances are straight lines to the places in your itinerary.
          </DialogDescription>
        </DialogHeader>

        {/* Full-bleed so places scroll under the pinned labels, not beside them. */}
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full table-fixed" style={{ minWidth: `${8 + rows.length * 10}rem` }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-28 bg-popover sm:w-32" />
                {rows.map((row) => (
                  <th key={row.option.id} scope="col" className="pr-4 pb-3 text-left align-top font-normal">
                    {row.option.photos[0] ? (
                      <img
                        src={row.option.photos[0]}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="aspect-[3/2] w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="aspect-[3/2] w-full rounded-lg bg-muted" />
                    )}
                    <p className="mt-2 flex items-start gap-2 text-sm font-semibold">
                      <span className="type-data flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[0.6875rem] text-primary-foreground">
                        {row.letter}
                      </span>
                      <span className="line-clamp-2">{row.option.title}</span>
                    </p>
                    {row.option.site && <p className="text-xs text-ink-soft">{row.option.site}</p>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {line('Total', (row) =>
                row.price !== null ? (
                  <span className={cn('type-data', row.price === lowest && rows.length > 1 && 'font-bold')}>
                    {formatMoney(row.price, home)}
                    {row.price === lowest && rows.length > 1 && <Badge>Lowest</Badge>}
                  </span>
                ) : (
                  <span className="text-ink-soft">—</span>
                ),
              )}
              {line('Per night', (row) =>
                row.option.price_per_night !== null && row.option.currency ? (
                  <span className="type-data">{formatMoney(row.option.price_per_night, row.option.currency)}</span>
                ) : (
                  '—'
                ),
              )}
              {line('Per person', (row) => {
                const each = perPerson(row.option, travelers)
                return each !== null ? <span className="type-data">{formatMoney(each, home)}</span> : '—'
              })}
              {line('Rating', (row) =>
                row.rating !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-current text-amber-500" aria-hidden="true" />
                    <span className={cn('type-data', row.rating === topRated && rows.length > 1 && 'font-bold')}>
                      {row.rating.toFixed(2)}
                    </span>
                    {row.option.review_count !== null && <span className="text-ink-soft">({row.option.review_count})</span>}
                    {row.rating === topRated && rows.length > 1 && <Badge>Best rated</Badge>}
                  </span>
                ) : (
                  '—'
                ),
              )}
              {line('Space', (row) =>
                [
                  row.option.bedrooms !== null && count(row.option.bedrooms, 'bedroom', 'bedrooms'),
                  row.option.beds !== null && count(row.option.beds, 'bed', 'beds'),
                  row.option.baths !== null && count(row.option.baths, 'bath', 'baths'),
                ]
                  .filter(Boolean)
                  .join(', ') || '—',
              )}
              {line('To your plans', (row) =>
                row.distance ? (
                  <span>
                    <span className="type-data">{km(row.distance.average)} km</span> on average
                    {row.distance.average === closest && rows.length > 1 && <Badge>Closest</Badge>}
                    <span className="block text-xs text-ink-soft">nearest {km(row.distance.nearest)} km</span>
                  </span>
                ) : (
                  <span className="text-ink-soft">
                    {row.option.lat === null ? 'No location saved' : 'No plans with a place nearby yet'}
                  </span>
                ),
              )}
              {line('Pros', (row) => <span className="whitespace-pre-wrap">{row.option.pros || '—'}</span>)}
              {line('Cons', (row) => <span className="whitespace-pre-wrap">{row.option.cons || '—'}</span>)}
              {line('Notes', (row) => <span className="line-clamp-4 whitespace-pre-wrap">{row.option.notes || '—'}</span>)}
            </tbody>
          </table>
        </div>

        {center && (
          <div className="h-72">
            <ErrorBoundary fallback={(error) => <PartFailed what="map" error={error} />}>
              <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
                <PlaceMap center={{ lat: center.lat, lon: center.lon }} pins={pins} className="h-full" />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
