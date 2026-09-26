import { BookOpenText, Plane, Radar, type LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isAgentKind, isRunning, useEditRoutine, useRunRoutine, type Routine, type RoutineKind } from '@/lib/api/agents'
import { timeAgo } from '@/lib/format'
import { describeSchedule } from '@/lib/schedules'
import { KIND_LABEL, RUN_STATUS } from './run-meta'
import { StatusIcon } from './run-status'

const KIND_ICON: Record<RoutineKind, LucideIcon> = {
  flight_api: Radar,
  flight_agent: Plane,
  research_agent: BookOpenText,
}

const clock = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

type Props = { routine: Routine; onEdit: (routine: Routine) => void; onDelete: (routine: Routine) => void }

export function RoutineCard({ routine, onEdit, onDelete }: Props) {
  const edit = useEditRoutine()
  const runNow = useRunRoutine()
  const navigate = useNavigate()
  const agent = isAgentKind(routine.kind)
  const last = routine.last_run
  const busy = isRunning(last?.status)
  const Icon = KIND_ICON[routine.kind]

  const start = () =>
    runNow.mutate(routine.id, {
      onSuccess: (run) => {
        if (agent) navigate(`/agents/runs/${run.id}`)
        else toast.success('Checking prices now')
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <li className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-soft">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="leading-snug font-semibold">{routine.name}</h4>
          <p className="text-sm text-ink-soft">
            {KIND_LABEL[routine.kind]} ·{' '}
            {routine.enabled ? describeSchedule(routine.schedule_cron) : 'Runs only when you start it'}
          </p>
          {routine.next_run_at && (
            <p className="text-xs text-ink-soft">Next run {clock.format(new Date(routine.next_run_at))}</p>
          )}
        </div>
        <Switch
          aria-label={`Run ${routine.name} on schedule`}
          checked={routine.enabled}
          disabled={edit.isPending}
          onCheckedChange={(enabled) =>
            edit.mutate({ routineId: routine.id, enabled }, { onError: (e) => toast.error(e.message) })
          }
        />
      </div>

      {last ? (
        <Link
          to={`/agents/runs/${last.id}`}
          className="mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm outline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <StatusIcon status={last.status} className="mt-0.5" />
          <span className="min-w-0">
            <span className="font-semibold">{RUN_STATUS[last.status].label}</span>
            <span className="text-ink-soft"> · {timeAgo(last.finished_at ?? last.started_at ?? last.queued_at)}</span>
            {(last.summary || last.error) && (
              <span className="line-clamp-2 block text-ink-soft">{last.summary ?? last.error}</span>
            )}
          </span>
        </Link>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">Hasn't run yet.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={start} disabled={busy || runNow.isPending}>
          {busy ? 'Running…' : 'Run now'}
        </Button>
        {agent ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => onEdit(routine)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDelete(routine)}>
              Delete
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/trips/${routine.trip_id}/flights`}>Change schedule on Flights</Link>
          </Button>
        )}
      </div>
    </li>
  )
}
