import { useOutletContext } from 'react-router'
import type { Trip } from '@/lib/api/trips'

export type TripOutletContext = { trip: Trip; editTrip: () => void }

/** The current trip, provided by TripLayout to every trip section. */
export function useTripContext(): TripOutletContext {
  return useOutletContext<TripOutletContext>()
}
