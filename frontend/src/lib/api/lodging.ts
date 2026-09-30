import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api, unwrap } from './client'
import type { Run } from './flights'
import type { components } from './schema'

export type Lodging = components['schemas']['LodgingOut']
export type LodgingInput = components['schemas']['LodgingIn']
export type LodgingUpdate = components['schemas']['LodgingUpdate']
export type LodgingStatus = Lodging['status']
export type LinkPreview = components['schemas']['LinkPreview']
export type RentalOffer = components['schemas']['RentalOffer']
export type RentalSearch = components['schemas']['RentalSearchIn']
export type RentalSearchResult = components['schemas']['RentalSearchResult']
export type AskLodging = components['schemas']['AskLodgingIn']

export const lodgingKey = (tripId: number) => ['lodging', tripId] as const

/** Polls fast while `live` (a lodging run is saving picks), and once more when it ends. */
export function useLodging(tripId: number, live = false) {
  const queryClient = useQueryClient()
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live) void queryClient.invalidateQueries({ queryKey: lodgingKey(tripId) })
    wasLive.current = live
  }, [live, queryClient, tripId])

  return useQuery({
    queryKey: lodgingKey(tripId),
    queryFn: async (): Promise<Lodging[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/lodging', { params: { path: { trip_id: tripId } } })),
    refetchInterval: live ? 3_000 : 30_000,
  })
}

function useRefresh(tripId: number) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: lodgingKey(tripId) })
}

export function useAddLodging(tripId: number) {
  const refresh = useRefresh(tripId)
  return useMutation({
    mutationFn: async (body: LodgingInput): Promise<Lodging> =>
      unwrap(await api.POST('/api/v1/trips/{trip_id}/lodging', { params: { path: { trip_id: tripId } }, body })),
    onSuccess: refresh,
  })
}

/** Changes show at once and roll back if the save fails. */
export function useUpdateLodging(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & LodgingUpdate): Promise<Lodging> =>
      unwrap(await api.PATCH('/api/v1/lodging/{option_id}', { params: { path: { option_id: id } }, body })),
    onMutate: async ({ id, ...body }) => {
      await queryClient.cancelQueries({ queryKey: lodgingKey(tripId) })
      const before = queryClient.getQueryData<Lodging[]>(lodgingKey(tripId))
      queryClient.setQueryData<Lodging[]>(lodgingKey(tripId), (list) =>
        list?.map((o) => (o.id === id ? ({ ...o, ...body } as Lodging) : o)),
      )
      return { before }
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(lodgingKey(tripId), context?.before),
    onSuccess: (saved) =>
      queryClient.setQueryData<Lodging[]>(lodgingKey(tripId), (list) =>
        list?.map((o) => (o.id === saved.id ? saved : o)),
      ),
  })
}

export function useDeleteLodging(tripId: number) {
  const refresh = useRefresh(tripId)
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap(await api.DELETE('/api/v1/lodging/{option_id}', { params: { path: { option_id: id } } })),
    onSuccess: refresh,
  })
}

export function useHeart(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, personId, hearted }: { id: number; personId: number; hearted: boolean }): Promise<Lodging> =>
      unwrap(
        await api.PUT('/api/v1/lodging/{option_id}/hearts/{person_id}', {
          params: { path: { option_id: id, person_id: personId } },
          body: { hearted },
        }),
      ),
    onMutate: async ({ id, personId, hearted }) => {
      await queryClient.cancelQueries({ queryKey: lodgingKey(tripId) })
      const before = queryClient.getQueryData<Lodging[]>(lodgingKey(tripId))
      queryClient.setQueryData<Lodging[]>(lodgingKey(tripId), (list) =>
        list?.map((o) =>
          o.id === id
            ? { ...o, hearts: hearted ? [...new Set([...o.hearts, personId])] : o.hearts.filter((p) => p !== personId) }
            : o,
        ),
      )
      return { before }
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(lodgingKey(tripId), context?.before),
  })
}

export function usePreviewLink() {
  return useMutation({
    mutationFn: async (body: { url: string; fetch?: boolean }): Promise<LinkPreview> =>
      unwrap(await api.POST('/api/v1/lodging/preview', { body })),
  })
}

/** A mutation, not a query: each search spends one of the month's SerpApi searches. */
export function useRentalSearch(tripId: number) {
  return useMutation({
    mutationFn: async (body: RentalSearch): Promise<RentalSearchResult> =>
      unwrap(
        await api.POST('/api/v1/trips/{trip_id}/lodging/search-rentals', {
          params: { path: { trip_id: tripId } },
          body,
        }),
      ),
  })
}

/** Runs one Google search, then queues a Claude run that saves its best picks as lodging options. */
export function useAskForLodging(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: AskLodging): Promise<Run> =>
      unwrap(await api.POST('/api/v1/trips/{trip_id}/ai/lodging', { params: { path: { trip_id: tripId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs'] }),
  })
}
