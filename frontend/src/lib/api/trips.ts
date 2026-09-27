import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type Trip = components['schemas']['TripOut']
export type TripInput = components['schemas']['TripIn']
export type Destination = components['schemas']['DestinationOut']
export type DestinationInput = components['schemas']['DestinationIn']
export type TripStatus = Trip['status']

export const tripsKey = ['trips'] as const
export const tripKey = (id: number) => ['trips', id] as const

/** True while any destination is still waiting for its Wikipedia summary. */
const hasPendingInfo = (trip?: Trip) => trip?.destinations.some((d) => d.info_status === 'pending') ?? false

export function useTrips() {
  return useQuery({
    queryKey: tripsKey,
    queryFn: async (): Promise<Trip[]> => unwrap(await api.GET('/api/v1/trips')),
    refetchInterval: (query) => (query.state.data?.some(hasPendingInfo) ? 2_000 : false),
  })
}

export function useTrip(id: number) {
  return useQuery({
    queryKey: tripKey(id),
    queryFn: async (): Promise<Trip> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}', { params: { path: { trip_id: id } } })),
    refetchInterval: (query) => (hasPendingInfo(query.state.data) ? 2_000 : false),
    enabled: Number.isFinite(id),
  })
}

export function useSaveTrip(tripId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: TripInput): Promise<Trip> =>
      tripId === undefined
        ? unwrap(await api.POST('/api/v1/trips', { body }))
        : unwrap(await api.PUT('/api/v1/trips/{trip_id}', { params: { path: { trip_id: tripId } }, body })),
    onSuccess: (trip) => {
      queryClient.setQueryData(tripKey(trip.id), trip)
      return queryClient.invalidateQueries({ queryKey: tripsKey })
    },
  })
}

export function useDeleteTrip() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (tripId: number) =>
      unwrap(await api.DELETE('/api/v1/trips/{trip_id}', { params: { path: { trip_id: tripId } } })),
    onSuccess: (_data, tripId) => {
      queryClient.removeQueries({ queryKey: tripKey(tripId) })
      return queryClient.invalidateQueries({ queryKey: tripsKey })
    },
  })
}

export function useRefreshTripInfo(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/api/v1/trips/{trip_id}/refresh-info', { params: { path: { trip_id: tripId } } }),
      ),
    // The fetch runs in the background; poll briefly for the result.
    onSuccess: () => {
      for (const delay of [1_500, 4_000, 8_000]) {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: tripKey(tripId) }), delay)
      }
    },
  })
}

/** Convert a saved trip back into the editor's input shape. */
export function toTripInput(trip: Trip): TripInput {
  return {
    name: trip.name,
    start_date: trip.start_date,
    end_date: trip.end_date,
    status: trip.status,
    home_currency: trip.home_currency,
    notes: trip.notes,
    traveler_ids: trip.travelers.map((t) => t.id),
    destinations: trip.destinations.map((d) => ({
      id: d.id,
      name: d.name,
      region: d.region,
      country: d.country,
      country_code: d.country_code,
      kind: d.kind,
      lat: d.lat,
      lon: d.lon,
      timezone: d.timezone,
      bbox: d.bbox,
      geoapify_place_id: d.geoapify_place_id,
    })),
  }
}
