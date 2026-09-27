import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useChooseFlight } from '@/lib/api/flights'
import { useDays } from '@/lib/api/itinerary'
import type { Trip } from '@/lib/api/trips'
import { formatDateRange } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { quoteDates } from './route-text'

/** A fare to make the trip's flight: from the options list, or a cell of the date grid. */
export type FlightPick = {
  routeId: number
  quoteId: number
  route: string
  depart_date: string
  return_date: string | null
  airlines: string[]
  price: number
  currency: string
}

/** The trip's dates once this flight is chosen (a one-way flight moves only the start). */
function datesWith(pick: FlightPick, trip: Trip): { start: string; end: string } {
  const end = pick.return_date ?? (trip.end_date && trip.end_date >= pick.depart_date ? trip.end_date : pick.depart_date)
  return { start: pick.depart_date, end }
}

export function ChooseFlightDialog({ trip, pick, onClose }: { trip: Trip; pick: FlightPick | null; onClose: () => void }) {
  const choose = useChooseFlight()
  const days = useDays(trip.id)
  const next = pick ? datesWith(pick, trip) : null
  const outside = next
    ? (days.data ?? []).filter((d) => d.activity_count > 0 && (d.day < next.start || d.day > next.end)).length
    : 0
  const now = trip.start_date && trip.end_date ? formatDateRange(trip.start_date, trip.end_date) : null

  return (
    <AlertDialog open={pick !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        {pick && next && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Use this flight for the trip?</AlertDialogTitle>
              <AlertDialogDescription>
                {[pick.route, quoteDates(pick), pick.airlines.join(', ') || null, formatMoney(pick.price, pick.currency)]
                  .filter(Boolean)
                  .join(' · ')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm">
              <p>
                The trip becomes <strong>{formatDateRange(next.start, next.end)}</strong>
                {now && now !== formatDateRange(next.start, next.end) ? ` (it’s ${now} now)` : ''}. Its dates then
                follow this flight until you choose another one or clear it.
              </p>
              {outside > 0 && (
                <p className="text-warning">
                  {outside === 1 ? '1 day with plans falls' : `${outside} days with plans fall`} outside those dates.
                  {outside === 1 ? ' It stays' : ' They stay'} in the itinerary, marked “Outside the trip dates,” so
                  you can move the plans.
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep current dates</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  choose.mutate(
                    { routeId: pick.routeId, quoteId: pick.quoteId },
                    {
                      onSuccess: (saved) =>
                        toast.success(
                          saved.start_date && saved.end_date
                            ? `The trip is now ${formatDateRange(saved.start_date, saved.end_date)}`
                            : 'Flight chosen',
                        ),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              >
                Use this flight
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
