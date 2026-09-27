import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, isStale, unwrap } from './client'
import type { components } from './schema'

export type Day = components['schemas']['DayOut']
export type DayUpdate = components['schemas']['DayUpdate']
export type Activity = components['schemas']['ActivityOut']
export type ActivityInput = components['schemas']['ActivityIn']
export type ActivityPatch = components['schemas']['ActivityUpdate']
export type ActivityCategory = Activity['category']
export type ActivityStatus = Activity['status']
export type Place = components['schemas']['PlaceOut']
export type PlaceSearchResult = components['schemas']['PlaceSearchResult']
export type WikiSummary = components['schemas']['WikiSummary']
export type SearchKind =
  | 'restaurants'
  | 'cafes'
  | 'museums'
  | 'landmarks'
  | 'viewpoints'
  | 'parks'
  | 'beaches'
  | 'nightlife'
  | 'shopping'

const itineraryKey = (tripId: number) => ['itinerary', tripId] as const
const daysKey = (tripId: number) => [...itineraryKey(tripId), 'days'] as const
const activitiesKey = (tripId: number) => [...itineraryKey(tripId), 'activities'] as const

export function useDays(tripId: number) {
  return useQuery({
    queryKey: daysKey(tripId),
    queryFn: async (): Promise<Day[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/days', { params: { path: { trip_id: tripId } } })),
  })
}

/** Every activity on the trip, ideas included; views filter this one list. */
export function useActivities(tripId: number) {
  return useQuery({
    queryKey: activitiesKey(tripId),
    queryFn: async (): Promise<Activity[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/activities', { params: { path: { trip_id: tripId } } })),
    // Picks up edits made on the other device without a reload.
    refetchInterval: 30_000,
  })
}

export function useUpdateDay(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ day, ...body }: { day: string } & DayUpdate): Promise<Day> =>
      unwrap(
        await api.PUT('/api/v1/trips/{trip_id}/days/{day}', { params: { path: { trip_id: tripId, day } }, body }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: daysKey(tripId) }),
  })
}

function useRefreshItinerary(tripId: number) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: itineraryKey(tripId) })
}

/** After another device changed or removed an activity: say so and show the latest. */
function onStale(error: unknown, refresh: () => Promise<unknown>): boolean {
  if (!isStale(error)) return false
  toast.warning(error instanceof Error ? error.message : 'This activity changed on another device.')
  void refresh()
  return true
}

export function useCreateActivity(tripId: number) {
  const refresh = useRefreshItinerary(tripId)
  return useMutation({
    mutationFn: async (body: ActivityInput): Promise<Activity> =>
      unwrap(
        await api.POST('/api/v1/trips/{trip_id}/activities', { params: { path: { trip_id: tripId } }, body }),
      ),
    onSuccess: refresh,
  })
}

export function useUpdateActivity(tripId: number) {
  const queryClient = useQueryClient()
  const refresh = useRefreshItinerary(tripId)
  return useMutation({
    mutationFn: async ({ activityId, ...body }: { activityId: number } & ActivityPatch): Promise<Activity> =>
      unwrap(
        await api.PATCH('/api/v1/activities/{activity_id}', {
          params: { path: { activity_id: activityId } },
          body,
        }),
      ),
    onSuccess: (updated) => {
      // Swap in the new version right away, so a quick second drag uses it.
      queryClient.setQueryData<Activity[]>(activitiesKey(tripId), (list) =>
        list?.map((a) => (a.id === updated.id ? updated : a)),
      )
      return queryClient.invalidateQueries({ queryKey: daysKey(tripId) })
    },
    onError: (error) => {
      if (!onStale(error, refresh)) toast.error(error.message)
    },
  })
}

export function useDeleteActivity(tripId: number) {
  const refresh = useRefreshItinerary(tripId)
  return useMutation({
    mutationFn: async (activity: Pick<Activity, 'id' | 'version'>) =>
      unwrap(
        await api.DELETE('/api/v1/activities/{activity_id}', {
          params: { path: { activity_id: activity.id }, query: { version: activity.version } },
        }),
      ),
    onSuccess: refresh,
    onError: (error) => {
      if (!onStale(error, refresh)) toast.error(error.message)
    },
  })
}

// --- Places -------------------------------------------------------------------------------------

export type PlaceQuery = { lat: number; lon: number; radius_m: number; within?: number } & (
  | { kind: SearchKind }
  | { q: string }
)

export function usePlaceSearch(query: PlaceQuery | null) {
  return useQuery({
    queryKey: ['places', 'search', query],
    queryFn: async (): Promise<PlaceSearchResult> =>
      unwrap(await api.GET('/api/v1/places/search', { params: { query: query! } })),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    retry: false,
  })
}

/** Hours and website for a place found by name (category results already have them). */
export function usePlaceDetails(place: Place | null) {
  return useQuery({
    queryKey: ['places', 'details', place?.id],
    queryFn: async (): Promise<Place> =>
      unwrap(
        await api.GET('/api/v1/places/geoapify/{place_id}', { params: { path: { place_id: place!.id } } }),
      ),
    enabled: place !== null && !place.has_details,
    staleTime: Infinity,
    retry: false,
  })
}

export function usePlaceWiki(place: Place | null) {
  const wikidata = place?.wikidata ?? undefined
  const wikipedia = place?.wikipedia ?? undefined
  return useQuery({
    queryKey: ['places', 'wiki', wikidata, wikipedia],
    queryFn: async (): Promise<WikiSummary | null> =>
      unwrap(await api.GET('/api/v1/places/wiki', { params: { query: { wikidata, wikipedia } } })) ?? null,
    enabled: Boolean(wikidata || wikipedia),
    staleTime: Infinity,
    retry: false,
  })
}
