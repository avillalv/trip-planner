import { Ban, CircleAlert, CircleCheck, CircleX, Clock, Loader2, Pause, TimerOff, type LucideIcon } from 'lucide-react'
import type { RunOutputs, RunStatus } from '@/lib/api/agents'
import type { Run } from '@/lib/api/flights'
import { formatElapsed } from '@/lib/format'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'live'

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  queued: { label: 'Waiting to start', tone: 'live', icon: Clock },
  running: { label: 'Running', tone: 'live', icon: Loader2 },
  succeeded: { label: 'Done', tone: 'ok', icon: CircleCheck },
  partial: { label: 'Partly done', tone: 'warn', icon: CircleAlert },
  failed: { label: 'Failed', tone: 'bad', icon: CircleX },
  timed_out: { label: 'Timed out', tone: 'bad', icon: TimerOff },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: Ban },
  interrupted: { label: 'Interrupted', tone: 'muted', icon: Pause },
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  muted: 'text-ink-soft',
  live: 'text-violet',
}

export const KIND_LABEL: Record<Run['kind'], string> = {
  flight_api: 'Price check',
  flight_agent: 'Flight search',
  research_agent: 'Research',
  itinerary_agent: 'Itinerary ideas',
  lodging_agent: 'Lodging picks',
}

export const TRIGGER_LABEL: Record<Run['trigger'], string> = {
  schedule: 'On schedule',
  manual: 'Started by hand',
  catch_up: 'Catch-up',
}

export function runDuration(run: Run, now: Date): string | null {
  if (!run.started_at) return null
  const end = run.finished_at ? new Date(run.finished_at) : now
  return formatElapsed(end.getTime() - new Date(run.started_at).getTime())
}

export function runCounts(run: Run): string | null {
  if (run.kind === 'flight_api') return null
  const parts = []
  if (run.accepted_count) parts.push(`${run.accepted_count} saved`)
  if (run.rejected_count) parts.push(`${run.rejected_count} rejected`)
  return parts.length ? parts.join(' · ') : null
}

/** How many things a run saved, of every kind (rejections aren't saved). */
export const savedCount = (outputs: RunOutputs) =>
  outputs.quotes.length + outputs.notes.length + outputs.suggestions.length + outputs.lodging.length
