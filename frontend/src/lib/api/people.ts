import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'
import { tripsKey } from './trips'

export type Person = components['schemas']['PersonOut']
export type PersonInput = components['schemas']['PersonIn']

export const peopleKey = ['people'] as const

/** Initial colors for travelers; each keeps white initials legible (≥ 4.5:1). */
export const PERSON_COLORS = ['#c24472', '#1f7f86', '#5b47b0', '#9a5f0e', '#2f6fd6', '#1d7a52', '#b8472f', '#7a4a2b']

export function nextPersonColor(people: Person[]): string {
  const used = new Set(people.map((p) => p.color.toLowerCase()))
  return PERSON_COLORS.find((c) => !used.has(c)) ?? PERSON_COLORS[people.length % PERSON_COLORS.length]
}

export function usePeople() {
  return useQuery({
    queryKey: peopleKey,
    queryFn: async (): Promise<Person[]> => unwrap(await api.GET('/api/v1/people')),
  })
}

export function useSavePerson(personId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: PersonInput): Promise<Person> =>
      personId === undefined
        ? unwrap(await api.POST('/api/v1/people', { body }))
        : unwrap(await api.PUT('/api/v1/people/{person_id}', { params: { path: { person_id: personId } }, body })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKey }),
        queryClient.invalidateQueries({ queryKey: tripsKey }),
      ]),
  })
}

export function useDeletePerson() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (personId: number) =>
      unwrap(await api.DELETE('/api/v1/people/{person_id}', { params: { path: { person_id: personId } } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: peopleKey }),
        queryClient.invalidateQueries({ queryKey: tripsKey }),
      ]),
  })
}
