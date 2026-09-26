import type { AgentKind, Routine, RoutineConfig, RoutineCreate, RoutineUpdate } from '@/lib/api/agents'
import { AGENT_SCHEDULES, findPreset, looksLikeCron } from '@/lib/schedules'

export const CUSTOM = 'custom'

export const KIND_INFO: Record<
  AgentKind,
  { label: string; description: string; defaultName: string; defaultSchedule: string; turns: number; minutes: number }
> = {
  flight_agent: {
    label: 'Flight search',
    description: 'Looks for fares the price APIs miss, like budget airlines, sales, and deal posts, and saves each one with a link.',
    defaultName: 'Fare scout',
    defaultSchedule: '0 8,20 * * *',
    turns: 40,
    minutes: 20,
  },
  research_agent: {
    label: 'Research',
    description: 'Looks into a topic you choose and saves notes to the trip, each with its sources.',
    defaultName: 'Trip research',
    defaultSchedule: '0 9 * * 1',
    turns: 30,
    minutes: 15,
  },
}

export const DEFAULT_TOPIC =
  'Events, festivals, and closures during the trip dates, and popular places that need advance reservations.'

export type RoutineDraft = {
  tripId: number | null
  name: string
  kind: AgentKind
  /** A preset's cron, or CUSTOM. */
  schedule: string
  customCron: string
  enabled: boolean
  catchUp: boolean
  /** Empty means every active route on the trip. */
  routeIds: number[]
  topic: string
  instructions: string
  maxTurns: string
  timeoutMin: string
}

export function newDraft(kind: AgentKind, tripId: number | null): RoutineDraft {
  const info = KIND_INFO[kind]
  return {
    tripId,
    name: info.defaultName,
    kind,
    schedule: info.defaultSchedule,
    customCron: '',
    enabled: true,
    catchUp: true,
    routeIds: [],
    topic: kind === 'research_agent' ? DEFAULT_TOPIC : '',
    instructions: '',
    maxTurns: '',
    timeoutMin: '',
  }
}

/** Switching kind on a new routine swaps the defaults the user hasn't changed. */
export function withKind(draft: RoutineDraft, kind: AgentKind): RoutineDraft {
  const before = KIND_INFO[draft.kind]
  const after = KIND_INFO[kind]
  return {
    ...draft,
    kind,
    name: draft.name === before.defaultName ? after.defaultName : draft.name,
    schedule: draft.schedule === before.defaultSchedule ? after.defaultSchedule : draft.schedule,
    topic: kind === 'research_agent' && !draft.topic ? DEFAULT_TOPIC : draft.topic,
  }
}

export function draftFromRoutine(routine: Routine): RoutineDraft {
  const kind = routine.kind === 'flight_api' ? 'flight_agent' : routine.kind
  const preset = findPreset(routine.schedule_cron)
  const config = routine.config
  return {
    tripId: routine.trip_id,
    name: routine.name,
    kind,
    schedule: preset ? preset.cron : CUSTOM,
    customCron: preset ? '' : routine.schedule_cron,
    enabled: routine.enabled,
    catchUp: routine.catch_up,
    routeIds: config.route_ids ?? [],
    topic: config.topic ?? '',
    instructions: config.instructions ?? '',
    maxTurns: config.max_turns ? String(config.max_turns) : '',
    timeoutMin: config.timeout_min ? String(config.timeout_min) : '',
  }
}

export function scheduleCron(draft: RoutineDraft): string {
  return draft.schedule === CUSTOM ? draft.customCron.trim() : draft.schedule
}

/** Runs a month for a preset, or null for a custom schedule. */
export function runsPerMonth(draft: RoutineDraft): number | null {
  return draft.schedule === CUSTOM ? null : (AGENT_SCHEDULES.find((p) => p.cron === draft.schedule)?.perMonth ?? null)
}

function whole(value: string): number | null {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

export function validateDraft(draft: RoutineDraft): string | null {
  if (draft.tripId === null) return 'Choose a trip.'
  if (!draft.name.trim()) return 'Give the routine a name.'
  if (draft.schedule === CUSTOM && !looksLikeCron(draft.customCron))
    return 'A custom schedule needs five parts, like “0 8 * * *” for every day at 8:00.'
  if (draft.maxTurns.trim()) {
    const turns = whole(draft.maxTurns)
    if (turns === null || turns < 5 || turns > 100) return 'Max turns must be a whole number from 5 to 100.'
  }
  if (draft.timeoutMin.trim()) {
    const minutes = whole(draft.timeoutMin)
    if (minutes === null || minutes < 5 || minutes > 60) return 'The time limit must be 5 to 60 minutes.'
  }
  return null
}

export function toConfig(draft: RoutineDraft): RoutineConfig {
  return {
    route_ids: draft.kind === 'flight_agent' ? draft.routeIds : [],
    topic: draft.kind === 'research_agent' ? draft.topic.trim() || null : null,
    instructions: draft.instructions.trim() || null,
    max_turns: whole(draft.maxTurns),
    timeout_min: whole(draft.timeoutMin),
  }
}

export function toCreate(draft: RoutineDraft): RoutineCreate {
  return {
    trip_id: draft.tripId!,
    name: draft.name.trim(),
    kind: draft.kind,
    schedule_cron: scheduleCron(draft),
    enabled: draft.enabled,
    catch_up: draft.catchUp,
    config: toConfig(draft),
  }
}

export function toUpdate(draft: RoutineDraft): RoutineUpdate {
  return {
    name: draft.name.trim(),
    schedule_cron: scheduleCron(draft),
    enabled: draft.enabled,
    catch_up: draft.catchUp,
    config: toConfig(draft),
  }
}
