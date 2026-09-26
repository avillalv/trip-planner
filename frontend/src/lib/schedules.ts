/** Schedule presets for routines. Cron times run in the PC's time zone. */

export type SchedulePreset = { cron: string; label: string; perMonth: number }

const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** "8:00 AM" or "08:00", following the viewer's locale. */
export function atHour(hour: number): string {
  return timeOfDay.format(new Date(2000, 0, 1, hour))
}

export const PRICE_CHECK_SCHEDULES: SchedulePreset[] = [
  { cron: '0 8 * * *', label: `Once a day (${atHour(8)})`, perMonth: 30 },
  { cron: '0 8,20 * * *', label: `Twice a day (${atHour(8)} and ${atHour(20)})`, perMonth: 60 },
  { cron: '0 */6 * * *', label: 'Every 6 hours', perMonth: 120 },
  { cron: '0 */3 * * *', label: 'Every 3 hours', perMonth: 240 },
]

export const AGENT_SCHEDULES: SchedulePreset[] = [
  { cron: '0 8,20 * * *', label: `Twice a day (${atHour(8)} and ${atHour(20)})`, perMonth: 60 },
  { cron: '0 8 * * *', label: `Once a day (${atHour(8)})`, perMonth: 30 },
  { cron: '0 9 * * 1,4', label: `Twice a week (Mondays and Thursdays, ${atHour(9)})`, perMonth: 9 },
  { cron: '0 9 * * 1', label: `Once a week (Mondays, ${atHour(9)})`, perMonth: 4 },
]

const KNOWN = [...AGENT_SCHEDULES, ...PRICE_CHECK_SCHEDULES]

export function findPreset(cron: string): SchedulePreset | undefined {
  return KNOWN.find((preset) => preset.cron === cron)
}

export function describeSchedule(cron: string): string {
  return findPreset(cron)?.label ?? `Custom (${cron})`
}

/** A quick sanity check before the server validates: five space-separated fields. */
export function looksLikeCron(value: string): boolean {
  return value.trim().split(/\s+/).length === 5
}
