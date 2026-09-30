import { Loader2, PartyPopper, Sparkles, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { InterestsEditor } from '@/components/trips/interests-editor'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { isRunning, useStopRun } from '@/lib/api/agents'
import { useRunEvents, type Run } from '@/lib/api/flights'
import { useActivities, type Day } from '@/lib/api/itinerary'
import {
  useAddSuggestion,
  useAskForIdeas,
  useDismissSuggestion,
  useLatestAiRun,
  useSuggestions,
  type Suggestion,
  type SuggestionMode,
} from '@/lib/api/suggestions'
import type { Trip } from '@/lib/api/trips'
import { formatElapsed, timeAgo } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { dayOptionLabel, shortDate } from './labels'
import { SuggestionCard } from './suggestion-card'

const MODE_LABEL: Record<SuggestionMode, string> = { brainstorm: 'Brainstorm', surprise: 'Surprise me' }

const selectClass =
  'h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

type Props = {
  trip: Trip
  days: Day[]
  /** The day page's day: it starts as the day to plan and its ideas are listed first. */
  day?: string
}

/** "Plan with AI": a button that opens a panel where Claude suggests things to do, each with a best day and time. */
export function AiPlannerSheet({ trip, days, day }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Sparkles aria-hidden="true" />
          Plan with AI
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="p-4 pr-12">
          <SheetTitle className="type-heading">Plan with AI</SheetTitle>
          <SheetDescription>
            Claude suggests things to do that fit your interests, each day's weather, and your plans, with the best day
            and time for each.
          </SheetDescription>
        </SheetHeader>
        <Planner trip={trip} days={days} day={day} />
      </SheetContent>
    </Sheet>
  )
}

/** Only mounted while the panel is open, so nothing is fetched or polled until someone looks. */
function Planner({ trip, days, day }: Props) {
  const { run, isPending } = useLatestAiRun(trip.id, 'itinerary_agent')
  const working = run !== undefined && isRunning(run.status)
  const suggestions = useSuggestions(trip.id, working)
  const list = suggestions.data ?? []
  const fresh = list.filter((s) => s.status === 'new')
  const added = list.filter((s) => s.status === 'added')

  return (
    <div className="space-y-6 px-4 pb-8">
      <section aria-labelledby="interests-heading" className="space-y-2">
        <h3 id="interests-heading" className="font-semibold">
          Your interests
        </h3>
        <InterestsEditor tripId={trip.id} interests={trip.interests} />
      </section>

      <AskForm trip={trip} days={days} preset={day} busy={working || isPending} />

      {run && working && <Working run={run} />}
      {run && !working && <Outcome run={run} />}

      {suggestions.isPending ? (
        <Skeleton className="h-32" />
      ) : fresh.length === 0 && added.length === 0 && !run ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-ink-soft">
          Nothing here yet. Tell Claude what you're in the mood for, or let it surprise you.
        </p>
      ) : (
        <Cards tripId={trip.id} fresh={fresh} added={added} day={day} />
      )}
    </div>
  )
}

