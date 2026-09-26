import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type SessionInfo = components['schemas']['SessionInfo']

export const sessionKey = ['auth-session'] as const

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async (): Promise<SessionInfo> => unwrap(await api.GET('/api/auth/session')),
    staleTime: 60_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (passcode: string) => unwrap(await api.POST('/api/auth/login', { body: { passcode } })),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
