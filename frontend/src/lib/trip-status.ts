import type { TripStatus } from '@/lib/api/trips'

export const TRIP_STATUSES: TripStatus[] = ['planning', 'booked', 'done', 'archived']

export const STATUS_LABELS: Record<TripStatus, string> = {
  planning: 'Planning',
  booked: 'Booked',
  done: 'Done',
  archived: 'Archived',
}
