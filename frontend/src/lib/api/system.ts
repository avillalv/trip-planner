import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type SystemStatus = components['schemas']['SystemStatus']

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: async (): Promise<SystemStatus> => unwrap(await api.GET('/api/v1/system/status')),
    refetchInterval: 30_000,
  })
}

export function useBackUpNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/system/backup')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-status'] }),
  })
}
