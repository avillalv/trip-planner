import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type Presentation = components['schemas']['Presentation']
export type DeckDestination = components['schemas']['DeckDestination']
export type DeckRoute = components['schemas']['DeckRoute']
export type DeckDay = components['schemas']['DeckDay']
export type DeckActivity = components['schemas']['DeckActivity']

/** Everything the deck shows, in one request, so it opens at once. */
export function usePresentation(tripId: number) {
  return useQuery({
    queryKey: ['presentation', tripId],
    queryFn: async (): Promise<Presentation> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/presentation', { params: { path: { trip_id: tripId } } })),
  })
}
