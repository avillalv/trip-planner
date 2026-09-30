import { Plus, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRecordBookedFlight, type FlightRoute } from '@/lib/api/flights'
import type { Trip } from '@/lib/api/trips'
import { currencyOptions } from '@/lib/currencies'
import { formatDateRange } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { emptyLeg, newBookedDraft, toBookedRequest, validateBooked, type BookedDraft, type LegDraft } from './booked-flight-form'

type Props = {
  /** The route being booked, or null while closed. */
  routeId: number | null
  routes: FlightRoute[]
  trip: Trip
  onClose: () => void
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function Field({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      {children}
    </div>
  )
}

/** Record the flight the travelers booked, leg by leg, as printed on the ticket. */
export function BookedFlightDialog({ routeId, routes, trip, onClose }: Props) {
  return (
    <Dialog open={routeId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {routeId !== null && <BookedFlightForm initialRouteId={routeId} routes={routes} trip={trip} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function routeName(route: FlightRoute): string {
  return route.label || `${route.origin_codes.join(', ')} → ${route.destination_codes.join(', ')}`
}

function BookedFlightForm({ initialRouteId, routes, trip, onDone }: { initialRouteId: number; routes: FlightRoute[]; trip: Trip; onDone: () => void }) {
  const record = useRecordBookedFlight()
  const [routeId, setRouteId] = useState(initialRouteId)
  const [draft, setDraft] = useState<BookedDraft>(() => newBookedDraft(routes.find((r) => r.id === initialRouteId) ?? routes[0], trip))
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<BookedDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const updateLeg = (index: number, patch: Partial<LegDraft>) =>
    setDraft((d) => ({ ...d, legs: d.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) }))
  // A new leg goes after the last one going that way, starting where that one lands.
  const addLeg = (direction: LegDraft['direction']) =>
    setDraft((d) => {
      const last = d.legs.findLastIndex((l) => l.direction === direction)
      const at = last >= 0 ? last + 1 : direction === 'out' ? 0 : d.legs.length
      const legs = [...d.legs]
      legs.splice(at, 0, emptyLeg(direction, last >= 0 ? d.legs[last].to : undefined))
      return { ...d, legs }
    })
  const removeLeg = (index: number) => setDraft((d) => ({ ...d, legs: d.legs.filter((_, i) => i !== index) }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateBooked(draft)
    if (problem) return setError(problem)
    setError(null)
    record.mutate(
      { routeId, body: toBookedRequest(draft) },
      {
        onSuccess: (saved) => {
          toast.success(
            saved.start_date && saved.end_date
              ? `Booked flight saved. The trip is now ${formatDateRange(saved.start_date, saved.end_date)}.`
              : 'Booked flight saved',
          )
          onDone()
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">Add booked flight</DialogTitle>
        <DialogDescription>
          Enter each leg as printed on your ticket; times are local at each airport. The trip’s dates follow this
          flight, each leg is added to the itinerary, and price checks for the route stop. Saving replaces a booked
          flight you entered before.
        </DialogDescription>
      </DialogHeader>

      <form id="booked-flight-form" onSubmit={submit} className="space-y-5" noValidate>
        {routes.length > 1 && (
          <Field label="Route" htmlFor="booked-route">
            <select id="booked-route" value={routeId} onChange={(e) => setRouteId(Number(e.target.value))} className={selectClass}>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {routeName(r)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Airline" htmlFor="booked-airline">
            <Input id="booked-airline" maxLength={60} placeholder="Copa Airlines" value={draft.airline} onChange={(e) => update({ airline: e.target.value })} />
          </Field>
          <Field label="Price per person" htmlFor="booked-price">
            <div className="flex gap-2">
              <Input id="booked-price" inputMode="decimal" placeholder="374.89" value={draft.price} onChange={(e) => update({ price: e.target.value })} />
              <select aria-label="Currency" value={draft.currency} onChange={(e) => update({ currency: e.target.value })} className={cn(selectClass, 'w-24 shrink-0')}>
                {currencyOptions().map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Travelers" htmlFor="booked-travelers">
            <Input id="booked-travelers" type="number" min={1} max={17} value={draft.travelers} onChange={(e) => update({ travelers: e.target.value })} />
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Legs</legend>
          {draft.legs.map((leg, i) => (
            <div key={i} role="group" aria-label={`Leg ${i + 1}`} className="grid grid-cols-2 gap-3 rounded-lg border p-3 sm:grid-cols-6">
              <Field label="Direction" htmlFor={`leg-${i}-direction`} className="sm:col-span-2">
                <select
                  id={`leg-${i}-direction`}
                  value={leg.direction}
                  onChange={(e) => updateLeg(i, { direction: e.target.value as LegDraft['direction'] })}
                  className={selectClass}
                >
                  <option value="out">Outbound</option>
                  <option value="back">Return</option>
                </select>
              </Field>
              <Field label="Flight number" htmlFor={`leg-${i}-number`} className="sm:col-span-2">
                <Input id={`leg-${i}-number`} maxLength={10} placeholder="CM 467" value={leg.flightNumber} onChange={(e) => updateLeg(i, { flightNumber: e.target.value })} />
              </Field>
              <Field label="From" htmlFor={`leg-${i}-from`}>
                <Input id={`leg-${i}-from`} maxLength={3} placeholder="RDU" className="uppercase" value={leg.from} onChange={(e) => updateLeg(i, { from: e.target.value })} />
              </Field>
              <Field label="To" htmlFor={`leg-${i}-to`}>
                <Input id={`leg-${i}-to`} maxLength={3} placeholder="PTY" className="uppercase" value={leg.to} onChange={(e) => updateLeg(i, { to: e.target.value })} />
              </Field>
              <Field label="Departs" htmlFor={`leg-${i}-departs`} className="col-span-2 sm:col-span-3">
                <Input id={`leg-${i}-departs`} type="datetime-local" value={leg.departs} onChange={(e) => updateLeg(i, { departs: e.target.value })} />
              </Field>
              <Field label="Arrives" htmlFor={`leg-${i}-arrives`} className="col-span-2 sm:col-span-3">
                <div className="flex gap-2">
                  <Input id={`leg-${i}-arrives`} type="datetime-local" value={leg.arrives} onChange={(e) => updateLeg(i, { arrives: e.target.value })} />
                  {draft.legs.length > 1 && (
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove leg ${i + 1}`} onClick={() => removeLeg(i)}>
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addLeg('out')}>
              <Plus aria-hidden="true" />
              Add an outbound leg
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addLeg('back')}>
              <Plus aria-hidden="true" />
              Add a return leg
            </Button>
          </div>
        </fieldset>

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
        <Button type="submit" form="booked-flight-form" disabled={record.isPending}>
          {record.isPending ? 'Saving…' : 'Save booked flight'}
        </Button>
      </DialogFooter>
    </>
  )
}
