import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import { itineraryKey } from './itinerary'
import type { components } from './schema'
import { tripKey, tripsKey, type Trip } from './trips'

export type FlightRoute = components['schemas']['RouteOut']
export type RouteInput = components['schemas']['RouteIn']
export type Quote = components['schemas']['QuoteOut']
export type RouteSummary = components['schemas']['RouteSummary']
export type RouteHistory = components['schemas']['RouteHistory']
export type DateGridCell = components['schemas']['DateGridCell']
export type NearbyAirport = components['schemas']['NearbyAirport']
export type QuoteSource = 'serpapi' | 'travelpayouts' | 'agent' | 'manual'

/** Everything flight-related for a trip shares this prefix, so one invalidation refreshes it all. */
export const flightsKey = (tripId: number) => ['flights', tripId] as const

export function useRoutes(tripId: number) {
  return useQuery({
    queryKey: [...flightsKey(tripId), 'routes'],
    queryFn: async (): Promise<FlightRoute[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/routes', { params: { path: { trip_id: tripId } } })),
  })
}

export function useRouteSummaries(tripId: number) {
  return useQuery({
    queryKey: [...flightsKey(tripId), 'summary'],
    queryFn: async (): Promise<RouteSummary[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/flights/summary', { params: { path: { trip_id: tripId } } })),
  })
}

export function useBestOptions(tripId: number, routeId?: number) {
  return useQuery({
    queryKey: [...flightsKey(tripId), 'best', routeId ?? 'all'],
    queryFn: async (): Promise<Quote[]> =>
      unwrap(
        await api.GET('/api/v1/trips/{trip_id}/flights/best', {
          params: { path: { trip_id: tripId }, query: { route_id: routeId, limit: 60 } },
        }),
      ),
    placeholderData: keepPreviousData,
  })
}

export function useRouteHistory(tripId: number, routeId: number | undefined) {
  return useQuery({
    queryKey: [...flightsKey(tripId), 'history', routeId],
    queryFn: async (): Promise<RouteHistory> =>
      unwrap(await api.GET('/api/v1/routes/{route_id}/history', { params: { path: { route_id: routeId! } } })),
    enabled: routeId !== undefined,
    placeholderData: keepPreviousData,
  })
}

export function useDateGrid(tripId: number, routeId: number | undefined) {
  return useQuery({
    queryKey: [...flightsKey(tripId), 'grid', routeId],
    queryFn: async (): Promise<DateGridCell[]> =>
      unwrap(await api.GET('/api/v1/routes/{route_id}/date-grid', { params: { path: { route_id: routeId! } } })),
    enabled: routeId !== undefined,
    placeholderData: keepPreviousData,
  })
}

export function useSaveRoute(tripId: number, routeId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: RouteInput): Promise<FlightRoute> =>
      routeId === undefined
        ? unwrap(await api.POST('/api/v1/trips/{trip_id}/routes', { params: { path: { trip_id: tripId } }, body }))
        : unwrap(await api.PUT('/api/v1/routes/{route_id}', { params: { path: { route_id: routeId } }, body })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: flightsKey(tripId) }),
        queryClient.invalidateQueries({ queryKey: runsKey(tripId) }),
        queryClient.invalidateQueries({ queryKey: routinesKey(tripId) }),
      ]),
  })
}

export function useDeleteRoute(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (routeId: number) =>
      unwrap(await api.DELETE('/api/v1/routes/{route_id}', { params: { path: { route_id: routeId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flightsKey(tripId) }),
  })
}

export function useHideQuote(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ quoteId, hidden }: { quoteId: number; hidden: boolean }) =>
      unwrap(
        await api.PATCH('/api/v1/flight-quotes/{quote_id}', { params: { path: { quote_id: quoteId } }, body: { hidden } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: flightsKey(tripId) }),
  })
}

export function useNearbyAirports(lat?: number, lon?: number) {
  return useQuery({
    queryKey: ['airports-nearby', lat, lon],
    queryFn: async (): Promise<NearbyAirport[]> =>
      unwrap(await api.GET('/api/v1/airports/nearby', { params: { query: { lat: lat!, lon: lon! } } })),
    enabled: lat !== undefined && lon !== undefined,
    staleTime: Infinity,
  })
}

// --- Runs, routines, quota ----------------------------------------------------------------

export type Run = components['schemas']['RunOut']
export type RunEvent = components['schemas']['RunEventOut']
export type Routine = components['schemas']['RoutineOut']
export type SerpApiUsage = components['schemas']['SerpApiUsage']

