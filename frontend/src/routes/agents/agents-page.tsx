import { BookOpenText, Plane, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AgentStatus } from '@/components/agents/agent-status'
import { RoutineCard } from '@/components/agents/routine-card'
import { RoutineEditor } from '@/components/agents/routine-editor'
import { RunList } from '@/components/agents/run-list'
import { KIND_LABEL, RUN_STATUS } from '@/components/agents/run-meta'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  isAgentKind,
  useAllRoutines,
  useDeleteRoutine,
  useRuns,
  type AgentKind,
  type Routine,
  type RunStatus,
} from '@/lib/api/agents'
import type { Run } from '@/lib/api/flights'
import { useTrips } from '@/lib/api/trips'
import { readLastTripId } from '@/lib/last-trip'

type EditorState = { open: boolean; routine?: Routine; kind?: AgentKind }

const selectClass =
  'h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const STATUS_FILTERS: RunStatus[] = ['running', 'succeeded', 'partial', 'failed', 'timed_out', 'cancelled', 'interrupted']

function GetStarted({ onCreate }: { onCreate: (kind: AgentKind) => void }) {
  return (
    <div className="rounded-xl border border-dashed bg-card/60 p-5">
      <h3 className="font-semibold">No agent routines yet</h3>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Set one up and Claude works on it while you're busy: it looks for fares the price APIs miss, or researches
        something for the trip, and saves what it finds with links.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onCreate('flight_agent')}>
          <Plane aria-hidden="true" />
          Search for fares
        </Button>
        <Button variant="outline" onClick={() => onCreate('research_agent')}>
          <BookOpenText aria-hidden="true" />
          Research the trip
        </Button>
      </div>
    </div>
  )
}

export function AgentsPage() {
  const [params, setParams] = useSearchParams()
  const tripFilter = params.get('trip') ? Number(params.get('trip')) : undefined
  const statusFilter = (params.get('status') as RunStatus | null) ?? undefined
  const routines = useAllRoutines()
  const trips = useTrips()
  const runs = useRuns({ tripId: tripFilter, status: statusFilter })
  const remove = useDeleteRoutine()
  const [editor, setEditor] = useState<EditorState>({ open: false })
  const [deleting, setDeleting] = useState<Routine | null>(null)

  const setFilter = (key: string, value: string | undefined) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const tripName = (tripId: number) => trips.data?.find((t) => t.id === tripId)?.name
  const routineNames = new Map((routines.data ?? []).map((r) => [r.id, r.name]))
  const routineName = (run: Run) => (run.routine_id && routineNames.get(run.routine_id)) || KIND_LABEL[run.kind]

  const shown = (routines.data ?? []).filter((r) => tripFilter === undefined || r.trip_id === tripFilter)
  const tripOrder = (trips.data ?? []).map((t) => t.id)
  const groups = tripOrder
    .map((tripId) => ({ tripId, routines: shown.filter((r) => r.trip_id === tripId) }))
    .filter((group) => group.routines.length > 0)
  const hasAgents = shown.some((r) => isAgentKind(r.kind))

  const openNew = (kind: AgentKind) => setEditor({ open: true, kind })
  // The filtered trip, else the last one opened, else the first; only trips that still exist.
  const tripIds = (trips.data ?? []).map((t) => t.id)
  const defaultTrip = [tripFilter, readLastTripId(), tripIds[0]].find((id) => id != null && tripIds.includes(id)) ?? null

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 px-4 py-8 md:px-10 md:py-12">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="type-title">Agents</h1>
            <p className="mt-2 max-w-prose text-ink-soft">
              Claude searches the web on a schedule and saves what it finds, with links, for you to review. Runs use
              your Claude subscription and always the Sonnet model.
            </p>
          </div>
          <Button onClick={() => openNew('flight_agent')}>
            <Plus aria-hidden="true" />
            New routine
          </Button>
        </div>
        <AgentStatus />
      </header>

      <section aria-labelledby="routines-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="routines-heading" className="type-heading">
            Routines
          </h2>
          {(trips.data?.length ?? 0) > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-soft">Trip</span>
              <select
                className={selectClass}
                value={tripFilter ?? ''}
                onChange={(e) => setFilter('trip', e.target.value || undefined)}
              >
                <option value="">All trips</option>
                {trips.data!.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {routines.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {!hasAgents && <GetStarted onCreate={openNew} />}
            {groups.map((group) => (
              <div key={group.tripId}>
                <h3 className="type-label mb-2 text-ink-soft">{tripName(group.tripId)}</h3>
                <ul className="grid gap-3 md:grid-cols-2">
                  {group.routines.map((routine) => (
                    <RoutineCard
                      key={routine.id}
                      routine={routine}
                      onEdit={(r) => setEditor({ open: true, routine: r })}
                      onDelete={setDeleting}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      <section aria-labelledby="runs-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="runs-heading" className="type-heading">
            Recent runs
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-soft">Show</span>
            <select
              className={selectClass}
              value={statusFilter ?? ''}
              onChange={(e) => setFilter('status', e.target.value || undefined)}
            >
              <option value="">All runs</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {RUN_STATUS[status].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {runs.isPending ? (
          <Skeleton className="h-48" />
        ) : (runs.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-soft">
            {statusFilter ? 'No runs match this filter.' : 'No runs yet. They appear here as routines run.'}
          </p>
        ) : (
          <RunList runs={runs.data!} routineName={routineName} tripName={tripName} />
        )}
      </section>

      <RoutineEditor
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        routine={editor.routine}
        kind={editor.kind}
        tripId={defaultTrip}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops running. Its past runs and anything they saved stay; a run waiting to start is cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(`${deleting.name} deleted`),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Delete routine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