function AskForm({ trip, days, preset, busy }: { trip: Trip; days: Day[]; preset?: string; busy: boolean }) {
  const ask = useAskForIdeas(trip.id)
  const [message, setMessage] = useState('')
  const [dayValue, setDayValue] = useState(preset ?? '')
  const [error, setError] = useState<string | null>(null)
  const noDates = !trip.start_date || !trip.end_date
  const disabled = busy || ask.isPending || noDates

  const send = (mode: SuggestionMode) => {
    setError(null)
    ask.mutate(
      { mode, message: message.trim() || null, day: dayValue || null },
      { onSuccess: () => setMessage(''), onError: (e) => setError(e.message) },
    )
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!disabled) send('brainstorm')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="ai-mood" className="text-sm font-semibold">
          What are you in the mood for?
        </Label>
        <Textarea
          id="ai-mood"
          rows={3}
          maxLength={1000}
          placeholder="A rainy-day plan near the volcano, the best street food, where to thrift streetwear…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-day" className="text-sm font-semibold">
          Day
        </Label>
        <select id="ai-day" value={dayValue} onChange={(e) => setDayValue(e.target.value)} className={selectClass}>
          <option value="">Any day</option>
          {days
            .filter((d) => d.in_trip)
            .map((d) => (
              <option key={d.day} value={d.day}>
                {dayOptionLabel(d)}
              </option>
            ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled}>
          <Sparkles aria-hidden="true" />
          Brainstorm
        </Button>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => send('surprise')}>
          <PartyPopper aria-hidden="true" />
          Surprise me
        </Button>
      </div>
      {noDates && <p className="text-sm text-ink-soft">Set the trip's dates first, so ideas can be placed on days.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function Working({ run }: { run: Run }) {
  const events = useRunEvents(run.id, true)
  const stop = useStopRun()
  const now = useNow(1_000)
  const latest = events.data?.at(-1)?.summary
  const since = new Date(run.started_at ?? run.queued_at).getTime()

  return (
    <div role="status" className="space-y-2 rounded-xl border bg-card p-4">
      <p className="flex items-center gap-2 font-semibold">
        <Loader2 className="size-4 animate-spin text-violet" aria-hidden="true" />
        {run.status === 'queued' ? 'Waiting to start…' : 'Claude is working on it…'}
      </p>
      {latest && <p className="text-sm text-ink-soft">{latest}</p>}
      <p className="text-sm text-ink-soft">
        This usually takes a few minutes. You can close this panel; ideas appear here as Claude saves them.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <span className="type-data text-xs text-ink-soft">{formatElapsed(now.getTime() - since)} so far</span>
        <Button
          variant="outline"
          size="sm"
          disabled={run.cancel_requested || stop.isPending}
          onClick={() => stop.mutate(run.id, { onError: (e) => toast.error(e.message) })}
        >
          {run.cancel_requested ? 'Stopping…' : 'Stop'}
        </Button>
        <Link to={`/agents/runs/${run.id}`} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
          See the full log
        </Link>
      </div>
    </div>
  )
}

/** How the latest finished request went: Claude's reply, or why it didn't finish. */
function Outcome({ run }: { run: Run }) {
  if (run.status === 'failed' || run.status === 'timed_out' || run.status === 'interrupted') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p>{run.error ?? "Claude couldn't finish that request. Try again."}</p>
          <Link to={`/agents/runs/${run.id}`} className="font-semibold text-brand underline-offset-2 hover:underline">
            See the full log
          </Link>
        </div>
      </div>
    )
  }
  if (!run.summary || (run.status !== 'succeeded' && run.status !== 'partial')) return null
  const mode: SuggestionMode = run.params.mode === 'surprise' ? 'surprise' : 'brainstorm'
  const asked = typeof run.params.message === 'string' ? run.params.message : null
  return (
    <figure className="space-y-1.5 rounded-xl border-l-4 border-brand bg-muted/50 p-4">
      <figcaption className="type-label text-ink-soft">
        Claude · {MODE_LABEL[mode]} · {timeAgo(run.finished_at ?? run.queued_at)}
      </figcaption>
      {asked && <p className="text-xs text-ink-soft">You asked: “{asked}”</p>}
      <blockquote className="leading-relaxed whitespace-pre-wrap">{run.summary}</blockquote>
    </figure>
  )
}

type Group = { key: string; title?: string; items: Suggestion[] }

/** Newest run first (the list arrives that way). On a day's page, that day's own ideas come first. */
function groupSuggestions(fresh: Suggestion[], day?: string): Group[] {
  if (day) {
    const forDay = fresh.filter((s) => s.day === day)
    const others = fresh.filter((s) => s.day !== day)
    return [
      { key: 'day', title: 'For this day', items: forDay },
      { key: 'other', title: 'Other ideas', items: others },
    ].filter((g) => g.items.length > 0)
  }
  const byRun = new Map<string, Suggestion[]>()
  for (const s of fresh) byRun.set(s.run_id ?? 'none', [...(byRun.get(s.run_id ?? 'none') ?? []), s])
  const many = byRun.size > 1
  return [...byRun].map(([key, items]) => ({
    key,
    title: many ? `${MODE_LABEL[items[0].mode]} · ${timeAgo(items[0].created_at)}` : undefined,
    items,
  }))
}

function Cards({ tripId, fresh, added, day }: { tripId: number; fresh: Suggestion[]; added: Suggestion[]; day?: string }) {
  const add = useAddSuggestion(tripId)
  const dismiss = useDismissSuggestion(tripId)
  const activities = useActivities(tripId)
  const busyId = add.isPending ? add.variables?.id : undefined

  const onAdd = (s: Suggestion, asIdea: boolean) =>
    add.mutate(
      { id: s.id, asIdea },
      {
        onSuccess: (activity) => toast.success(activity.day ? `Added to ${shortDate(activity.day)}` : 'Saved as an idea'),
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <div className="space-y-6">
      {groupSuggestions(fresh, day).map((group) => (
        <section key={group.key} className="space-y-3" aria-label={group.title ?? 'Suggestions'}>
          {group.title && <h3 className="type-label text-ink-soft">{group.title}</h3>}
          <ul className="space-y-3">
            {group.items.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                busy={busyId === s.id}
                onAdd={(asIdea) => onAdd(s, asIdea)}
                onDismiss={() => dismiss.mutate(s.id, { onError: (e) => toast.error(e.message) })}
              />
            ))}
          </ul>
        </section>
      ))}
      {added.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Added ({added.length})</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {added.map((s) => {
              const activity = activities.data?.find((a) => a.id === s.activity_id)
              return (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold">{s.title}</span>
                  {activity?.day ? (
                    <Link
                      to={`/trips/${tripId}/itinerary/${activity.day}`}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      {shortDate(activity.day)}
                    </Link>
                  ) : (
                    activity && <span className="text-ink-soft">In your ideas</span>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
