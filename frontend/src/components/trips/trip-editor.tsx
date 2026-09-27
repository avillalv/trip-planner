import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAppSettings } from '@/lib/api/settings'
import { toTripInput, useDeleteTrip, useSaveTrip, type Trip, type TripInput } from '@/lib/api/trips'
import { currencyOptions } from '@/lib/currencies'
import { STATUS_LABELS, TRIP_STATUSES } from '@/lib/trip-status'
import { cn } from '@/lib/utils'
import { DestinationPicker } from './destination-picker'
import { TravelerPicker } from './traveler-picker'
import { emptyTripInput, validateTrip, withDestinations } from './trip-form'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; trip?: Trip }

export function TripEditor({ open, onOpenChange, trip }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {/* Dialog content unmounts when closed, so the form starts fresh on every open. */}
        <TripEditorForm trip={trip} onDone={() => onOpenChange(false)} />
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

function TripEditorForm({ trip, onDone }: { trip?: Trip; onDone: () => void }) {
  const navigate = useNavigate()
  const settings = useAppSettings()
  const save = useSaveTrip(trip?.id)
  const remove = useDeleteTrip()
  const [draft, setDraft] = useState<TripInput>(() =>
    trip ? toTripInput(trip) : emptyTripInput(settings.data?.home_currency ?? 'USD'),
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // A chosen flight fixes the trip's dates (the end too, unless it's a single one-way flight).
  const fromFlight = trip?.flight_dates ?? null

  const update = (patch: Partial<TripInput>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateTrip(draft)
    if (problem) return setError(problem)
    save.mutate(
      { ...draft, name: draft.name.trim() },
      {
        onSuccess: (saved) => {
          toast.success(trip ? 'Changes saved' : 'Trip created')
          onDone()
          if (!trip) navigate(`/trips/${saved.id}`)
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  const deleteTrip = () => {
    if (!trip) return
    remove.mutate(trip.id, {
      onSuccess: () => {
        toast.success(`Deleted ${trip.name}`)
        onDone()
        navigate('/')
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">{trip ? 'Edit trip' : 'New trip'}</DialogTitle>
        <DialogDescription>
          {trip ? 'Changes apply to flights, days, and places saved for this trip.' : 'You can change any of this later.'}
        </DialogDescription>
      </DialogHeader>

      <form id="trip-form" onSubmit={submit} className="space-y-5" noValidate>
        <Field label="Where to?" htmlFor="trip-destination">
          <DestinationPicker
            inputId="trip-destination"
            value={draft.destinations ?? []}
            onChange={(destinations) => setDraft((d) => withDestinations(d, destinations))}
          />
        </Field>

        <Field label="Trip name" htmlFor="trip-name">
          <Input
            id="trip-name"
            value={draft.name}
            maxLength={120}
            placeholder="Japan in autumn"
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>

        <Field label="Dates" hint={fromFlight ? undefined : "Leave both empty if you haven't picked dates yet."}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="trip-start" className="text-xs text-ink-soft">
                Start
              </Label>
              <Input
                id="trip-start"
                type="date"
                disabled={fromFlight !== null}
                value={draft.start_date ?? ''}
                onChange={(e) => {
                  const start = e.target.value || null
                  update({ start_date: start, end_date: draft.end_date ?? start })
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trip-end" className="text-xs text-ink-soft">
                End
              </Label>
              <Input
                id="trip-end"
                type="date"
                disabled={fromFlight?.end != null}
                value={draft.end_date ?? ''}
                min={draft.start_date ?? undefined}
                onChange={(e) => update({ end_date: e.target.value || null })}
              />
            </div>
          </div>
          {fromFlight && trip && (
            <p className="text-xs text-ink-soft">
              Set by your flight (
              {fromFlight.flights
                .map((f) => `${f.origin} → ${f.destination}${f.airlines.length ? `, ${f.airlines.join(', ')}` : ''}`)
                .join('; ')}
              ). To change {fromFlight.end ? 'them' : 'the start'}, choose another flight on the{' '}
              <Link to={`/trips/${trip.id}/flights`} onClick={onDone} className="font-semibold text-brand underline-offset-2 hover:underline">
                Flights page
              </Link>
              , or clear it there.
            </p>
          )}
        </Field>

        <Field label="Who's going?">
          <TravelerPicker selected={draft.traveler_ids ?? []} onChange={(traveler_ids) => update({ traveler_ids })} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Status">
            <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
              {TRIP_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  role="radio"
                  aria-checked={draft.status === status}
                  onClick={() => update({ status })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
                    draft.status === status ? 'border-brand bg-brand-soft font-semibold text-brand' : 'hover:bg-accent',
                  )}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Currency" htmlFor="trip-currency" hint="Prices for this trip are shown in this currency.">
            <select
              id="trip-currency"
              value={draft.home_currency}
              onChange={(e) => update({ home_currency: e.target.value })}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {currencyOptions().map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Notes" htmlFor="trip-notes">
          <Textarea
            id="trip-notes"
            rows={3}
            value={draft.notes ?? ''}
            maxLength={10_000}
            placeholder="Anything you both want to remember"
            onChange={(e) => update({ notes: e.target.value })}
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <DialogFooter className="gap-2 sm:justify-between">
        {trip ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            Delete trip
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form="trip-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : trip ? 'Save changes' : 'Create trip'}
          </Button>
        </div>
      </DialogFooter>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {trip?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the trip with its flights, itinerary, and places to stay. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep trip</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteTrip} disabled={remove.isPending}>
              Delete trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
