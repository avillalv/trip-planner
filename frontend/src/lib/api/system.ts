import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema'

export type SystemStatus = components['schemas']['SystemStatus']

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: async (): Promise<SystemStatus> => {
      const { data, error } = await api.GET('/api/v1/system/status')
      if (error || !data) throw new Error('The server returned an error for /api/v1/system/status.')
      return data
    },
    refetchInterval: 30_000,
  })
}
