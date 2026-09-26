/**
 * The day's time grid (FullCalendar), loaded on demand because it's large.
 * The calendar runs in UTC so activities' wall-clock times show exactly as stored.
 */
import FullCalendar, { type EventDisplayInfo } from '@fullcalendar/react'
import interactionPlugin, { Draggable } from '@fullcalendar/react/interaction'
import '@fullcalendar/react/skeleton.css'
import classicThemePlugin from '@fullcalendar/react/themes/classic'
import '@fullcalendar/react/themes/classic/theme.css'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import 'temporal-polyfill/global'
import { useEffect, useMemo } from 'react'
import { CATEGORY, tint } from '@/lib/activity-meta'
import type { Activity } from '@/lib/api/itinerary'
import { useIsDark } from '@/lib/hooks'
import { addMinutes, eventRange, formatTimeRange, fromCalendar } from '@/lib/itinerary-time'

export type TimeChange = { day: string; start_time: string | null; end_time: string | null }

type Props = {
  day: string
  activities: Activity[]
  /** Ideas list element whose [data-idea-id] items can be dragged onto the grid. */
  ideasEl: HTMLElement | null
  onSelectRange: (range: TimeChange) => void
  onOpen: (activity: Activity) => void
  /** Resolves false when the change was refused, so the block moves back. */
  onChange: (activity: Activity, change: TimeChange) => Promise<boolean>
  onDropIdea: (activityId: number, change: TimeChange) => void
}

function withDefaultEnd(change: TimeChange): TimeChange {
  return change.start_time && !change.end_time ? { ...change, end_time: addMinutes(change.start_time, 60) } : change
}

function EventBlock({ info }: { info: EventDisplayInfo }) {
  const activity = info.event.extendedProps.activity as Activity | undefined
  // An idea being dragged in is drawn from its drag data, before it's an activity on the day.
  if (!activity) {
    return <p className="truncate px-1.5 py-0.5 text-xs font-semibold">{info.event.title}</p>
  }
  const { icon: Icon, color, label } = CATEGORY[activity.category]
  const time = formatTimeRange(activity.start_time, activity.end_time)
  return (
    <div
      className="flex h-full min-h-0 gap-1.5 overflow-hidden border-l-[3px] py-0.5 pr-1 pl-1.5 text-xs leading-snug"
      style={{ borderColor: color }}
      title={`${activity.title} · ${time}`}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color }} aria-label={label} />
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {activity.title}
          {info.isShort && !info.event.allDay && <span className="type-data font-normal opacity-80"> · {time}</span>}
        </p>
        {!info.isShort && !info.event.allDay && <p className="type-data text-[0.6875rem] opacity-80">{time}</p>}
        {!info.isShort && activity.location_name && <p className="truncate opacity-80">{activity.location_name}</p>}
        {!info.isShort && activity.status === 'booked' && (
          <p className="mt-0.5 inline-block rounded bg-card/70 px-1 text-[0.625rem] font-bold tracking-wide uppercase">
            Booked
          </p>
        )}
      </div>
    </div>
  )
}

export default function DayCalendar({ day, activities, ideasEl, onSelectRange, onOpen, onChange, onDropIdea }: Props) {
  const dark = useIsDark()

  const events = useMemo(
    () =>
      activities.map((activity) => ({
        id: String(activity.id),
        title: activity.title,
        ...eventRange({ ...activity, day: activity.day ?? day }),
        color: tint(CATEGORY[activity.category].color, 20),
        contrastColor: 'var(--tp-ink)',
        extendedProps: { activity },
      })),
    [activities, day],
  )

  // Ideas dragged from the side panel land on the grid as a one-hour block.
  useEffect(() => {
    if (!ideasEl) return
    const draggable = new Draggable(ideasEl, {
      itemSelector: '[data-idea-id]',
      eventData: (el) => ({ title: el.dataset.title ?? '', duration: '01:00', create: false }),
      longPressDelay: 350,
    })
    return () => draggable.destroy()
  }, [ideasEl])

  const handleChange = async (info: { event: { startStr: string; endStr: string; allDay: boolean; extendedProps: Record<string, unknown> }; revert: () => void }) => {
    const activity = info.event.extendedProps.activity as Activity
    const change = withDefaultEnd(fromCalendar(info.event.startStr, info.event.endStr || null, info.event.allDay))
    if (!(await onChange(activity, change))) info.revert()
  }

  return (
    <div className="tp-calendar h-full">
      <FullCalendar
        key={day}
        plugins={[timeGridPlugin, interactionPlugin, classicThemePlugin]}
        initialView="timeGridDay"
        initialDate={day}
        headerToolbar={false}
        dayHeaders={false}
        timeZone="UTC"
        colorScheme={dark ? 'dark' : 'light'}
        height="100%"
        slotMinTime="00:00"
        slotMaxTime="26:00"
        scrollTime="07:30"
        slotDuration="00:30"
        snapDuration="00:15"
        slotHeaderFormat={{ hour: 'numeric' }}
        allDaySlot
        allDayText="Any time"
        nowIndicator={false}
        editable
        selectable
        selectMirror
        droppable
        longPressDelay={350}
        defaultTimedEventDuration="01:00"
        events={events}
        eventContent={(info) => <EventBlock info={info} />}
        eventClick={(info) => onOpen(info.event.extendedProps.activity as Activity)}
        select={(info) => {
          info.view.calendar.unselect()
          onSelectRange(withDefaultEnd(fromCalendar(info.startStr, info.endStr, info.allDay)))
        }}
        eventDrop={handleChange}
        eventResize={handleChange}
        drop={(info) => {
          const id = Number(info.draggedEl.dataset.ideaId)
          if (id) onDropIdea(id, withDefaultEnd(fromCalendar(info.dateStr, null, info.allDay)))
        }}
      />
    </div>
  )
}
