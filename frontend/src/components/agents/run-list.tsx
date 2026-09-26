import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { isRunning } from '@/lib/api/agents'
import type { Run } from '@/lib/api/flights'
import { useNow } from '@/lib/hooks'
import { RUN_STATUS, TRIGGER_LABEL, runCounts, runDuration } from './run-meta'
import { StatusIcon } from './run-status'

const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

type Props = { runs: Run[]; routineName: (run: Run) => string; tripName: (tripId: number) => string | undefined }

export function RunList({ runs, routineName, tripName }: Props) {
  const now = useNow(runs.some((r) => isRunning(r.status)) ? 1_000 : 60_000)
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {runs.map((run) => {
        const facts = [tripName(run.trip_id), TRIGGER_LABEL[run.trigger], runDuration(run, now), runCounts(run)].filter(
          Boolean,
        )
        const detail = run.error ?? run.summary
        return (
          <li key={run.id}>
            <Link
              to={`/agents/runs/${run.id}`}
              className="flex items-start gap-3 px-4 py-3 outline-offset-[-2px] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <StatusIcon status={run.status} className="mt-1" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold">
                    {routineName(run)}
                    <span className="sr-only">, {RUN_STATUS[run.status].label}</span>
                  </span>
                  <span className="type-data text-xs text-ink-soft">{when.format(new Date(run.queued_at))}</span>
                </p>
                <p className="text-sm text-ink-soft">{facts.join(' · ')}</p>
                {detail && <p className="mt-0.5 line-clamp-1 text-sm">{detail}</p>}
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-ink-soft" aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
