import { LocateFixed, Search } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBoundary, PartFailed } from '@/components/common/error-boundary'
import { CATEGORY, SEARCH_KINDS } from '@/lib/activity-meta'
import { usePlaceSearch, type Day, type Place, type PlaceQuery, type SearchKind } from '@/lib/api/itinerary'
import { METERS_PER_MILE } from '@/lib/geo'
import { useDebouncedValue } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { ActivityFields } from './activity-fields'
import { draftFromPlace, validateDraft, type ActivityDraft } from './activity-form'
import { formatDistance, formatOpeningHours, shortDate } from './labels'
import type { MapPin } from './place-map'
import { PlaceDetailsPane } from './place-details'

const PlaceMap = lazy(() => import('./place-map'))

// How far to look, in miles; or all of the destination.
const MILES = [1, 3, 5, 10, 25, 50, 100]
type Reach = number | 'all'

export type SearchCenter = {
  lat: number
  lon: number
  name: string
  /** The trip destination this is the middle of: a search can cover all of it (the default when large). */
  destination?: { id: number; large: boolean }
}

type Props = {
  center: SearchCenter
  days: Day[]
  /** Day, times, and so on to start new activities with. */
  initial: Partial<ActivityDraft>
  saving: boolean
  onAdd: (place: Place, draft: ActivityDraft) => void
}

export function PlaceFinder({ center, days, initial, saving, onAdd }: Props) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<SearchKind | null>(null)
  const [reach, setReach] = useState<Reach>(center.destination?.large ? 'all' : 5)
  const [area, setArea] = useState({ lat: center.lat, lon: center.lon, label: center.name })
  const [moved, setMoved] = useState<{ lat: number; lon: number } | null>(null)
  const [selected, setSelected] = useState<Place | null>(null)
  const typed = useDebouncedValue(text.trim(), 400)
  const whole = reach === 'all' && center.destination !== undefined

  const query = useMemo<PlaceQuery | null>(() => {
    const where = whole
      ? { lat: center.lat, lon: center.lon, radius_m: 8000, within: center.destination!.id }
      : { lat: area.lat, lon: area.lon, radius_m: Math.round((reach === 'all' ? 25 : reach) * METERS_PER_MILE) }
    if (kind) return { ...where, kind }
    return typed.length >= 2 ? { ...where, q: typed } : null
  }, [kind, typed, whole, reach, area.lat, area.lon, center])
  const search = usePlaceSearch(query)
  const places = useMemo(() => (query ? (search.data?.places ?? []) : []), [query, search.data])
  const pins: MapPin[] = useMemo(
    () =>
      places.map((place, i) => ({
        id: place.id,
        lat: place.lat,
        lon: place.lon,
        label: String(i + 1),
        title: place.name,
        color: CATEGORY[place.category].color,
      })),
    [places],
  )

  const choose = (id: string) => setSelected(places.find((p) => p.id === id) ?? null)

  return (
    <div className="grid gap-4 md:h-[min(68dvh,40rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-h-0 flex-col gap-3">
        {selected ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <PlaceDetailsPane place={selected} onBack={() => setSelected(null)}>
              <AddPlace place={selected} days={days} initial={initial} saving={saving} onAdd={onAdd} />
            </PlaceDetailsPane>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-soft" aria-hidden="true" />
                <Input
                  aria-label={whole ? `Search places in ${center.name}` : `Search places near ${area.label}`}
                  placeholder={whole ? `Search in ${center.name}` : `Search near ${area.label}`}
                  className="pl-8"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value)
                    setKind(null)
                  }}
                />
              </div>
              <select
                aria-label="How far to look"
                value={reach}
                onChange={(e) => {
                  const next = e.target.value === 'all' ? 'all' : Number(e.target.value)
                  setReach(next)
                  // All of the destination means around its middle again.
                  if (next === 'all') setArea({ lat: center.lat, lon: center.lon, label: center.name })
                }}
                className="h-9 rounded-lg border border-input bg-card px-2 text-sm"
              >
                {center.destination && <option value="all">All of {center.name}</option>}
                {MILES.map((miles) => (
                  <option key={miles} value={miles}>
                    Within {miles} mi
                  </option>
                ))}
              </select>
            </div>

            <div role="radiogroup" aria-label="Categories" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap">
              {SEARCH_KINDS.map(({ kind: k, label, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => {
                    setKind(kind === k ? null : k)
                    setText('')
                  }}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                    kind === k ? 'border-brand bg-brand-soft font-semibold text-brand' : 'hover:bg-accent',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-40 flex-1 overflow-y-auto" aria-live="polite">
              {!query ? (
                <p className="py-6 text-center text-sm text-ink-soft">
                  Pick a category, or type a name like “ramen” or “Fushimi Inari”.
                </p>
              ) : search.isError ? (
                <p role="alert" className="py-6 text-center text-sm text-destructive">
                  {search.error.message}
                </p>
              ) : search.isPending ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : places.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-soft">
                  {whole
                    ? `Nothing found in ${center.name}. Try another word or category.`
                    : `Nothing found within ${reach} mi of ${area.label}. Try a wider distance${
                        center.destination ? `, all of ${center.name},` : ''
                      } or move the map and search that area.`}
                </p>
              ) : (
                <>
                  {whole && (
                    <p className="pb-2 text-xs text-ink-soft">
                      Nearest the middle of {center.name} first. To look around a town, move the map there and
                      choose Search this area.
                    </p>
                  )}
                  <ol className={cn('divide-y', search.isPlaceholderData && 'opacity-60')}>
                    {places.map((place, i) => (
                      <ResultRow
                        key={place.id}
                        place={place}
                        number={i + 1}
                        // Distances from the middle of a whole country mean little, so they're left off.
                        showDistance={!whole}
                        onChoose={() => setSelected(place)}
                      />
                    ))}
                  </ol>
                </>
              )}
            </div>
          </>
        )}
        <p className="text-xs text-ink-soft">
          Powered by{' '}
          <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Geoapify
          </a>{' '}
          · ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            OpenStreetMap
          </a>{' '}
          contributors
        </p>
      </div>

      <div className="relative order-first h-56 md:order-none md:h-full">
        <ErrorBoundary fallback={(error) => <PartFailed what="map" error={error} />}>
          <Suspense fallback={<Skeleton className="h-full w-full rounded-xl" />}>
            <PlaceMap
              center={area}
              pins={pins}
              selectedId={selected?.id ?? null}
              onSelect={choose}
              onMoved={setMoved}
              className="h-full"
            />
          </Suspense>
        </ErrorBoundary>
        {moved && (
          <Button
            size="sm"
            className="absolute top-3 left-1/2 -translate-x-1/2 shadow-md"
            onClick={() => {
              setArea({ ...moved, label: 'this area' })
              if (reach === 'all') setReach(10)
              setMoved(null)
              setSelected(null)
            }}
          >
            <LocateFixed aria-hidden="true" />
            Search this area
          </Button>
        )}
      </div>
    </div>
  )
}

