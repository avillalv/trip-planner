import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useRuns } from './agents'
import { api, unwrap } from './client'
import type { Run } from './flights'
import { itineraryKey, type Activity } from './itinerary'
import type { components } from './schema'

export type Suggestion = components['schemas']['SuggestionOut']
export type SuggestionMode = Suggestion['mode']
export type IdeasRequest = components['schemas']['IdeasIn']

const suggestionsKey = (tripId: number) => ['suggestions', tripId] as const

/** The new and added suggestions, newest run first. Polls while a run is working, then once more when it ends. */
export function useSuggestions(tripId: number, live: boolean) {
  const queryClient = useQueryClient()
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live) void queryClient.invalidateQueries({ queryKey: suggestionsKey(tripId) })
    wasLive.current = live
  }, [live, queryClient, tripId])

  return useQuery({
    queryKey: suggestionsKey(tripId),
    queryFn: async (): Promise<Suggestion[]> =>
      unwrap(
        await api.GET('/api/v1/trips/{trip_id}/suggestions', {
          params: { path: { trip_id: tripId }, query: { status: ['new', 'added'] } },
        }),
      ),
    refetchInterval: live ? 3_000 : false,
  })
}

/** Queues a Claude run; the status and reply show through the trip's latest run. */
export function useAskForIdeas(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: IdeasRequest): Promise<Run> =>
      unwrap(await api.POST('/api/v1/trips/{trip_id}/ai/ideas', { params: { path: { trip_id: tripId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs'] }),
  })
}

/** The trip's most recent run of an AI planner kind, refreshed while it's working. */
export function useLatestAiRun(tripId: number, kind: 'itinerary_agent' | 'lodging_agent') {
  const runs = useRuns({ tripId, kind, limit: 1 })
  return { run: runs.data?.[0], isPending: runs.isPending }
}

export function useDismissSuggestion(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (suggestionId: number): Promise<Suggestion> =>
      unwrap(
        await api.PATCH('/api/v1/suggestions/{suggestion_id}', {
          params: { path: { suggestion_id: suggestionId } },
          body: { status: 'dismissed' },
        }),
      ),
    onMutate: async (suggestionId) => {
      await queryClient.cancelQueries({ queryKey: suggestionsKey(tripId) })
      const before = queryClient.getQueryData<Suggestion[]>(suggestionsKey(tripId))
      queryClient.setQueryData<Suggestion[]>(suggestionsKey(tripId), (list) =>
        list?.filter((s) => s.id !== suggestionId),
      )
      return { before }
    },
    onError: (_error, _id, context) => queryClient.setQueryData(suggestionsKey(tripId), context?.before),
  })
}

/** Adds the suggestion to the itinerary (or, with `asIdea`, to the ideas list) and refreshes the days it touches. */
export function useAddSuggestion(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, asIdea = false }: { id: number; asIdea?: boolean }): Promise<Activity> =>
      unwrap(
        await api.POST('/api/v1/suggestions/{suggestion_id}/add', {
          params: { path: { suggestion_id: id } },
          body: { as_idea: asIdea },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: suggestionsKey(tripId) }),
        queryClient.invalidateQueries({ queryKey: itineraryKey(tripId) }),
      ]),
  })
}
