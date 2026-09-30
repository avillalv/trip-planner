import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { KIND_LABEL, runDuration, savedCount, TRIGGER_LABEL } from '@/components/agents/run-meta'
import { RejectionList, SavedOutputs } from '@/components/agents/run-outputs'
import { RunStamp } from '@/components/agents/run-status'
import { RunTimeline } from '@/components/agents/run-timeline'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  isRunning,
  useAllRoutines,
  useRunDetail,
  useRunOutputs,
  useStopRun,
  type RunDetail,
} from '@/lib/api/agents'
import { useRunEvents } from '@/lib/api/flights'
import { useTrips } from '@/lib/api/trips'
import { compactNumber } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { NotFound } from '@/routes/errors'

const startedFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function Fact({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div title={title}>
      <dt className="type-label text-ink-soft">{label}</dt>
      <dd className="type-data mt-0.5">{children}</dd>
    </div>
  )
}

type Report = { status?: string; summary?: string; sources_checked?: string[]; issues?: string[] }

function Summary({ run, lastEvent }: { run: RunDetail; lastEvent?: string }) {
  const report = (run.report ?? null) as Report | null
  if (isRunning(run.status)) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <p className="font-semibold">
          {run.status === 'queued' ? 'Waiting for a free slot…' : 'Claude is working on it.'}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {lastEvent ? `Latest: ${lastEvent}` : 'The log below updates as it goes.'}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {run.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-semibold text-destructive">What went wrong</p>
          <p className="mt-1 max-w-prose">{run.error}</p>
        </div>
      )}
      {(report?.summary || run.summary) && (
        <div className="rounded-xl border bg-card p-5">
          <p className="type-label text-ink-soft">{report ? "Agent's report" : 'Summary'}</p>
          <p className="mt-1.5 max-w-prose leading-relaxed whitespace-pre-wrap">{report?.summary ?? run.summary}</p>
          {report?.sources_checked && report.sources_checked.length > 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              <span className="font-semibold text-foreground">Checked:</span> {report.sources_checked.join(', ')}
            </p>
          )}
          {report?.issues && report.issues.length > 0 && (
            <div className="mt-3 text-sm">
              <p className="font-semibold">Problems it ran into</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
                {report.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Command({ run }: { run: RunDetail }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="prompt-heading">
        <h3 id="prompt-heading" className="type-label text-ink-soft">
          Task given to Claude
        </h3>
        <pre className="type-data mt-2 max-h-[32rem] overflow-auto rounded-xl border bg-card p-4 text-xs leading-relaxed whitespace-pre-wrap">
          {run.prompt}
        </pre>
      </section>
      {run.argv_redacted && (
        <section aria-labelledby="command-heading">
          <h3 id="command-heading" className="type-label text-ink-soft">
            Command
          </h3>
          <pre className="type-data mt-2 overflow-auto rounded-xl border bg-card p-4 text-xs leading-relaxed break-all whitespace-pre-wrap">
            {run.argv_redacted.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg)).join(' ')}
          </pre>
          <p className="mt-2 max-w-prose text-xs text-ink-soft">
            Claude can search the web, open pages, and use the trip tools, which save through the app's checks. It has
            no shell or file access, and the model is always Sonnet 5.5.
          </p>
        </section>
      )}
    </div>
  )
}

export function RunPage() {
  const { runId = '' } = useParams()
  const run = useRunDetail(runId)
  const live = isRunning(run.data?.status)
  const events = useRunEvents(runId, live)
  const outputs = useRunOutputs(runId, live)
  const routines = useAllRoutines()
  const trips = useTrips()
  const stop = useStopRun()
  const queryClient = useQueryClient()
  const now = useNow(live ? 1_000 : 60_000)
  const [tab, setTab] = useState<string | null>(null)

  // When the run finishes, fetch its final log and outputs once.
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live) {
      void queryClient.invalidateQueries({ queryKey: ['run-events', runId] })
      void queryClient.invalidateQueries({ queryKey: ['runs', 'outputs', runId] })
    }
    wasLive.current = live
  }, [live, queryClient, runId])

  if (run.isError) return <NotFound />
  if (!run.data) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8 md:px-10 md:py-12">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  const data = run.data
  const routine = routines.data?.find((r) => r.id === data.routine_id)
  const trip = trips.data?.find((t) => t.id === data.trip_id)
  const saved = outputs.data ? savedCount(outputs.data) : 0
  const rejected = outputs.data?.rejections.length ?? 0
  const log = events.data ?? []
  const current = tab ?? (live || saved === 0 ? 'log' : 'saved')
  const tokens = (data.input_tokens ?? 0) + (data.output_tokens ?? 0)

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 md:px-10 md:py-12">
      <div>
        <Link
          to="/agents"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Agents
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h1 className="type-title">{routine?.name ?? KIND_LABEL[data.kind]}</h1>
            <p className="mt-1.5 text-ink-soft">
              {[trip?.name, routine && KIND_LABEL[data.kind], TRIGGER_LABEL[data.trigger]].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {live && (
              <Button
                variant="outline"
                disabled={data.cancel_requested || stop.isPending}
                onClick={() => stop.mutate(data.id, { onError: (e) => toast.error(e.message) })}
              >
                {data.cancel_requested ? 'Stopping…' : 'Stop run'}
              </Button>
            )}
            <RunStamp status={data.status} at={data.finished_at ?? data.started_at ?? data.queued_at} />
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Fact label="Started">
            {data.started_at ? startedFormat.format(new Date(data.started_at)) : 'Not yet'}
          </Fact>
          <Fact label="Took">{runDuration(data, now) ?? '—'}</Fact>
          {data.kind !== 'flight_api' && (
            <>
              <Fact label="Tokens" title="Input (including cached context) plus output">
                {tokens ? compactNumber(tokens) : '—'}
              </Fact>
              <Fact
                label="API-price estimate"
                title="What this run would cost at API prices. On your subscription it counts toward your usage limits instead."
              >
                {data.cost_usd_est !== null ? `$${Number(data.cost_usd_est).toFixed(2)}` : '—'}
              </Fact>
            </>
          )}
        </dl>
      </div>

      <Summary run={data} lastEvent={log.at(-1)?.summary} />

      <Tabs value={current} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="saved">Saved ({saved})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected})</TabsTrigger>
          <TabsTrigger value="log">Log ({log.length})</TabsTrigger>
          {data.prompt && <TabsTrigger value="prompt">Task</TabsTrigger>}
        </TabsList>
        <TabsContent value="saved">
          {outputs.data ? <SavedOutputs outputs={outputs.data} /> : <Skeleton className="h-24" />}
        </TabsContent>
        <TabsContent value="rejected">
          {outputs.data ? <RejectionList rejections={outputs.data.rejections} /> : <Skeleton className="h-24" />}
        </TabsContent>
        <TabsContent value="log">
          <RunTimeline events={log} startedAt={data.started_at} live={live} />
        </TabsContent>
        {data.prompt && (
          <TabsContent value="prompt">
            <Command run={data} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