export const runsKey = (tripId: number) => ['runs', tripId] as const
export const routinesKey = (tripId: number) => ['routines', tripId] as const

export const isActive = (run?: Run) => run?.status === 'queued' || run?.status === 'running'

export function useLatestRun(tripId: number) {
  return useQuery({
    queryKey: [...runsKey(tripId), 'latest'],
    queryFn: async (): Promise<Run | null> => {
      const runs = unwrap(await api.GET('/api/v1/runs', { params: { query: { trip_id: tripId, kind: 'flight_api', limit: 1 } } }))
      return runs[0] ?? null
    },
    // Poll quickly while a check is in progress.
    refetchInterval: (query) => (isActive(query.state.data ?? undefined) ? 2_000 : 30_000),
  })
}

export function useRunEvents(runId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['run-events', runId],
    queryFn: async (): Promise<RunEvent[]> =>
      unwrap(await api.GET('/api/v1/runs/{run_id}/events', { params: { path: { run_id: runId! } } })),
    enabled: runId !== undefined,
    refetchInterval: live ? 2_000 : false,
  })
}

export function useRefreshFlights(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (routeIds: number[] = []): Promise<Run> =>
      unwrap(
        await api.POST('/api/v1/trips/{trip_id}/flights/refresh', {
          params: { path: { trip_id: tripId } },
          body: { route_ids: routeIds },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsKey(tripId) }),
  })
}

export function useCancelRun(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (runId: string): Promise<Run> =>
      unwrap(await api.POST('/api/v1/runs/{run_id}/cancel', { params: { path: { run_id: runId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsKey(tripId) }),
  })
}

export function useRoutines(tripId: number) {
  return useQuery({
    queryKey: routinesKey(tripId),
    queryFn: async (): Promise<Routine[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/routines', { params: { path: { trip_id: tripId } } })),
  })
}

export function useUpdateRoutine(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ routineId, ...body }: { routineId: number } & components['schemas']['RoutineUpdate']) =>
      unwrap(await api.PATCH('/api/v1/routines/{routine_id}', { params: { path: { routine_id: routineId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routinesKey(tripId) }),
  })
}

export function useSerpApiUsage() {
  return useQuery({
    queryKey: ['serpapi-usage'],
    queryFn: async (): Promise<SerpApiUsage> => unwrap(await api.GET('/api/v1/usage/serpapi')),
    refetchInterval: 60_000,
  })
}

/** Identifies a flight across price checks: same route, source, airports, dates, airlines, and stops. */
export function flightKey(q: Pick<Quote, 'route_id' | 'source' | 'origin' | 'destination' | 'depart_date' | 'return_date' | 'airlines' | 'stops_out'>): string {
  return [q.route_id, q.source, q.origin, q.destination, q.depart_date, q.return_date ?? '', q.airlines.join('+'), q.stops_out ?? ''].join('|')
}

// Choosing a flight moves the trip's dates, so the trip, its days, and its deck all refresh.
function useAfterChoice() {
  const queryClient = useQueryClient()
  return (trip: Trip) => {
    queryClient.setQueryData(tripKey(trip.id), trip)
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: tripsKey }),
      queryClient.invalidateQueries({ queryKey: flightsKey(trip.id) }),
      queryClient.invalidateQueries({ queryKey: itineraryKey(trip.id) }),
      queryClient.invalidateQueries({ queryKey: ['presentation', trip.id] }),
    ])
  }
}

/** Make a fare the trip's flight: the trip's dates move to its departure and return. */
export function useChooseFlight() {
  const after = useAfterChoice()
  return useMutation({
    mutationFn: async ({ routeId, quoteId }: { routeId: number; quoteId: number }): Promise<Trip> =>
      unwrap(
        await api.PUT('/api/v1/routes/{route_id}/choice', {
          params: { path: { route_id: routeId } },
          body: { quote_id: quoteId },
        }),
      ),
    onSuccess: after,
  })
}

/** Stop using a route's flight for the dates; they stay as they are and become editable. */
export function useClearFlight() {
  const after = useAfterChoice()
  return useMutation({
    mutationFn: async (routeId: number): Promise<Trip> =>
      unwrap(await api.DELETE('/api/v1/routes/{route_id}/choice', { params: { path: { route_id: routeId } } })),
    onSuccess: after,
  })
}
