import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from './client'
import type { Run } from './flights'
import type { components } from './schema'

export type Routine = components['schemas']['RoutineOut']
export type RoutineConfig = components['schemas']['RoutineConfig']
export type RoutineCreate = components['schemas']['RoutineCreate']
export type RoutineUpdate = components['schemas']['RoutineUpdate']
export type RoutineKind = Routine['kind']
export type AgentKind = RoutineCreate['kind']
export type RunDetail = components['schemas']['RunDetailOut']
export type RunOutputs = components['schemas']['RunOutputs']
export type RunStatus = Run['status']
export type AgentNote = components['schemas']['NoteOut']
export type Rejection = components['schemas']['RejectionOut']

export const AGENT_KINDS: AgentKind[] = ['flight_agent', 'research_agent']

export const isAgentKind = (kind: RoutineKind): kind is AgentKind => kind !== 'flight_api'
export const isRunning = (status?: RunStatus) => status === 'queued' || status === 'running'

// Shares prefixes with the flights page, so a change here refreshes it too.
const routinesKey = ['routines'] as const
const runsKey = ['runs'] as const

export function useAllRoutines() {
  return useQuery({
    queryKey: [...routinesKey, 'all'],
    queryFn: async (): Promise<Routine[]> => unwrap(await api.GET('/api/v1/routines')),
    // Keeps "last run" and "next run" current, faster while something is running.
    refetchInterval: (query) => (query.state.data?.some((r) => isRunning(r.last_run?.status)) ? 3_000 : 30_000),
  })
}

function useInvalidateAutomation() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: routinesKey }),
      queryClient.invalidateQueries({ queryKey: runsKey }),
    ])
}

export function useCreateRoutine() {
  const invalidate = useInvalidateAutomation()
  return useMutation({
    mutationFn: async (body: RoutineCreate): Promise<Routine> => unwrap(await api.POST('/api/v1/routines', { body })),
    onSuccess: invalidate,
  })
}

export function useEditRoutine() {
  const invalidate = useInvalidateAutomation()
  return useMutation({
    mutationFn: async ({ routineId, ...body }: { routineId: number } & RoutineUpdate): Promise<Routine> =>
      unwrap(await api.PATCH('/api/v1/routines/{routine_id}', { params: { path: { routine_id: routineId } }, body })),
    onSuccess: invalidate,
  })
}

export function useDeleteRoutine() {
  const invalidate = useInvalidateAutomation()
  return useMutation({
    mutationFn: async (routineId: number) =>
      unwrap(await api.DELETE('/api/v1/routines/{routine_id}', { params: { path: { routine_id: routineId } } })),
    onSuccess: invalidate,
  })
}

export function useRunRoutine() {
  const invalidate = useInvalidateAutomation()
  return useMutation({
    mutationFn: async (routineId: number): Promise<Run> =>
      unwrap(await api.POST('/api/v1/routines/{routine_id}/run', { params: { path: { routine_id: routineId } } })),
    onSuccess: invalidate,
  })
}

export function useStopRun() {
  const invalidate = useInvalidateAutomation()
  return useMutation({
    mutationFn: async (runId: string): Promise<Run> =>
      unwrap(await api.POST('/api/v1/runs/{run_id}/cancel', { params: { path: { run_id: runId } } })),
    onSuccess: invalidate,
  })
}

export type RunFilters = { tripId?: number; routineId?: number; kind?: Run['kind']; status?: RunStatus; limit?: number }

export function useRuns(filters: RunFilters = {}) {
  return useQuery({
    queryKey: [...runsKey, 'list', filters],
    queryFn: async (): Promise<Run[]> =>
      unwrap(
        await api.GET('/api/v1/runs', {
          params: {
            query: {
              trip_id: filters.tripId,
              routine_id: filters.routineId,
              kind: filters.kind,
              status: filters.status,
              limit: filters.limit ?? 40,
            },
          },
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.some((r) => isRunning(r.status)) ? 3_000 : 30_000),
  })
}

export function useRunDetail(runId: string) {
  return useQuery({
    queryKey: [...runsKey, 'detail', runId],
    queryFn: async (): Promise<RunDetail> =>
      unwrap(await api.GET('/api/v1/runs/{run_id}', { params: { path: { run_id: runId } } })),
    refetchInterval: (query) => (isRunning(query.state.data?.status) ? 2_000 : false),
  })
}

export function useRunOutputs(runId: string, live: boolean) {
  return useQuery({
    queryKey: [...runsKey, 'outputs', runId],
    queryFn: async (): Promise<RunOutputs> =>
      unwrap(await api.GET('/api/v1/runs/{run_id}/outputs', { params: { path: { run_id: runId } } })),
    refetchInterval: live ? 4_000 : false,
  })
}

export function useTripNotes(tripId: number) {
  return useQuery({
    queryKey: ['notes', tripId],
    queryFn: async (): Promise<AgentNote[]> =>
      unwrap(await api.GET('/api/v1/trips/{trip_id}/notes', { params: { path: { trip_id: tripId } } })),
  })
}

export function useDismissNote(tripId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (noteId: number) =>
      unwrap(await api.DELETE('/api/v1/notes/{note_id}', { params: { path: { note_id: noteId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', tripId] }),
  })
}
