import type { Activity, ActivityCategory, ActivityInput, ActivityPatch, Place } from '@/lib/api/itinerary'
import { addMinutes } from '@/lib/itinerary-time'

/** Form state. Times are "HH:MM" as <input type="time"> uses; day '' means an idea. */
export type ActivityDraft = {
  title: string
  category: ActivityCategory
  day: string
  anyTime: boolean
  start: string
  end: string
  booked: boolean
  locationName: string
  address: string
  url: string
  notes: string
  lat: number | null
  lon: number | null
}

const hhmm = (time: string | null | undefined) => (time ? time.slice(0, 5) : '')

export function newDraft(init: Partial<ActivityDraft> = {}): ActivityDraft {
  const start = init.start ?? '10:00'
  return {
    title: '',
    category: 'other',
    day: '',
    anyTime: false,
    start,
    end: hhmm(addMinutes(`${start}:00`, 60)),
    booked: false,
    locationName: '',
    address: '',
    url: '',
    notes: '',
    lat: null,
    lon: null,
    ...init,
  }
}

export function draftFromActivity(activity: Activity): ActivityDraft {
  return {
    title: activity.title,
    category: activity.category,
    day: activity.day ?? '',
    anyTime: activity.day !== null && activity.start_time === null,
    start: hhmm(activity.start_time) || '10:00',
    end: hhmm(activity.end_time),
    booked: activity.status === 'booked',
    locationName: activity.location_name ?? '',
    address: activity.address ?? '',
    url: activity.url ?? '',
    notes: activity.notes,
    lat: activity.lat,
    lon: activity.lon,
  }
}

/** Prefill from a place found in search. */
export function draftFromPlace(place: Place, init: Partial<ActivityDraft> = {}): ActivityDraft {
  return newDraft({
    title: place.name,
    category: place.category,
    locationName: place.local_name ? `${place.name} (${place.local_name})` : place.name,
    address: place.address ?? '',
    url: place.website ?? '',
    lat: place.lat,
    lon: place.lon,
    ...init,
  })
}

export function validateDraft(draft: ActivityDraft): string | null {
  if (!draft.title.trim()) return 'Give it a name.'
  if (draft.day && !draft.anyTime) {
    if (!draft.start) return 'Set a start time, or choose Any time.'
    if (draft.end && draft.end === draft.start) return 'The end time must differ from the start time.'
  }
  const url = draft.url.trim()
  if (url && !/^https?:\/\//i.test(url)) return 'Links must start with http:// or https://'
  return null
}

type Fields = Omit<ActivityInput, 'place'>

function toFields(draft: ActivityDraft): Fields {
  const scheduled = Boolean(draft.day)
  const timed = scheduled && !draft.anyTime
  const text = (value: string) => value.trim() || null
  return {
    title: draft.title.trim(),
    category: draft.category,
    day: draft.day || null,
    start_time: timed ? `${draft.start}:00` : null,
    end_time: timed && draft.end ? `${draft.end}:00` : null,
    status: scheduled ? (draft.booked ? 'booked' : 'planned') : 'idea',
    location_name: text(draft.locationName),
    address: text(draft.address),
    url: text(draft.url),
    notes: draft.notes.trim(),
    lat: draft.lat,
    lon: draft.lon,
  }
}

export function toInput(draft: ActivityDraft, place?: Place | null): ActivityInput {
  const input: ActivityInput = toFields(draft)
  if (place) input.place = { provider: place.provider, id: place.id, data: place }
  return input
}

/** Only what changed, plus the version the edit is based on. */
export function toPatch(draft: ActivityDraft, original: Activity): ActivityPatch {
  const fields = toFields(draft)
  const patch: ActivityPatch = { version: original.version }
  for (const [key, value] of Object.entries(fields) as Array<[keyof Fields, Fields[keyof Fields]]>) {
    if (value !== (original[key] ?? null)) (patch as Record<string, unknown>)[key] = value
  }
  return patch
}
