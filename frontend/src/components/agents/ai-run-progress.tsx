import { Loader2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStopRun } from '@/lib/api/agents'
import { useRunEvents, type Run } from '@/lib/api/flights'
import { formatElapsed, timeAgo } from '@/lib/format'
import { useNow } from '@/lib/hooks'

/** What an AI planner request shows while it runs: status, the latest step, elapsed time, Stop and the full log. */
export function AiRunWorking({ run, hint }: { run: Run; hint: string }) {
  const events = useRunEvents(run.id, true)
  const stop = useStopRun()
  const now = useNow(1_000)
  const latest = events.data?.at(-1)?.summary
  const since = new Date(run.started_at ?? run.queued_at).getTime()

  return (
    <div role="status" className="space-y-2 rounded-xl border bg-card p-4">
      <p className="flex items-center gap-2 font-semibold">
        <Loader2 className="size-4 animate-spin text-violet" aria-hidden="true" />
        {run.status === 'queued' ? 'Waiting to start…' : 'Claude is working on it…'}
      </p>
      {latest && <p className="text-sm text-ink-soft">{latest}</p>}
      <p className="text-sm text-ink-soft">{hint}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <span className="type-data text-xs text-ink-soft">{formatElapsed(now.getTime() - since)} so far</span>
        <Button
          variant="outline"
          size="sm"
          disabled={run.cancel_requested || stop.isPending}
          onClick={() => stop.mutate(run.id, { onError: (e) => toast.error(e.message) })}
        >
          {run.cancel_requested ? 'Stopping…' : 'Stop'}
        </Button>
        <Link to={`/agents/runs/${run.id}`} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
          See the full log
        </Link>
      </div>
    </div>
  )
}

/** How a finished AI planner request went: Claude's reply (headed by `label`), or why it didn't finish. */
export function AiRunOutcome({ run, label }: { run: Run; label: string }) {
  if (run.status === 'failed' || run.status === 'timed_out' || run.status === 'interrupted') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p>{run.error ?? "Claude couldn't finish that request. Try again."}</p>
          <Link to={`/agents/runs/${run.id}`} className="font-semibold text-brand underline-offset-2 hover:underline">
            See the full log
          </Link>
        </div>
      </div>
    )
  }
  if (!run.summary || (run.status !== 'succeeded' && run.status !== 'partial')) return null
  const asked = typeof run.params.message === 'string' ? run.params.message : null
  return (
    <figure className="space-y-1.5 rounded-xl border-l-4 border-brand bg-muted/50 p-4">
      <figcaption className="type-label text-ink-soft">
        Claude · {label} · {timeAgo(run.finished_at ?? run.queued_at)}
      </figcaption>
      {asked && <p className="text-xs text-ink-soft">You asked: “{asked}”</p>}
      <blockquote className="leading-relaxed whitespace-pre-wrap">{run.summary}</blockquote>
    </figure>
  )
}
