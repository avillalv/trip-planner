import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { components } from './schema'

export type AppSettings = components['schemas']['AppSettingsOut']

const settingsKey = ['app-settings'] as const

export function useAppSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: async (): Promise<AppSettings> => unwrap(await api.GET('/api/v1/settings')),
  })
}

export function useUpdateAppSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: components['schemas']['AppSettingsIn']): Promise<AppSettings> =>
      unwrap(await api.PUT('/api/v1/settings', { body })),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
  })
}
