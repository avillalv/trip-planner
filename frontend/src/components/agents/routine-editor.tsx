import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AGENT_KINDS, useCreateRoutine, useEditRoutine, type AgentKind, type Routine } from '@/lib/api/agents'
import { useRoutes, type FlightRoute } from '@/lib/api/flights'
import { useTrips } from '@/lib/api/trips'
import { AGENT_SCHEDULES } from '@/lib/schedules'
import { cn } from '@/lib/utils'
import {
  CUSTOM,
  DEFAULT_TOPIC,
  KIND_INFO,
  draftFromRoutine,
  newDraft,
  runsPerMonth,
  toCreate,
  toUpdate,
  validateDraft,
  withKind,
  type RoutineDraft,
} from './routine-form'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this routine; otherwise create a new one. */
  routine?: Routine
  kind?: AgentKind
  tripId?: number | null
}

export function RoutineEditor({ open, onOpenChange, routine, kind = 'flight_agent', tripId = null }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        {/* Mounted per opening, so the form starts from the routine as it is now. */}
        {open && (
          <RoutineForm
            initial={routine ? draftFromRoutine(routine) : newDraft(kind, tripId)}
            routineId={routine?.id}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
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

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function routeName(route: FlightRoute): string {
  return route.label || `${route.origin_codes.join(', ')} → ${route.destination_codes.join(', ')}`
}

function RouteChoice({ tripId, value, onChange }: { tripId: number; value: number[]; onChange: (ids: number[]) => void }) {
  const routes = useRoutes(tripId)
  const active = (routes.data ?? []).filter((r) => r.active)
  if (routes.isPending) return <p className="text-sm text-ink-soft">Loading routes…</p>
  if (active.length === 0) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        This trip has no flight routes yet.{' '}
        <Link to={`/trips/${tripId}/flights`} className="font-semibold text-brand underline-offset-2 hover:underline">
          Add one on the Flights page
        </Link>{' '}
        first; the agent searches the trip's routes.
      </p>
    )
  }
  const all = value.length === 0
  const toggle = (id: number, checked: boolean) => {
    const current = all ? active.map((r) => r.id) : value
    const next = checked ? [...current, id] : current.filter((x) => x !== id)
    // Every route checked is stored as "all", so routes added later are searched too.
    onChange(next.length === active.length ? [] : next)
  }
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold">Routes to search</legend>
      {active.map((route) => {
        const checked = all || value.includes(route.id)
        // At least one route stays checked.
        const lastChecked = checked && (all ? active.length === 1 : value.length === 1)
        return (
          <label key={route.id} className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--tp-brand)]"
              checked={checked}
              disabled={lastChecked}
              onChange={(e) => toggle(route.id, e.target.checked)}
            />
            {routeName(route)}
          </label>
        )
      })}
      <p className="text-xs text-ink-soft">
        {all ? 'All routes, including ones you add later.' : 'Only the checked routes.'}
      </p>
    </fieldset>
  )
}

