import { Plus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AirportPicker } from '@/components/people/airport-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNearbyAirports, useSaveRoute, type FlightRoute, type RouteInput } from '@/lib/api/flights'
import type { Trip } from '@/lib/api/trips'
import { formatMiles } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { defaultRoute, returnMode, validateRoute, withReturnMode } from './route-form'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; trip: Trip; route?: FlightRoute }

export function RouteEditor({ open, onOpenChange, trip, route }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <RouteForm trip={trip} route={route} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  )
}

function Segmented<T extends string | number | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
            value === option.value ? 'border-brand bg-brand-soft font-semibold text-brand' : 'hover:bg-accent',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function toRouteInput(route: FlightRoute): RouteInput {
  const { id: _id, trip_id: _trip, created_at: _c, updated_at: _u, ...input } = route
  return input
}

function RouteForm({ trip, route, onDone }: { trip: Trip; route?: FlightRoute; onDone: () => void }) {
  const save = useSaveRoute(trip.id, route?.id)
  const [draft, setDraft] = useState<RouteInput>(() => (route ? toRouteInput(route) : defaultRoute(trip)))
  const [error, setError] = useState<string | null>(null)
  const firstDestination = trip.destinations[0]
  const nearby = useNearbyAirports(firstDestination?.lat, firstDestination?.lon)
  const suggestions = (nearby.data ?? []).filter((a) => !draft.destination_codes.includes(a.iata))

  const update = (patch: Partial<RouteInput>) => setDraft((d) => ({ ...d, ...patch }))
  const mode = returnMode(draft)
  const sources = draft.sources ?? []

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateRoute(draft)
    if (problem) return setError(problem)
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(route ? 'Route updated' : 'Route added. Checking prices now.')
        onDone()
      },
      onError: (e) => setError(e.message),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">{route ? 'Edit route' : 'Track a route'}</DialogTitle>
        <DialogDescription>
          Pick airports and flexible dates. Prices are checked on a schedule and every check is kept, so you can see
          the trend.
        </DialogDescription>
      </DialogHeader>

      <form id="route-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="From" htmlFor="route-from" hint="Up to 4 airports, searched together.">
            <AirportPicker
              inputId="route-from"
              value={draft.origin_codes}
              max={4}
              onChange={(origin_codes) => update({ origin_codes })}
            />
          </Field>
          <Field label="To" htmlFor="route-to">
            <AirportPicker
              inputId="route-to"
              value={draft.destination_codes}
              max={4}
              onChange={(destination_codes) => update({ destination_codes })}
            />
            {suggestions.length > 0 && draft.destination_codes.length < 4 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-ink-soft">Near {firstDestination?.name}:</span>
                {suggestions.map((a) => (
                  <button
                    key={a.iata}
                    type="button"
                    onClick={() => update({ destination_codes: [...draft.destination_codes, a.iata] })}
                    className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent"
                    title={`${a.name} · ${formatMiles(a.distance_km * 1000)} away`}
                  >
                    <Plus className="size-3" aria-hidden="true" />
                    <span className="type-code">{a.iata}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
        </div>

        <Field label="Trip type">
          <Segmented
            label="Trip type"
            value={draft.trip_type ?? 'round_trip'}
            options={[
              { value: 'round_trip', label: 'Round trip' },
              { value: 'one_way', label: 'One way' },
            ]}
            onChange={(trip_type) =>
              setDraft((d) =>
                trip_type === 'one_way'
                  ? { ...d, trip_type, return_from: null, return_to: null, min_nights: null, max_nights: null }
                  : withReturnMode({ ...d, trip_type }, 'nights'),
              )
            }
          />
        </Field>

        <Field label="Leave between" hint="Any day in this window. Up to 60 days.">
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              aria-label="Earliest departure"
              value={draft.depart_from}
              onChange={(e) => update({ depart_from: e.target.value })}
            />
            <Input
              type="date"
              aria-label="Latest departure"
              value={draft.depart_to}
              min={draft.depart_from}
              onChange={(e) => update({ depart_to: e.target.value })}
            />
          </div>
        </Field>

        {draft.trip_type !== 'one_way' && (
          <Field label="Coming back">
            <div className="space-y-3">
              <Segmented
                label="Return by"
                value={mode}
                options={[
                  { value: 'nights', label: 'Trip length' },
                  { value: 'window', label: 'Return dates' },
                ]}
                onChange={(next) => setDraft((d) => withReturnMode(d, next))}
              />
              {mode === 'nights' ? (
                <div className="flex items-center gap-2 text-sm">
                  <Input
                    type="number"
                    aria-label="Fewest nights"
                    className="w-20"
                    min={1}
                    max={60}
                    value={draft.min_nights ?? ''}
                    onChange={(e) => update({ min_nights: Number(e.target.value) || null })}
                  />
                  to
                  <Input
                    type="number"
                    aria-label="Most nights"
                    className="w-20"
                    min={1}
                    max={60}
                    value={draft.max_nights ?? ''}
                    onChange={(e) => update({ max_nights: Number(e.target.value) || null })}
                  />
                  nights
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="date"
                    aria-label="Earliest return"
                    value={draft.return_from ?? ''}
                    onChange={(e) => update({ return_from: e.target.value || null })}
                  />
                  <Input
                    type="date"
                    aria-label="Latest return"
                    value={draft.return_to ?? ''}
                    min={draft.return_from ?? undefined}
                    onChange={(e) => update({ return_to: e.target.value || null })}
                  />
                </div>
              )}
            </div>
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Adults" htmlFor="route-adults">
            <Input
              id="route-adults"
              type="number"
              min={1}
              max={9}
              value={draft.adults ?? 1}
              onChange={(e) => update({ adults: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
          <Field label="Children" htmlFor="route-children">
            <Input
              id="route-children"
              type="number"
              min={0}
              max={8}
              value={draft.children ?? 0}
              onChange={(e) => update({ children: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <Field label="Cabin" htmlFor="route-cabin">
            <select
              id="route-cabin"
              value={draft.cabin ?? 'economy'}
              onChange={(e) => update({ cabin: e.target.value as RouteInput['cabin'] })}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          </Field>
        </div>

        <Field label="Stops">
          <Segmented
            label="Stops"
            value={draft.max_stops ?? null}
            options={[
              { value: null, label: 'Any' },
              { value: 0, label: 'Nonstop only' },
              { value: 1, label: 'Up to 1 stop' },
              { value: 2, label: 'Up to 2 stops' },
            ]}
            onChange={(max_stops) => update({ max_stops })}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Where to look</legend>
          {[
            { key: 'serpapi' as const, label: 'Google Flights', hint: 'Live prices; uses your SerpApi searches' },
            { key: 'travelpayouts' as const, label: 'Aviasales', hint: 'Recent fares other travelers found; free' },
          ].map((source) => (
            <label key={source.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--tp-brand)]"
                checked={sources.includes(source.key)}
                onChange={(e) =>
                  update({
                    sources: e.target.checked ? [...sources, source.key] : sources.filter((s) => s !== source.key),
                  })
                }
              />
              <span>
                <span className="font-semibold">{source.label}</span>
                <span className="text-ink-soft"> · {source.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name (optional)" htmlFor="route-label">
            <Input
              id="route-label"
              maxLength={80}
              placeholder="Outbound to Tokyo"
              value={draft.label ?? ''}
              onChange={(e) => update({ label: e.target.value || null })}
            />
          </Field>
          <Field label={`Alert below (${trip.home_currency}, optional)`} htmlFor="route-alert">
            <Input
              id="route-alert"
              type="number"
              min={1}
              step={1}
              value={draft.alert_price ?? ''}
              onChange={(e) => update({ alert_price: e.target.value || null })}
            />
          </Field>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" form="route-form" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : route ? 'Save route' : 'Track route'}
        </Button>
      </DialogFooter>
    </>
  )
}