function ResultRow({
  place,
  number,
  showDistance,
  onChoose,
}: {
  place: Place
  number: number
  showDistance: boolean
  onChoose: () => void
}) {
  const { label, icon: Icon, color } = CATEGORY[place.category]
  const hours = place.opening_hours ? formatOpeningHours(place.opening_hours)[0] : null
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        className="flex w-full items-start gap-3 px-1 py-2.5 text-left outline-offset-[-2px] hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          className="type-data mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          {number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">{place.name}</span>
            {showDistance && place.distance_m !== null && (
              <span className="type-data shrink-0 text-xs text-ink-soft">{formatDistance(place.distance_m)}</span>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{[label, place.local_name].filter(Boolean).join(' · ')}</span>
          </span>
          {hours && <span className="type-data block truncate text-xs text-ink-soft">{hours}</span>}
        </span>
      </button>
    </li>
  )
}

function AddPlace({
  place,
  days,
  initial,
  saving,
  onAdd,
}: {
  place: Place
  days: Day[]
  initial: Partial<ActivityDraft>
  saving: boolean
  onAdd: Props['onAdd']
}) {
  const [draft, setDraft] = useState(() => draftFromPlace(place, initial))
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const problem = validateDraft(draft)
        if (problem) return setError(problem)
        onAdd(place, draft)
      }}
    >
      <ActivityFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} days={days} compact />
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? 'Adding…' : draft.day ? `Add to ${shortDate(draft.day)}` : 'Save as an idea'}
      </Button>
    </form>
  )
}