function RoutineForm({ initial, routineId, onDone }: { initial: RoutineDraft; routineId?: number; onDone: () => void }) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const trips = useTrips()
  const create = useCreateRoutine()
  const edit = useEditRoutine()
  const editing = routineId !== undefined
  const pending = create.isPending || edit.isPending
  const update = (patch: Partial<RoutineDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const tripName = trips.data?.find((t) => t.id === draft.tripId)?.name
  const perMonth = runsPerMonth(draft)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validateDraft(draft)
    if (problem) return setError(problem)
    const onError = (e: Error) => setError(e.message)
    if (editing) {
      edit.mutate(
        { routineId, ...toUpdate(draft) },
        {
          onSuccess: () => {
            toast.success('Routine saved')
            onDone()
          },
          onError,
        },
      )
    } else {
      create.mutate(toCreate(draft), {
        onSuccess: (routine) => {
          toast.success(routine.enabled ? `${routine.name} created. It runs on its schedule.` : `${routine.name} created`)
          onDone()
        },
        onError,
      })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="type-heading text-xl">{editing ? 'Edit routine' : 'New agent routine'}</DialogTitle>
        <DialogDescription>
          Claude works through this on its schedule and saves what it finds, with links, for you to review.
        </DialogDescription>
      </DialogHeader>

      <form id="routine-form" onSubmit={submit} className="space-y-5" noValidate>
        {editing ? (
          <p className="text-sm">
            <span className="font-semibold">{KIND_INFO[draft.kind].label}</span>
            {tripName && <span className="text-ink-soft"> for {tripName}</span>}
          </p>
        ) : (
          <>
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold">What it does</legend>
              <div role="radiogroup" aria-label="What it does" className="grid gap-2 sm:grid-cols-2">
                {AGENT_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === kind}
                    onClick={() => setDraft((d) => withKind(d, kind))}
                    className={cn(
                      'rounded-xl border p-3 text-left outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      draft.kind === kind ? 'border-brand bg-brand-soft' : 'hover:bg-accent',
                    )}
                  >
                    <span className={cn('block font-semibold', draft.kind === kind && 'text-brand')}>
                      {KIND_INFO[kind].label}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{KIND_INFO[kind].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="Trip" htmlFor="routine-trip">
              <select
                id="routine-trip"
                className={selectClass}
                value={draft.tripId ?? ''}
                onChange={(e) => update({ tripId: e.target.value ? Number(e.target.value) : null, routeIds: [] })}
              >
                <option value="">Choose a trip…</option>
                {(trips.data ?? []).map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label="Name" htmlFor="routine-name">
          <Input id="routine-name" value={draft.name} maxLength={80} onChange={(e) => update({ name: e.target.value })} />
        </Field>

        {draft.kind === 'flight_agent' && draft.tripId !== null && (
          <RouteChoice tripId={draft.tripId} value={draft.routeIds} onChange={(routeIds) => update({ routeIds })} />
        )}

        {draft.kind === 'research_agent' && (
          <Field label="Topic" htmlFor="routine-topic" hint="What Claude should look into. Each finding becomes a note on the trip.">
            <Textarea
              id="routine-topic"
              rows={3}
              maxLength={300}
              placeholder={DEFAULT_TOPIC}
              value={draft.topic}
              onChange={(e) => update({ topic: e.target.value })}
            />
          </Field>
        )}

        <Field
          label="Anything else it should know (optional)"
          htmlFor="routine-instructions"
          hint="For example: “We prefer nonstop flights” or “Skip overnight layovers.”"
        >
          <Textarea
            id="routine-instructions"
            rows={2}
            maxLength={2000}
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </Field>

        <Field
          label="When it runs"
          htmlFor="routine-schedule"
          hint={perMonth ? `About ${perMonth} runs a month on your Claude subscription.` : 'Five-part cron, in this PC’s time zone.'}
        >
          <select
            id="routine-schedule"
            className={selectClass}
            value={draft.schedule}
            onChange={(e) => update({ schedule: e.target.value })}
          >
            {AGENT_SCHEDULES.map((preset) => (
              <option key={preset.cron} value={preset.cron}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom schedule…</option>
          </select>
          {draft.schedule === CUSTOM && (
            <Input
              aria-label="Custom schedule"
              className="type-data mt-2"
              placeholder="0 7 * * *"
              value={draft.customCron}
              onChange={(e) => update({ customCron: e.target.value })}
            />
          )}
        </Field>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-semibold">Run on schedule</span>
              <span className="block text-xs text-ink-soft">Off keeps the routine for running by hand.</span>
            </span>
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-semibold">Catch up after the PC was off</span>
              <span className="block text-xs text-ink-soft">Runs once when the app starts if it missed a scheduled time.</span>
            </span>
            <Switch checked={draft.catchUp} onCheckedChange={(catchUp) => update({ catchUp })} />
          </label>
        </div>

        <details className="rounded-lg border px-3 py-2 text-sm [&[open]>summary]:mb-3">
          <summary className="cursor-pointer font-semibold">Limits</summary>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max turns" htmlFor="routine-turns" hint={`Default ${KIND_INFO[draft.kind].turns}`}>
              <Input
                id="routine-turns"
                inputMode="numeric"
                placeholder={String(KIND_INFO[draft.kind].turns)}
                value={draft.maxTurns}
                onChange={(e) => update({ maxTurns: e.target.value })}
              />
            </Field>
            <Field label="Time limit (minutes)" htmlFor="routine-minutes" hint={`Default ${KIND_INFO[draft.kind].minutes}`}>
              <Input
                id="routine-minutes"
                inputMode="numeric"
                placeholder={String(KIND_INFO[draft.kind].minutes)}
                value={draft.timeoutMin}
                onChange={(e) => update({ timeoutMin: e.target.value })}
              />
            </Field>
          </div>
        </details>

        {error && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        )}
      </form>

      <DialogFooter className="items-center sm:justify-between">
        <p className="text-xs text-ink-soft">Every run uses the Sonnet model.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form="routine-form" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save routine' : 'Create routine'}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
