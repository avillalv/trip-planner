import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  flightsKey,
  isActive,
  useCancelRun,
  useLatestRun,
  useRoutines,
  useRunEvents,
  useSerpApiUsage,
  useUpdateRoutine,
  type Routine,
} from '@/lib/api/flights'
import { timeAgo } from '@/lib/format'
import { PRICE_CHECK_SCHEDULES as SCHEDULES } from '@/lib/schedules'

const OFF = 'off'

const clock = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

function ScheduleSelect({ tripId, routine }: { tripId: number; routine: Routine }) {
  const update = useUpdateRoutine(tripId)
  const known = SCHEDULES.some((s) => s.cron === routine.schedule_cron)
  const value = routine.enabled ? routine.schedule_cron : OFF
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-soft">Automatic checks</span>
      <select
        value={value}
        disabled={update.isPending}
        onChange={(e) => {
          const next = e.target.value
          update.mutate(
            next === OFF ? { routineId: routine.id, enabled: false } : { routineId: routine.id, enabled: true, schedule_cron: next },
            { onError: (err) => toast.error(err.message) },
          )
        }}
        className="h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value={OFF}>Off</option>
        {SCHEDULES.map((s) => (
          <option key={s.cron} value={s.cron}>
            {s.label}
          </option>
        ))}
        {!known && <option value={routine.schedule_cron}>Custom ({routine.schedule_cron})</option>}
      </select>
      {routine.next_run_at && <span className="text-ink-soft">Next: {clock.format(new Date(routine.next_run_at))}</span>}
    </label>
  )
}

export function CheckStatus({ tripId }: { tripId: number }) {
  const queryClient = useQueryClient()
  const latest = useLatestRun(tripId)
  const run = latest.data ?? undefined
  const live = isActive(run)
  const events = useRunEvents(live ? run?.id : undefined, live)
  const cancel = useCancelRun(tripId)
  const routines = useRoutines(tripId)
  const usage = useSerpApiUsage()
  const flightRoutine = routines.data?.find((r) => r.kind === 'flight_api')
  const hasAgent = routines.data?.some((r) => r.kind === 'flight_agent') ?? false

  // When a check finishes, reload prices, charts, and quota.
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live) {
      void queryClient.invalidateQueries({ queryKey: flightsKey(tripId) })
      void queryClient.invalidateQueries({ queryKey: ['serpapi-usage'] })
      void queryClient.invalidateQueries({ queryKey: ['routines', tripId] })
    }
    wasLive.current = live
  }, [live, queryClient, tripId])

  const lastEvent = events.data?.at(-1)

  return (
    <section aria-label="Price checks" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div role="status" className="min-w-0 flex-1 text-sm">
          {live && run ? (
            <p className="flex items-start gap-2">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
              <span>
                <span className="font-semibold">{run.status === 'queued' ? 'Waiting to check prices…' : 'Checking prices…'}</span>
                {lastEvent && <span className="block text-ink-soft">{lastEvent.summary}</span>}
              </span>
            </p>
          ) : run ? (
            <p className="flex items-start gap-2">
              {run.status === 'succeeded' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              )}
              <span>
                <span className="font-semibold">Last check {timeAgo(run.finished_at ?? run.queued_at)}</span>
                <span className="block text-ink-soft">{run.summary ?? run.error ?? `Ended: ${run.status}`}</span>
              </span>
            </p>
          ) : (
            <p className="text-ink-soft">No price checks yet.</p>
          )}
        </div>
        {live && run && (
          <Button variant="outline" size="sm" onClick={() => cancel.mutate(run.id)} disabled={run.cancel_requested || cancel.isPending}>
            {run.cancel_requested ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3">
        {flightRoutine ? <ScheduleSelect tripId={tripId} routine={flightRoutine} /> : <span />}
        {usage.data && (
          <p className="text-xs text-ink-soft" title="Live Google Flights searches come from your free SerpApi plan (250 a month).">
            Live searches: <span className="type-data">{usage.data.remaining_today}</span> left today ·{' '}
            <span className="type-data">
              {usage.data.used_this_month} of {usage.data.monthly_cap}
            </span>{' '}
            used this month
          </p>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        {hasAgent ? 'Claude agents also look for fares on this trip.' : 'The price APIs miss some airlines and sales.'}{' '}
        <Link to={`/agents?trip=${tripId}`} className="font-semibold text-brand underline-offset-2 hover:underline">
          {hasAgent ? 'See agents' : 'Have Claude look for fares'}
        </Link>
      </p>
    </section>
  )
}
