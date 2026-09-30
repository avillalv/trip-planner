import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'
import type { Trip } from './trips'

export type DayWeather = components['schemas']['DayWeather']

/** Every weather query of one trip (invalidate with this after its dates or destinations change). */
export const weatherKey = (tripId: number) => ['weather', tripId] as const

/**
 * Weather for each trip day: the forecast where it reaches, typical weather elsewhere. Days without
 * weather are simply absent. Never blocks a page: while loading, or if it fails, the list is empty.
 */
export function useTripWeather(trip: Pick<Trip, 'id' | 'start_date' | 'end_date' | 'destinations'>) {
  const destinations = trip.destinations.map((d) => d.id).join(',')
  return useQuery({
    // The dates and destinations are in the key so a change to them fetches fresh days.
    queryKey: [...weatherKey(trip.id), trip.start_date, trip.end_date, destinations],
    queryFn: async (): Promise<DayWeather[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/weather', { params: { path: { trip_id: trip.id } } })),
    staleTime: 30 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  })
}

/** Weather by ISO date, for looking up a day. */
export function weatherByDay(weather: DayWeather[] | undefined): Map<string, DayWeather> {
  return new Map((weather ?? []).map((w) => [w.day, w]))
}
