import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type DestinationSuggestion = components['schemas']['DestinationSuggestion']
export type Airport = components['schemas']['AirportOut']

export function useDestinationSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['destination-search', q.toLowerCase()],
    queryFn: async (): Promise<DestinationSuggestion[]> =>
      unwrap(await api.GET('/api/v1/geo/destinations', { params: { query: { q } } })),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useAirportSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: ['airport-search', q.toLowerCase()],
    queryFn: async (): Promise<Airport[]> => unwrap(await api.GET('/api/v1/airports', { params: { query: { q } } })),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })
}
