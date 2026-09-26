import { describe, expect, it } from 'vitest'
import type { Routine } from '@/lib/api/agents'
import {
  CUSTOM,
  DEFAULT_TOPIC,
  draftFromRoutine,
  newDraft,
  runsPerMonth,
  toCreate,
  toUpdate,
  validateDraft,
  withKind,
} from './routine-form'

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 3,
    trip_id: 7,
    name: 'Fare scout',
    kind: 'flight_agent',
    enabled: true,
    schedule_cron: '0 8,20 * * *',
    timezone: 'America/New_York',
    catch_up: true,
    config: { route_ids: [4], topic: null, instructions: 'Nonstop only', max_turns: 30, timeout_min: null },
    next_run_at: null,
    last_run: null,
    ...overrides,
  }
}

describe('routine drafts', () => {
  it('starts flight searches twice a day and research weekly', () => {
    expect(newDraft('flight_agent', 7)).toMatchObject({ name: 'Fare scout', schedule: '0 8,20 * * *', topic: '' })
    expect(newDraft('research_agent', 7)).toMatchObject({ schedule: '0 9 * * 1', topic: DEFAULT_TOPIC })
  })

  it('swaps only the defaults you have not changed when switching kind', () => {
    const untouched = withKind(newDraft('flight_agent', 7), 'research_agent')
    expect(untouched).toMatchObject({ name: 'Trip research', schedule: '0 9 * * 1' })

    const named = withKind({ ...newDraft('flight_agent', 7), name: 'Tokyo deals' }, 'research_agent')
    expect(named.name).toBe('Tokyo deals')
  })

  it('round-trips a saved routine, including a custom schedule', () => {
    expect(draftFromRoutine(routine())).toMatchObject({
      schedule: '0 8,20 * * *',
      routeIds: [4],
      instructions: 'Nonstop only',
      maxTurns: '30',
      timeoutMin: '',
    })
    expect(draftFromRoutine(routine({ schedule_cron: '15 6 * * 2' }))).toMatchObject({
      schedule: CUSTOM,
      customCron: '15 6 * * 2',
    })
  })

  it('builds API payloads with only the settings that apply', () => {
    const flight = { ...newDraft('flight_agent', 7), routeIds: [4, 5], topic: 'ignored', maxTurns: ' 25 ' }
    expect(toCreate(flight)).toEqual({
      trip_id: 7,
      name: 'Fare scout',
      kind: 'flight_agent',
      schedule_cron: '0 8,20 * * *',
      enabled: true,
      catch_up: true,
      config: { route_ids: [4, 5], topic: null, instructions: null, max_turns: 25, timeout_min: null },
    })

    const research = { ...newDraft('research_agent', 7), routeIds: [4], schedule: CUSTOM, customCron: ' 0 7 * * 5 ' }
    expect(toUpdate(research)).toMatchObject({
      schedule_cron: '0 7 * * 5',
      config: { route_ids: [], topic: DEFAULT_TOPIC },
    })
  })

  it('explains what is wrong before saving', () => {
    const draft = newDraft('flight_agent', 7)
    expect(validateDraft(draft)).toBeNull()
    expect(validateDraft({ ...draft, tripId: null })).toBe('Choose a trip.')
    expect(validateDraft({ ...draft, name: '  ' })).toBe('Give the routine a name.')
    expect(validateDraft({ ...draft, schedule: CUSTOM, customCron: 'daily' })).toMatch(/five parts/)
    expect(validateDraft({ ...draft, maxTurns: '2' })).toMatch(/5 to 100/)
    expect(validateDraft({ ...draft, timeoutMin: '90' })).toMatch(/5 to 60 minutes/)
  })

  it('estimates monthly runs for presets only', () => {
    expect(runsPerMonth(newDraft('flight_agent', 7))).toBe(60)
    expect(runsPerMonth({ ...newDraft('flight_agent', 7), schedule: CUSTOM })).toBeNull()
  })
})
