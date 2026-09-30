import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ErrorBoundary, PartFailed } from '@/components/common/error-boundary'
import { ActivityEditor } from '@/components/itinerary/activity-editor'
import type { ActivityDraft } from '@/components/itinerary/activity-form'
import { AddActivityDialog } from '@/components/itinerary/add-activity-dialog'
import type { TimeChange } from '@/components/itinerary/day-calendar'
import { IdeasPanel } from '@/components/itinerary/ideas-panel'
import { longDate } from '@/components/itinerary/labels'
import { searchCenter } from '@/components/itinerary/search-center'
import { WeatherAttribution, WeatherChip } from '@/components/itinerary/weather-chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useActivities, useDays, useUpdateActivity, useUpdateDay, type Activity, type Day } from '@/lib/api/itinerary'
import { useTripWeather } from '@/lib/api/weather'
import { addMinutes, suggestStart } from '@/lib/itinerary-time'
import { NotFound } from '@/routes/errors'
import { useTripContext } from './trip-context'

const DayCalendar = lazy(() => import('@/components/itinerary/day-calendar'))

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : undefined)

/** Title and notes save when you leave the field. */
function useDayText(tripId: number, day: Day) {
  const save = useUpdateDay(tripId)
  const [title, setTitle] = useState(day.title)
  const [notes, setNotes] = useState(day.notes)
  const commit = (patch: { title?: string; notes?: string }) => {
    const changed = (patch.title ?? day.title) !== day.title || (patch.notes ?? day.notes) !== day.notes
    if (changed) save.mutate({ day: day.day, ...patch }, { onError: (e) => toast.error(e.message) })
  }
  return { title, setTitle, notes, setNotes, commit }
}

export function TripDay() {
  const { day: dayParam = '' } = useParams()
  const { trip } = useTripContext()
  const days = useDays(trip.id)
  const activities = useActivities(trip.id)
  if (days.isPending || activities.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-10">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[60dvh]" />
      </div>
    )
  }
  const list = days.data ?? []
  const day = list.find((d) => d.day === dayParam)
  if (!day) return <NotFound />
  return <DayView key={day.day} tripId={trip.id} day={day} days={list} activities={activities.data ?? []} />
}

type DayViewProps = { tripId: number; day: Day; days: Day[]; activities: Activity[] }

function DayView({ tripId, day, days, activities }: DayViewProps) {
  const { trip } = useTripContext()
  const navigate = useNavigate()
  const update = useUpdateActivity(tripId)
  const updateDay = useUpdateDay(tripId)
  const text = useDayText(tripId, day)
  const weather = useTripWeather(trip).data?.find((w) => w.day === day.day)
  const [ideasEl, setIdeasEl] = useState<HTMLElement | null>(null)
  const [adding, setAdding] = useState<Partial<ActivityDraft> | null>(null)
  const [editing, setEditing] = useState<Activity | null>(null)

  const onDay = activities.filter((a) => a.day === day.day)
  const ideas = activities.filter((a) => a.day === null)
  const index = days.findIndex((d) => d.day === day.day)
  const prev = days[index - 1]
  const next = days[index + 1]
  const tripDays = days.filter((d) => d.in_trip)
  const number = day.in_trip ? tripDays.findIndex((d) => d.day === day.day) + 1 : null
  const destination = trip.destinations.find((d) => d.id === day.destination_id)

  const change = (activity: Activity, to: TimeChange) =>
    new Promise<boolean>((resolve) =>
      update.mutate(
        { activityId: activity.id, version: activity.version, ...to },
        { onSuccess: () => resolve(true), onError: () => resolve(false) },
      ),
    )

  /** From the button (no range: suggest a time) or a selection on the grid ("Any time" row: no times). */
  const openAdd = (range?: TimeChange) => {
    if (range && range.start_time === null) return setAdding({ day: day.day, anyTime: true })
    const start = range?.start_time ?? suggestStart(onDay)
    setAdding({ day: day.day, start: hhmm(start), end: hhmm(range?.end_time ?? addMinutes(start, 60)) })
  }

  const scheduleIdea = (idea: Activity) => {
    const start = suggestStart(onDay)
    void change(idea, { day: day.day, start_time: start, end_time: addMinutes(start, 60) })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 md:px-10 md:py-8">
      <div className="space-y-3">
        <Link
          to=".."
          relative="path"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All days
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous day"
              disabled={!prev}
              onClick={() => prev && navigate(`../${prev.day}`, { relative: 'path' })}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <h2 className="type-heading text-xl">{longDate(day.day)}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next day"
              disabled={!next}
              onClick={() => next && navigate(`../${next.day}`, { relative: 'path' })}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <Button onClick={() => openAdd()}>
            <Plus aria-hidden="true" />
            Add activity
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-soft">
          {number && <span>Day {number} of {tripDays.length}</span>}
          {!day.in_trip && <span>Outside the trip's dates</span>}
          {trip.destinations.length > 1 ? (
            <label className="flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden="true" />
              <span className="sr-only">City for this day</span>
              <select
                value={day.destination_id ?? ''}
                onChange={(e) =>
                  updateDay.mutate(
                    { day: day.day, destination_id: Number(e.target.value) },
                    { onError: (err) => toast.error(err.message) },
                  )
                }
                className="h-7 rounded-md border border-input bg-card px-1.5 text-sm text-foreground"
              >
                {trip.destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            destination && (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden="true" />
                {destination.name}
              </span>
            )
          )}
          {destination?.timezone && <span>Times are local to {destination.name}</span>}
          {weather && (
            <>
              <WeatherChip weather={weather} />
              <WeatherAttribution />
            </>
          )}
        </div>
        <Input
          aria-label="Name this day"
          placeholder="Name this day (optional), like “Temples and tea”"
          value={text.title}
          maxLength={120}
          onChange={(e) => text.setTitle(e.target.value)}
          onBlur={() => text.commit({ title: text.title })}
          className="max-w-md"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="h-[70dvh] min-h-[28rem] overflow-hidden rounded-xl border bg-card">
          <ErrorBoundary fallback={(error) => <PartFailed what="calendar" error={error} className="rounded-none border-0" />}>
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <DayCalendar
                day={day.day}
                activities={onDay}
                ideasEl={ideasEl}
                onSelectRange={openAdd}
                onOpen={setEditing}
                onChange={change}
                onDropIdea={(id, to) => {
                  const idea = ideas.find((a) => a.id === id)
                  if (idea) void change(idea, to)
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        <IdeasPanel
          ideas={ideas}
          onOpen={setEditing}
          onSchedule={scheduleIdea}
          onAdd={() => setAdding({})}
          listRef={setIdeasEl}
          className="lg:max-h-[70dvh]"
        />
      </div>

      <div className="max-w-2xl space-y-1.5">
        <label htmlFor="day-notes" className="text-sm font-semibold">
          Notes for the day
        </label>
        <Textarea
          id="day-notes"
          rows={3}
          maxLength={4000}
          placeholder="Reservations, things to bring, backup plans…"
          value={text.notes}
          onChange={(e) => text.setNotes(e.target.value)}
          onBlur={() => text.commit({ notes: text.notes })}
        />
      </div>

      <AddActivityDialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        tripId={tripId}
        days={days}
        center={destination ? searchCenter(destination) : null}
        initial={adding ?? {}}
      />
      <ActivityEditor tripId={tripId} days={days} activity={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
