import { describe, expect, it } from 'vitest'
import type { Activity, Place } from '@/lib/api/itinerary'
import { draftFromActivity, draftFromPlace, newDraft, toInput, toPatch, validateDraft } from './activity-form'
import { formatDistance, formatOpeningHours } from './labels'

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 4,
    trip_id: 7,
    day: '2026-11-05',
    start_time: '10:00:00',
    end_time: '12:00:00',
    title: 'Senso-ji',
    category: 'sights',
    status: 'planned',
    location_name: null,
    address: null,
    lat: null,
    lon: null,
    url: null,
    notes: '',
    place_provider: null,
    place_id: null,
    place_data: null,
    version: 3,
    created_at: '2026-09-26T12:00:00Z',
    updated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}

const place: Place = {
  provider: 'geoapify',
  id: 'p1',
  name: 'Kyoto National Museum',
  local_name: '京都国立博物館',
  category: 'museum',
  kinds: ['entertainment.museum'],
  address: 'Higashiyama Ward, Kyoto',
  lat: 34.99,
  lon: 135.77,
  distance_m: 1200,
  website: 'https://www.kyohaku.go.jp/',
  opening_hours: 'Tu-Su 09:30-17:00',
  phone: null,
  wikidata: 'Q1',
  wikipedia: null,
  has_details: true,
}

describe('activity form', () => {
  it('saves ideas, plans, and bookings with the right status and times', () => {
    expect(toInput(newDraft({ title: 'Ghibli Museum' }))).toMatchObject({ day: null, status: 'idea', start_time: null })
    expect(toInput(newDraft({ title: 'Lunch', day: '2026-11-05', start: '12:00', end: '13:00' }))).toMatchObject({
      status: 'planned',
      start_time: '12:00:00',
      end_time: '13:00:00',
    })
    expect(toInput(newDraft({ title: 'Suica', day: '2026-11-05', anyTime: true, booked: true }))).toMatchObject({
      status: 'booked',
      start_time: null,
      end_time: null,
    })
  })

  it('keeps where a place came from', () => {
    const input = toInput(draftFromPlace(place, { day: '2026-11-06' }), place)

    expect(input).toMatchObject({
      title: 'Kyoto National Museum',
      category: 'museum',
      location_name: 'Kyoto National Museum (京都国立博物館)',
      url: 'https://www.kyohaku.go.jp/',
      lat: 34.99,
      place: { provider: 'geoapify', id: 'p1' },
    })
  })

  it('sends only what changed, with the version it was based on', () => {
    const original = activity()
    const draft = { ...draftFromActivity(original), start: '14:00', end: '16:00' }

    expect(toPatch(draft, original)).toEqual({ version: 3, start_time: '14:00:00', end_time: '16:00:00' })
    expect(toPatch(draftFromActivity(original), original)).toEqual({ version: 3 })
    expect(toPatch({ ...draftFromActivity(original), day: '' }, original)).toMatchObject({
      day: null,
      status: 'idea',
      start_time: null,
    })
  })

  it('explains what to fix', () => {
    expect(validateDraft(newDraft())).toBe('Give it a name.')
    expect(validateDraft(newDraft({ title: 'x', day: '2026-11-05', start: '10:00', end: '10:00' }))).toMatch(/differ/)
    expect(validateDraft(newDraft({ title: 'x', url: 'kyoto.jp' }))).toMatch(/http/)
    expect(validateDraft(newDraft({ title: 'x' }))).toBeNull()
  })
})

describe('place labels', () => {
  it('reads OpenStreetMap opening hours', () => {
    expect(formatOpeningHours('Mo-Fr 09:00-17:00; Sa 10:00-16:00; PH off')).toEqual([
      'Mon–Fri 09:00–17:00',
      'Sat 10:00–16:00',
      'Holidays closed',
    ])
    expect(formatOpeningHours('24/7')).toEqual(['Open 24 hours'])
  })

  it('shows distances in m or km', () => {
    expect(formatDistance(242)).toBe('240 m')
    expect(formatDistance(1234)).toBe('1.2 km')
    expect(formatDistance(18_400)).toBe('18 km')
    expect(formatDistance(null)).toBeNull()
  })
})
